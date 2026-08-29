import type Database from "better-sqlite3";

import type { SourceObservationId } from "../../domain/capture/SourceObservation.js";
import type {
  ObservationClusterAssignment,
  ObservationClusterAssignmentId,
  ObservationClusterAssignmentStatus,
} from "../../domain/recognition/ObservationClusterAssignment.js";
import type { ObservationClusterAssignmentRepository } from "../../domain/recognition/ObservationClusterAssignmentRepository.js";
import {
  CurrentProposalConflictError,
  EffectiveAssignmentConflictError,
} from "../../domain/recognition/EmployerRecognitionPersistenceError.js";

interface AssignmentRow {
  id: string;
  source_observation_id: string;
  employer_cluster_id: string;
  confidence: number;
  status: string;
  algorithm: string;
  algorithm_version: string;
  evaluated_at: string;
  explanation: string | null;
}

const columns = `
  id, source_observation_id, employer_cluster_id, confidence, status,
  algorithm, algorithm_version, evaluated_at, explanation
`;

export class SqliteObservationClusterAssignmentRepository
  implements ObservationClusterAssignmentRepository
{
  constructor(private readonly db: Database.Database) {}

  async save(assignment: ObservationClusterAssignment): Promise<void> {
    insertObservationClusterAssignment(this.db, assignment);
  }

  async findById(
    id: ObservationClusterAssignmentId,
  ): Promise<ObservationClusterAssignment | null> {
    const row = this.db.prepare(`
      SELECT ${columns}
      FROM observation_cluster_assignments WHERE id = ?
    `).get(id) as AssignmentRow | undefined;
    return row === undefined ? null : mapRow(row);
  }

  async findByObservationId(
    sourceObservationId: SourceObservationId,
  ): Promise<readonly ObservationClusterAssignment[]> {
    return (this.db.prepare(`
      SELECT ${columns}
      FROM observation_cluster_assignments
      WHERE source_observation_id = ?
      ORDER BY evaluated_at, id
    `).all(sourceObservationId) as AssignmentRow[]).map(mapRow);
  }

  async findEffectiveByObservationId(
    sourceObservationId: SourceObservationId,
  ): Promise<ObservationClusterAssignment | null> {
    return this.findCurrent(
      sourceObservationId,
      "status IN ('ACCEPTED', 'USER_CONFIRMED')",
      "effective assignments",
    );
  }

  async findCurrentProposalByObservationId(
    sourceObservationId: SourceObservationId,
  ): Promise<ObservationClusterAssignment | null> {
    return this.findCurrent(
      sourceObservationId,
      "status = 'PROPOSED'",
      "current proposals",
    );
  }

  async replaceCurrentProposal(
    existingProposalId: ObservationClusterAssignmentId,
    replacement: ObservationClusterAssignment,
    supersededAt: Date,
  ): Promise<void> {
    validateAssignment(replacement);
    if (replacement.status !== "PROPOSED") {
      throw new Error("Replacement assignment must be PROPOSED.");
    }
    if (Number.isNaN(supersededAt.getTime())) {
      throw new Error("Proposal supersededAt must be a valid date.");
    }
    const replace = this.db.transaction(() => {
      const existing = this.db.prepare(`
        SELECT source_observation_id, status, superseded_at
        FROM observation_cluster_assignments WHERE id = ?
      `).get(existingProposalId) as
        | {
            source_observation_id: string;
            status: string;
            superseded_at: string | null;
          }
        | undefined;
      if (existing === undefined) {
        throw new Error(`Current proposal "${existingProposalId}" does not exist.`);
      }
      if (existing.status !== "PROPOSED" || existing.superseded_at !== null) {
        throw new Error(`Assignment "${existingProposalId}" is not a current proposal.`);
      }
      if (existing.source_observation_id !== replacement.sourceObservationId) {
        throw new Error("Replacement proposal must belong to the same SourceObservation.");
      }
      this.db.prepare(`
        UPDATE observation_cluster_assignments
        SET superseded_at = ? WHERE id = ?
      `).run(supersededAt.toISOString(), existingProposalId);
      insertObservationClusterAssignment(this.db, replacement);
    });
    replace();
  }

  private findCurrent(
    sourceObservationId: SourceObservationId,
    statusPredicate: string,
    label: string,
  ): ObservationClusterAssignment | null {
    const rows = this.db.prepare(`
      SELECT ${columns}
      FROM observation_cluster_assignments
      WHERE source_observation_id = ?
        AND superseded_at IS NULL
        AND ${statusPredicate}
      ORDER BY evaluated_at, id
    `).all(sourceObservationId) as AssignmentRow[];
    if (rows.length > 1) {
      throw new Error(
        `Observation-cluster assignment integrity error: multiple ${label} exist for SourceObservation "${sourceObservationId}".`,
      );
    }
    return rows[0] === undefined ? null : mapRow(rows[0]);
  }
}

export function insertObservationClusterAssignment(
  db: Database.Database,
  assignment: ObservationClusterAssignment,
): void {
  validateAssignment(assignment);
  try {
    db.prepare(`
      INSERT INTO observation_cluster_assignments (
        id, source_observation_id, employer_cluster_id, confidence, status,
        algorithm, algorithm_version, evaluated_at, explanation, superseded_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
    `).run(
      assignment.id,
      assignment.sourceObservationId,
      assignment.employerClusterId,
      assignment.confidence,
      assignment.status,
      assignment.algorithm,
      assignment.algorithmVersion,
      assignment.evaluatedAt.toISOString(),
      assignment.explanation ?? null,
    );
  } catch (error) {
    if (isDuplicateIdError(error)) {
      throw new Error(
        `ObservationClusterAssignment with id "${assignment.id}" already exists.`,
      );
    }
    if (isCurrentStateConstraintError(error)) {
      if (assignment.status === "ACCEPTED" || assignment.status === "USER_CONFIRMED") {
        throw new EffectiveAssignmentConflictError(assignment.sourceObservationId);
      }
      if (assignment.status === "PROPOSED") {
        throw new CurrentProposalConflictError(assignment.sourceObservationId);
      }
    }
    throw error;
  }
}

function mapRow(row: AssignmentRow): ObservationClusterAssignment {
  const assignment: ObservationClusterAssignment = {
    id: row.id,
    sourceObservationId: row.source_observation_id,
    employerClusterId: row.employer_cluster_id,
    confidence: row.confidence,
    status: row.status as ObservationClusterAssignmentStatus,
    algorithm: row.algorithm,
    algorithmVersion: row.algorithm_version,
    evaluatedAt: parseDate(row.evaluated_at),
    ...(row.explanation === null ? {} : { explanation: row.explanation }),
  };
  validateAssignment(assignment);
  if (!(["PROPOSED", "ACCEPTED", "REJECTED", "USER_CONFIRMED"] as const)
    .includes(assignment.status)) {
    throw new Error("Stored observation-cluster assignment status is invalid.");
  }
  return assignment;
}

function validateAssignment(assignment: ObservationClusterAssignment): void {
  if (
    !Number.isFinite(assignment.confidence) ||
    assignment.confidence < 0 ||
    assignment.confidence > 1
  ) {
    throw new Error("Observation-cluster assignment confidence must be between 0 and 1.");
  }
  if (assignment.algorithm.trim().length === 0) {
    throw new Error("Recognition algorithm is required.");
  }
  if (assignment.algorithmVersion.trim().length === 0) {
    throw new Error("Recognition algorithm version is required.");
  }
  if (Number.isNaN(assignment.evaluatedAt.getTime())) {
    throw new Error("Observation-cluster assignment evaluatedAt must be a valid date.");
  }
}

function parseDate(value: string): Date {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error("Stored observation-cluster assignment evaluatedAt is invalid.");
  }
  return date;
}

function isDuplicateIdError(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message.includes(
      "UNIQUE constraint failed: observation_cluster_assignments.id",
    )
  );
}

function isCurrentStateConstraintError(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message.includes(
      "UNIQUE constraint failed: observation_cluster_assignments.source_observation_id",
    )
  );
}
