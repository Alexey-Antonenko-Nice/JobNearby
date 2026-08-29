import type Database from "better-sqlite3";

import type {
  EmployerCluster,
  EmployerClusterId,
  EmployerClusterStatus,
} from "../../domain/recognition/EmployerCluster.js";
import type {
  EmployerClusterRepository,
  EmployerClusterSearchCriteria,
} from "../../domain/recognition/EmployerClusterRepository.js";
import { normalizeEmployerClusterSearchHint } from "../../domain/recognition/normalizeEmployerClusterSearchHint.js";

interface EmployerClusterRow {
  id: string;
  status: string;
  created_at: string;
  updated_at: string;
  resolved_employer_id: string | null;
  primary_location_hint: string | null;
  display_label: string | null;
}

export class SqliteEmployerClusterRepository implements EmployerClusterRepository {
  constructor(private readonly db: Database.Database) {}

  async save(cluster: EmployerCluster): Promise<void> {
    insertEmployerCluster(this.db, cluster);
  }

  async findById(id: EmployerClusterId): Promise<EmployerCluster | null> {
    const row = this.db.prepare(`
      SELECT id, status, created_at, updated_at, resolved_employer_id,
        primary_location_hint, display_label
      FROM employer_clusters WHERE id = ?
    `).get(id) as EmployerClusterRow | undefined;
    return row === undefined ? null : mapRow(row);
  }

  async findCandidates(
    criteria: EmployerClusterSearchCriteria,
  ): Promise<readonly EmployerCluster[]> {
    const locationHint = normalizeEmployerClusterSearchHint(criteria.locationHint);
    const companyNameHint = normalizeEmployerClusterSearchHint(
      criteria.displayedCompanyNameHint,
    );
    const rows = this.db.prepare(`
      SELECT id, status, created_at, updated_at, resolved_employer_id,
        primary_location_hint, display_label
      FROM employer_clusters
      ORDER BY rowid
    `).all() as EmployerClusterRow[];

    return rows.map(mapRow).filter((cluster) => {
      const locationMatches =
        locationHint === undefined ||
        normalizeEmployerClusterSearchHint(cluster.primaryLocationHint)
          ?.includes(locationHint) === true;
      const companyNameMatches =
        companyNameHint === undefined ||
        normalizeEmployerClusterSearchHint(cluster.displayLabel)
          ?.includes(companyNameHint) === true;
      return locationMatches && companyNameMatches;
    });
  }
}

export function insertEmployerCluster(
  db: Database.Database,
  cluster: EmployerCluster,
): void {
  validateCluster(cluster);
  try {
    db.prepare(`
      INSERT INTO employer_clusters (
        id, status, created_at, updated_at, resolved_employer_id,
        primary_location_hint, display_label
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      cluster.id,
      cluster.status,
      cluster.createdAt.toISOString(),
      cluster.updatedAt.toISOString(),
      cluster.resolvedEmployerId ?? null,
      cluster.primaryLocationHint ?? null,
      cluster.displayLabel ?? null,
    );
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw new Error(`EmployerCluster with id "${cluster.id}" already exists.`);
    }
    throw error;
  }
}

function mapRow(row: EmployerClusterRow): EmployerCluster {
  const cluster: EmployerCluster = {
    id: row.id,
    status: row.status as EmployerClusterStatus,
    createdAt: parseDate(row.created_at, "createdAt"),
    updatedAt: parseDate(row.updated_at, "updatedAt"),
    ...(row.resolved_employer_id === null
      ? {}
      : { resolvedEmployerId: row.resolved_employer_id }),
    ...(row.primary_location_hint === null
      ? {}
      : { primaryLocationHint: row.primary_location_hint }),
    ...(row.display_label === null ? {} : { displayLabel: row.display_label }),
  };
  validateCluster(cluster);
  return cluster;
}

function validateCluster(cluster: EmployerCluster): void {
  if (!(["UNRESOLVED", "PROBABLY_RESOLVED", "RESOLVED", "CONFLICTED"] as const)
    .includes(cluster.status)) {
    throw new Error("Stored employer cluster status is invalid.");
  }
  if (cluster.status === "RESOLVED" && cluster.resolvedEmployerId === undefined) {
    throw new Error("A RESOLVED employer cluster requires resolvedEmployerId.");
  }
  if (cluster.status === "UNRESOLVED" && cluster.resolvedEmployerId !== undefined) {
    throw new Error("An UNRESOLVED employer cluster cannot have resolvedEmployerId.");
  }
  if (
    Number.isNaN(cluster.createdAt.getTime()) ||
    Number.isNaN(cluster.updatedAt.getTime())
  ) {
    throw new Error("Employer cluster timestamps must be valid dates.");
  }
}

function parseDate(value: string, label: string): Date {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Stored employer cluster ${label} is invalid.`);
  }
  return date;
}

function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Error && error.message.includes("UNIQUE constraint failed");
}
