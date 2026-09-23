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
  readonly sources_json: string;
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
    // Start from the indexed target memberships; resolve one effective identity per
    // canonical vacancy with the same human-first/source-order precedence as review.
    const membershipQuery = `WITH candidates AS (
      SELECT membership.canonical_vacancy_id AS id
      FROM observation_cluster_assignments assignment
      JOIN canonical_vacancy_source_observations membership
        ON membership.source_observation_id = assignment.source_observation_id
      WHERE assignment.employer_cluster_id = ? AND assignment.superseded_at IS NULL
        AND assignment.status IN ('ACCEPTED', 'USER_CONFIRMED')
      UNION
      SELECT canonical_vacancy_id FROM canonical_vacancy_organization_relationships
      WHERE role = 'EMPLOYER' AND employer_cluster_id = ?
    ), effective AS (
      SELECT candidates.id, (
        SELECT assignment.employer_cluster_id
        FROM canonical_vacancy_source_observations membership
        JOIN observation_cluster_assignments assignment
          ON assignment.source_observation_id = membership.source_observation_id
        WHERE membership.canonical_vacancy_id = candidates.id
          AND assignment.superseded_at IS NULL
          AND assignment.status IN ('ACCEPTED', 'USER_CONFIRMED')
        ORDER BY CASE WHEN assignment.status = 'USER_CONFIRMED' THEN 0 ELSE 1 END,
          CASE WHEN assignment.status = 'USER_CONFIRMED' THEN membership.observation_order END ASC,
          membership.observation_order DESC, assignment.id
        LIMIT 1
      ) AS cluster_id FROM candidates
    ), selected AS (
      SELECT id FROM effective WHERE cluster_id = ? OR (cluster_id IS NULL AND
        (SELECT COUNT(DISTINCT employer_cluster_id)
          FROM canonical_vacancy_organization_relationships
          WHERE canonical_vacancy_id = effective.id AND role = 'EMPLOYER'
            AND employer_cluster_id IS NOT NULL) = 1 AND EXISTS (
          SELECT 1 FROM canonical_vacancy_organization_relationships
          WHERE canonical_vacancy_id = effective.id AND role = 'EMPLOYER' AND employer_cluster_id = ?
        ))
    )`;
    const vacancies = this.db.prepare(`${membershipQuery}
      SELECT vacancy.id AS canonical_vacancy_id,
        vacancy.canonicalization_status,
        title.status AS title_status, title.value_json AS title_json,
        location.status AS location_status, location.value_json AS location_json,
        MAX(observation.observed_at) AS latest_observed_at,
        COUNT(observation.id) AS source_observation_count,
        json_group_array(DISTINCT observation.source_name) AS sources_json
      FROM canonical_vacancies AS vacancy
      LEFT JOIN canonical_vacancy_fields AS title
        ON title.canonical_vacancy_id = vacancy.id AND title.field_name = 'role'
      LEFT JOIN canonical_vacancy_fields AS location
        ON location.canonical_vacancy_id = vacancy.id AND location.field_name = 'location'
      LEFT JOIN canonical_vacancy_source_observations AS membership
        ON membership.canonical_vacancy_id = vacancy.id
      LEFT JOIN source_observations AS observation
        ON observation.id = membership.source_observation_id
      WHERE vacancy.id IN (SELECT id FROM selected)
      GROUP BY vacancy.id, vacancy.canonicalization_status,
        title.status, title.value_json, location.status, location.value_json
    `).all(employerClusterId, employerClusterId, employerClusterId, employerClusterId) as VacancyRow[];
    if (vacancies.length === 0) return [];

    const relationships = this.db.prepare(`
      SELECT relationship.canonical_vacancy_id, relationship.organization_id,
        relationship.employer_cluster_id, relationship.raw_name, relationship.role
      FROM canonical_vacancy_organization_relationships AS relationship
      WHERE relationship.canonical_vacancy_id IN (SELECT value FROM json_each(?))
      ORDER BY relationship.canonical_vacancy_id, relationship.relationship_order
    `).all(JSON.stringify(vacancies.map(({ canonical_vacancy_id }) => canonical_vacancy_id))) as RelationshipRow[];

    const relationshipsByVacancy = new Map<string, EmployerMemoryOrganizationRelationship[]>();
    for (const relationship of relationships) {
      const items = relationshipsByVacancy.get(relationship.canonical_vacancy_id) ?? [];
      items.push(mapRelationship(relationship));
      relationshipsByVacancy.set(relationship.canonical_vacancy_id, items);
    }
    return vacancies.map((row) => ({
      canonicalVacancyId: row.canonical_vacancy_id,
      canonicalizationStatus: row.canonicalization_status,
      title: readTitle(row.title_status, row.title_json),
      location: readLocation(row.location_status, row.location_json),
      latestObservedAt: row.latest_observed_at === null ? null : parseDate(row.latest_observed_at),
      sourceObservationCount: row.source_observation_count,
      sources: (JSON.parse(row.sources_json) as (string | null)[]).filter((name): name is string => name !== null).sort(),
      organizationRelationships: relationshipsByVacancy.get(row.canonical_vacancy_id) ?? [],
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
