import type Database from "better-sqlite3";

import type {
  EmployerMemoryPublicDataSource,
  EmployerMemoryPublicVacancy,
} from "../../application/user/EmployerMemoryPublicDataSource.js";
import type { EmployerClusterId } from "../../domain/recognition/EmployerCluster.js";
import type { CanonicalizationStatus, VacancyLocation, VacancyOrganizationRole } from "../../domain/vacancies/CanonicalVacancy.js";
import type { EmployerMemoryOrganizationRelationship } from "../../domain/user/EmployerMemoryView.js";

interface VacancyRow {
  readonly canonical_vacancy_id: string;
  readonly canonicalization_status: CanonicalizationStatus;
  readonly title_status: string | null;
  readonly title_json: string | null;
  readonly location_status: string | null;
  readonly location_json: string | null;
  readonly latest_observed_at: string | null;
  readonly source_observation_count: number;
}

interface RelationshipRow {
  readonly canonical_vacancy_id: string;
  readonly organization_id: string | null;
  readonly employer_cluster_id: string | null;
  readonly raw_name: string | null;
  readonly role: VacancyOrganizationRole;
}

export class SqliteEmployerMemoryPublicDataSource implements EmployerMemoryPublicDataSource {
  constructor(private readonly db: Database.Database) {}

  async findByEmployerClusterId(
    employerClusterId: EmployerClusterId,
  ): Promise<readonly EmployerMemoryPublicVacancy[]> {
    const vacancies = this.db.prepare(`
      SELECT vacancy.id AS canonical_vacancy_id,
        vacancy.canonicalization_status,
        title.status AS title_status, title.value_json AS title_json,
        location.status AS location_status, location.value_json AS location_json,
        MAX(observation.observed_at) AS latest_observed_at,
        COUNT(observation.id) AS source_observation_count
      FROM canonical_vacancies AS vacancy
      LEFT JOIN canonical_vacancy_fields AS title
        ON title.canonical_vacancy_id = vacancy.id AND title.field_name = 'role'
      LEFT JOIN canonical_vacancy_fields AS location
        ON location.canonical_vacancy_id = vacancy.id AND location.field_name = 'location'
      LEFT JOIN canonical_vacancy_source_observations AS membership
        ON membership.canonical_vacancy_id = vacancy.id
      LEFT JOIN source_observations AS observation
        ON observation.id = membership.source_observation_id
      WHERE EXISTS (
        SELECT 1 FROM canonical_vacancy_organization_relationships AS employer
        WHERE employer.canonical_vacancy_id = vacancy.id
          AND employer.role = 'EMPLOYER'
          AND employer.employer_cluster_id = ?
      )
      GROUP BY vacancy.id, vacancy.canonicalization_status,
        title.status, title.value_json, location.status, location.value_json
    `).all(employerClusterId) as VacancyRow[];
    if (vacancies.length === 0) return [];

    const relationships = this.db.prepare(`
      SELECT relationship.canonical_vacancy_id, relationship.organization_id,
        relationship.employer_cluster_id, relationship.raw_name, relationship.role
      FROM canonical_vacancy_organization_relationships AS relationship
      WHERE EXISTS (
        SELECT 1 FROM canonical_vacancy_organization_relationships AS employer
        WHERE employer.canonical_vacancy_id = relationship.canonical_vacancy_id
          AND employer.role = 'EMPLOYER'
          AND employer.employer_cluster_id = ?
      )
      ORDER BY relationship.canonical_vacancy_id, relationship.relationship_order
    `).all(employerClusterId) as RelationshipRow[];

    return vacancies.map((row) => ({
      canonicalVacancyId: row.canonical_vacancy_id,
      canonicalizationStatus: row.canonicalization_status,
      title: readTitle(row.title_status, row.title_json),
      location: readLocation(row.location_status, row.location_json),
      latestObservedAt: row.latest_observed_at === null ? null : parseDate(row.latest_observed_at),
      sourceObservationCount: row.source_observation_count,
      organizationRelationships: relationships
        .filter(({ canonical_vacancy_id }) => canonical_vacancy_id === row.canonical_vacancy_id)
        .map(mapRelationship),
    }));
  }
}

function readTitle(status: string | null, value: string | null): string | null {
  if (status === null || status === "UNKNOWN" || value === null) return null;
  const parsed: unknown = JSON.parse(value);
  return isRecord(parsed) && typeof parsed.title === "string" ? parsed.title : null;
}

function readLocation(status: string | null, value: string | null): VacancyLocation | null {
  if (status === null || status === "UNKNOWN" || value === null) return null;
  const parsed: unknown = JSON.parse(value);
  return isRecord(parsed) ? parsed as VacancyLocation : null;
}

function mapRelationship(row: RelationshipRow): EmployerMemoryOrganizationRelationship {
  return {
    ...(row.organization_id === null ? {} : { organizationId: row.organization_id }),
    ...(row.employer_cluster_id === null ? {} : { employerClusterId: row.employer_cluster_id }),
    ...(row.raw_name === null ? {} : { rawName: row.raw_name }),
    role: row.role,
  };
}

function parseDate(value: string): Date {
  const result = new Date(value);
  if (Number.isNaN(result.getTime())) throw new Error("Stored source observation timestamp is invalid.");
  return result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
