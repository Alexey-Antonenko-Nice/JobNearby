import Database from "better-sqlite3";

import { CompositeVacancyEvidenceExtractor } from "../../application/evidence/CompositeVacancyEvidenceExtractor.js";
import { DirectFieldVacancyEvidenceExtractor } from "../../application/evidence/DirectFieldVacancyEvidenceExtractor.js";
import { ExplicitEmployerCharacteristicExtractor } from "../../application/evidence/ExplicitEmployerCharacteristicExtractor.js";
import { ExplicitTextVacancyEvidenceExtractor } from "../../application/evidence/ExplicitTextVacancyEvidenceExtractor.js";
import { CoreVacancyHeaderFactsExtractor } from "../../application/evidence/CoreVacancyHeaderFactsExtractor.js";
import type { AcquisitionContext } from "../../domain/acquisition/AcquisitionContext.js";
import type { SourceObservation } from "../../domain/capture/SourceObservation.js";
import { fromSelectedVacancyContext } from "../../domain/evidence/VacancyEvidenceInput.js";
import { SqliteSourceObservationRepository } from "../persistence/SqliteSourceObservationRepository.js";

interface ObservationRow {
  readonly id: string;
  readonly observed_at: string;
  readonly source_type: string;
  readonly source_name: string;
  readonly source_url: string | null;
  readonly external_id: string | null;
  readonly title: string | null;
  readonly displayed_company_name: string | null;
  readonly location_text: string | null;
  readonly metadata_json: string;
  readonly canonical_vacancy_id: string | null;
  readonly canonicalization_status: string | null;
  readonly employer_cluster_id: string | null;
  readonly employer_cluster_status: string | null;
  readonly assignment_status: string | null;
  readonly assignment_confidence: number | null;
  readonly assignment_algorithm: string | null;
  readonly assignment_algorithm_version: string | null;
  readonly assignment_explanation: string | null;
  readonly review_required: number;
}

interface CanonicalFieldRow {
  readonly field_name: string;
  readonly status: string;
  readonly value_json: string | null;
  readonly confidence: number | null;
  readonly alternatives: string | null;
}

interface CanonicalOrganizationRow {
  readonly role: string;
  readonly organization_id: string | null;
  readonly employer_cluster_id: string | null;
  readonly raw_name: string | null;
  readonly confidence: number | null;
}

const continuityAlgorithm = "canonical-vacancy-employer-continuity";

function parseLimit(argument: string | undefined): number {
  if (argument === undefined) return 50;
  const limit = Number(argument);
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
    throw new Error("Limit must be an integer between 1 and 500.");
  }
  return limit;
}

function parseMetadata(value: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed !== null && typeof parsed === "object"
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function hasSelectedVacancyContext(metadata: Record<string, unknown>): boolean {
  return selectedVacancyContexts(metadata).length > 0;
}

function selectedVacancyContexts(metadata: Record<string, unknown>) {
  const acquisition = metadata.acquisition;
  if (!isRecord(acquisition) || !Array.isArray(acquisition.contexts)) return [];
  return acquisition.contexts.flatMap((context) => {
    if (!isRecord(context) || context.kind !== "SELECTED_VACANCY") return [];
    const text = typeof context.text === "string" ? context.text : undefined;
    const html = typeof context.html === "string" ? context.html : undefined;
    return [{
      kind: "SELECTED_VACANCY",
      text: text === undefined ? { exists: false } : {
        exists: true,
        length: text.length,
        preview: boundedTextPreview(text),
      },
      html: html === undefined ? { exists: false } : {
        exists: true,
        length: html.length,
      },
    }];
  });
}

function boundedTextPreview(text: string): string {
  const normalized = text.replace(/\s+/gu, " ").trim();
  return normalized.length <= 240 ? normalized : `${normalized.slice(0, 237)}...`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseJson(value: string | null): unknown {
  if (value === null) return null;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

async function main(): Promise<void> {
  const databasePath = process.argv[2] ?? "job-nearby.sqlite";
  const limit = parseLimit(process.argv[3]);
  const db = new Database(databasePath, { readonly: true, fileMustExist: true });
  db.pragma("query_only = ON");

  try {
    const rows = db.prepare(`
      SELECT observation.id, observation.observed_at, observation.source_type,
        observation.source_name, observation.source_url, observation.external_id,
        observation.title, observation.displayed_company_name, observation.location_text,
        observation.metadata_json, membership.canonical_vacancy_id,
        canonical.canonicalization_status, assignment.employer_cluster_id,
        cluster.status AS employer_cluster_status, assignment.status AS assignment_status,
        assignment.confidence AS assignment_confidence,
        assignment.algorithm AS assignment_algorithm,
        assignment.algorithm_version AS assignment_algorithm_version,
        assignment.explanation AS assignment_explanation,
        EXISTS (
          SELECT 1
          FROM observation_cluster_assignments AS proposal
          WHERE proposal.source_observation_id = observation.id
            AND proposal.superseded_at IS NULL
            AND proposal.status = 'PROPOSED'
        ) AS review_required
      FROM source_observations AS observation
      LEFT JOIN canonical_vacancy_source_observations AS membership
        ON membership.source_observation_id = observation.id
      LEFT JOIN canonical_vacancies AS canonical
        ON canonical.id = membership.canonical_vacancy_id
      LEFT JOIN observation_cluster_assignments AS assignment
        ON assignment.source_observation_id = observation.id
        AND assignment.superseded_at IS NULL
        AND assignment.status IN ('ACCEPTED', 'USER_CONFIRMED')
      LEFT JOIN employer_clusters AS cluster
        ON cluster.id = assignment.employer_cluster_id
      ORDER BY observation.observed_at DESC, observation.id DESC
      LIMIT ?
    `).all(limit) as ObservationRow[];
    const sourceObservations = new SqliteSourceObservationRepository(db);
    const evidenceExtractor = new CompositeVacancyEvidenceExtractor([
      new DirectFieldVacancyEvidenceExtractor(),
      new ExplicitTextVacancyEvidenceExtractor(),
      new ExplicitEmployerCharacteristicExtractor(),
      new CoreVacancyHeaderFactsExtractor(),
    ]);
    const canonicalIds = [...new Set(rows.flatMap((row) =>
      row.canonical_vacancy_id === null ? [] : [row.canonical_vacancy_id],
    ))];
    const membersByCanonical = new Map<string, string[]>();
    const fieldsByCanonical = new Map<string, CanonicalFieldRow[]>();
    const organizationsByCanonical = new Map<string, CanonicalOrganizationRow[]>();

    for (const canonicalVacancyId of canonicalIds) {
      membersByCanonical.set(canonicalVacancyId, (db.prepare(`
        SELECT source_observation_id
        FROM canonical_vacancy_source_observations
        WHERE canonical_vacancy_id = ?
        ORDER BY observation_order
      `).all(canonicalVacancyId) as Array<{ source_observation_id: string }>)
        .map(({ source_observation_id }) => source_observation_id));
      fieldsByCanonical.set(canonicalVacancyId, db.prepare(`
        SELECT field.field_name, field.status, field.value_json, field.confidence,
          json_group_array(alternative.value_json) AS alternatives
        FROM canonical_vacancy_fields AS field
        LEFT JOIN canonical_vacancy_field_alternatives AS alternative
          ON alternative.canonical_vacancy_id = field.canonical_vacancy_id
          AND alternative.field_name = field.field_name
        WHERE field.canonical_vacancy_id = ?
        GROUP BY field.field_name, field.status, field.value_json, field.confidence
        ORDER BY field.field_name
      `).all(canonicalVacancyId) as CanonicalFieldRow[]);
      organizationsByCanonical.set(canonicalVacancyId, db.prepare(`
        SELECT role, organization_id, employer_cluster_id, raw_name, confidence
        FROM canonical_vacancy_organization_relationships
        WHERE canonical_vacancy_id = ?
        ORDER BY relationship_order
      `).all(canonicalVacancyId) as CanonicalOrganizationRow[]);
    }

    const observations = await Promise.all(rows.map(async (row) => {
      const observation = await sourceObservations.findById(row.id);
      if (observation === null) {
        throw new Error(`SourceObservation "${row.id}" could not be reconstructed.`);
      }
      return reportObservation(row, observation, evidenceExtractor, membersByCanonical,
        fieldsByCanonical, organizationsByCanonical);
    }));
    const displayedCanonicalIds = new Set(canonicalIds);
    const aggregate = {
      recentSourceObservations: rows.length,
      canonicalVacanciesRepresented: displayedCanonicalIds.size,
      observationsGroupedIntoExistingCanonicalVacancy: rows.filter((row) =>
        row.canonical_vacancy_id !== null &&
        (membersByCanonical.get(row.canonical_vacancy_id)?.length ?? 0) > 1,
      ).length,
      unresolvedEmployerClusters: countClusters(db, "UNRESOLVED"),
      resolvedOrProbablyResolvedEmployerClusters:
        countClusters(db, "RESOLVED", "PROBABLY_RESOLVED"),
      reviewRequiredObservations: countReviewRequired(db, rows.map(({ id }) => id)),
      continuityInheritedEmployerAssignments: rows.filter(
        ({ assignment_algorithm }) => assignment_algorithm === continuityAlgorithm,
      ).length,
      observationsWithoutProviderExternalId: rows.filter(
        ({ external_id }) => external_id === null || external_id.trim().length === 0,
      ).length,
    };
    process.stdout.write(`${JSON.stringify({
      scope: { databasePath, limit, orderedBy: "observedAt descending" },
      aggregate,
      observations,
    }, null, 2)}\n`);
  } finally {
    db.close();
  }
}

async function reportObservation(
  row: ObservationRow,
  observation: SourceObservation,
  evidenceExtractor: CompositeVacancyEvidenceExtractor,
  membersByCanonical: ReadonlyMap<string, readonly string[]>,
  fieldsByCanonical: ReadonlyMap<string, readonly CanonicalFieldRow[]>,
  organizationsByCanonical: ReadonlyMap<string, readonly CanonicalOrganizationRow[]>,
) {
  const evidence = await evidenceExtractor.extract(evidenceInputForReport(observation));
  const canonicalId = row.canonical_vacancy_id;
  const fields = canonicalId === null ? [] : fieldsByCanonical.get(canonicalId) ?? [];
  const organizations = canonicalId === null
    ? []
    : organizationsByCanonical.get(canonicalId) ?? [];
  return {
    sourceObservation: {
      id: row.id, observedAt: row.observed_at, sourceType: row.source_type,
      provider: row.source_name, externalVacancyId: row.external_id,
      sourceUrl: row.source_url, title: row.title,
    },
    canonicalVacancy: canonicalId === null ? null : {
      id: canonicalId,
      hasMultipleSourceObservations: (membersByCanonical.get(canonicalId)?.length ?? 0) > 1,
      sourceObservationIds: membersByCanonical.get(canonicalId) ?? [],
      canonicalizationStatus: row.canonicalization_status,
      fields: fields.map((field) => ({
        name: field.field_name, status: field.status, value: parseJson(field.value_json),
        confidence: field.confidence, alternatives: parseJson(field.alternatives),
      })),
      employerRelationships: organizations.filter(({ role }) => role === "EMPLOYER"),
      organizationRelationships: organizations,
      ambiguitiesOrConflicts: fields.filter(({ status }) =>
        status === "AMBIGUOUS" || status === "CONFLICTED",
      ).map(({ field_name, status }) => ({ field: field_name, status })),
    },
    employer: row.employer_cluster_id === null ? {
      effectiveEmployerClusterId: null,
      reviewRequired: row.review_required === 1,
    } : {
      effectiveEmployerClusterId: row.employer_cluster_id,
      clusterStatus: row.employer_cluster_status,
      assignmentStatus: row.assignment_status,
      createdNewUnresolvedCluster: row.assignment_algorithm === "new-employer-cluster",
      matchedExistingCluster: row.assignment_algorithm === "evidence-based-employer-cluster-matcher",
      inheritedThroughCanonicalVacancyContinuity: row.assignment_algorithm === continuityAlgorithm,
      reviewRequired: row.review_required === 1,
      assignmentConfidence: row.assignment_confidence,
      assignmentAlgorithm: row.assignment_algorithm,
      assignmentAlgorithmVersion: row.assignment_algorithm_version,
      explanation: row.assignment_explanation,
    },
    acquisitionAndExtraction: {
      selectedVacancyContextCaptured: hasSelectedVacancyContext(parseMetadata(row.metadata_json)),
      selectedVacancyContexts: selectedVacancyContexts(parseMetadata(row.metadata_json)),
      providerExternalIdExtraction: row.external_id === null ? null : {
        provider: row.source_name, externalVacancyId: row.external_id,
        extractionMethod: "DIRECT_FIELD",
      },
      employerEvidence: {
        organizations: evidence.organizations.slice(0, 10),
        employerCharacteristics: evidence.employerCharacteristics,
      },
      vacancyEvidence: {
        titles: evidence.vacancyTitles.slice(0, 10),
        locations: evidence.locations.slice(0, 10),
        engagements: evidence.engagements.slice(0, 10),
        workModes: evidence.workModes.slice(0, 10),
        compensations: evidence.compensations.slice(0, 10),
        externalIdentifiers: evidence.externalIdentifiers,
      },
    },
  };
}

function evidenceInputForReport(observation: SourceObservation) {
  const acquisition = observation.metadata.acquisition;
  if (!isRecord(acquisition) || !Array.isArray(acquisition.contexts)) {
    return observation;
  }
  const selected = acquisition.contexts.filter(
    (context): context is AcquisitionContext =>
      isRecord(context) && context.kind === "SELECTED_VACANCY",
  );
  if (selected.length === 0) return observation;
  if (selected.length > 1) {
    throw new Error(
      `SourceObservation "${observation.id}" has multiple selected vacancy acquisition contexts.`,
    );
  }
  return fromSelectedVacancyContext(observation, selected[0]!);
}

function countClusters(db: Database.Database, ...statuses: readonly string[]): number {
  const placeholders = statuses.map(() => "?").join(", ");
  const row = db.prepare(`SELECT COUNT(*) AS count FROM employer_clusters WHERE status IN (${placeholders})`)
    .get(...statuses) as { count: number };
  return row.count;
}

function countReviewRequired(db: Database.Database, observationIds: readonly string[]): number {
  if (observationIds.length === 0) return 0;
  const placeholders = observationIds.map(() => "?").join(", ");
  const row = db.prepare(`
    SELECT COUNT(DISTINCT source_observation_id) AS count
    FROM observation_cluster_assignments
    WHERE source_observation_id IN (${placeholders})
      AND superseded_at IS NULL AND status = 'PROPOSED'
  `).get(...observationIds) as { count: number };
  return row.count;
}

void main();
