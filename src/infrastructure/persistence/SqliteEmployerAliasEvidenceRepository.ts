import type Database from "better-sqlite3";
import { validateEmployerAliasEvidence, type EmployerAliasEvidence, type EmployerAliasEvidenceRepository } from "../../domain/recognition/EmployerAliasEvidence.js";

interface AliasRow {
  id: string; alias_name: string; normalized_alias_name: string; employer_cluster_id: string;
  source_type: "USER_CONFIRMED_ALIAS"; source_assignment_id: string; created_at: string; explanation: string;
}

export class SqliteEmployerAliasEvidenceRepository implements EmployerAliasEvidenceRepository {
  constructor(private readonly db: Database.Database) {}
  async save(evidence: EmployerAliasEvidence): Promise<void> { insertEmployerAliasEvidence(this.db, evidence); }
  async findActiveByNormalizedName(name: string): Promise<readonly EmployerAliasEvidence[]> {
    return (this.db.prepare(`SELECT e.* FROM employer_alias_evidence e
      JOIN observation_cluster_assignments a ON a.id = e.source_assignment_id
      WHERE e.normalized_alias_name = ? AND a.status = 'USER_CONFIRMED'
        AND a.superseded_at IS NULL AND a.employer_cluster_id = e.employer_cluster_id
      ORDER BY e.employer_cluster_id, e.created_at, e.id`).all(name) as AliasRow[]).map(mapRow);
  }
  async findByClusterId(id: string): Promise<readonly EmployerAliasEvidence[]> {
    return (this.db.prepare("SELECT * FROM employer_alias_evidence WHERE employer_cluster_id = ? ORDER BY created_at, id").all(id) as AliasRow[]).map(mapRow);
  }
}

export function insertEmployerAliasEvidence(db: Database.Database, evidence: EmployerAliasEvidence): void {
  validateEmployerAliasEvidence(evidence);
  const proof = db.prepare("SELECT status, employer_cluster_id FROM observation_cluster_assignments WHERE id = ?").get(evidence.sourceAssignmentId) as { status: string; employer_cluster_id: string } | undefined;
  if (proof?.status !== "USER_CONFIRMED" || proof.employer_cluster_id !== evidence.employerClusterId) throw new Error("Alias evidence requires a matching human-confirmed assignment.");
  db.prepare(`INSERT INTO employer_alias_evidence
    (id, alias_name, normalized_alias_name, employer_cluster_id, source_type, source_assignment_id, created_at, explanation)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(employer_cluster_id, normalized_alias_name, source_assignment_id) DO NOTHING`).run(
      evidence.id, evidence.aliasName, evidence.normalizedAliasName, evidence.employerClusterId,
      evidence.sourceType, evidence.sourceAssignmentId, evidence.createdAt.toISOString(), evidence.explanation);
}

function mapRow(row: AliasRow): EmployerAliasEvidence {
  const evidence: EmployerAliasEvidence = { id: row.id, aliasName: row.alias_name, normalizedAliasName: row.normalized_alias_name, employerClusterId: row.employer_cluster_id, sourceType: row.source_type, sourceAssignmentId: row.source_assignment_id, createdAt: new Date(row.created_at), explanation: row.explanation };
  validateEmployerAliasEvidence(evidence);
  return evidence;
}
