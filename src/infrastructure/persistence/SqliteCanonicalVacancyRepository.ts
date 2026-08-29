import type Database from "better-sqlite3";

import {
  createCanonicalField,
  type CanonicalAlternative,
  type CanonicalField,
  type CanonicalFieldStatus,
} from "../../domain/vacancies/CanonicalField.js";
import type {
  CanonicalVacancy,
  CanonicalVacancyId,
  CanonicalizationStatus,
  VacancyOrganizationRelationship,
  VacancyOrganizationRole,
} from "../../domain/vacancies/CanonicalVacancy.js";
import type { CanonicalVacancyRepository } from "../../domain/vacancies/CanonicalVacancyRepository.js";
import { normalizeVacancyProviderNamespace } from "../../domain/vacancy-identity/normalizeVacancyProviderNamespace.js";
import { validateCanonicalVacancy } from "../../domain/vacancies/validateCanonicalVacancy.js";

const fieldNames = [
  "role",
  "publicationLanguages",
  "location",
  "workMode",
  "remoteEligibleCountries",
  "travel",
  "engagement",
  "compensation",
  "experienceRequirements",
  "educationRequirements",
  "skillRequirements",
  "languageRequirements",
  "functionalContexts",
  "industryContexts",
  "positionCount",
  "lifecycleStatus",
] as const;

type CanonicalFieldName = (typeof fieldNames)[number];

interface VacancyRow {
  id: string;
  canonicalization_status: string;
  derivation_algorithm: string;
  derivation_algorithm_version: string;
  derived_at: string;
}

interface FieldRow {
  field_name: string;
  status: string;
  value_json: string | null;
  confidence: number | null;
  derivation_algorithm: string;
  derivation_algorithm_version: string;
  derived_at: string;
}

interface EvidenceLinkRow {
  field_name: string;
  association_kind: "SUPPORTING" | "CONFLICTING";
  evidence_order: number;
  evidence_ref_id: string;
}

interface AlternativeRow {
  field_name: string;
  alternative_order: number;
  value_json: string;
  confidence: number | null;
}

interface AlternativeEvidenceRow {
  field_name: string;
  alternative_order: number;
  evidence_order: number;
  evidence_ref_id: string;
}

interface OrganizationRow {
  relationship_order: number;
  organization_id: string | null;
  employer_cluster_id: string | null;
  raw_name: string | null;
  role: string;
  confidence: number | null;
  derivation_algorithm: string;
  derivation_algorithm_version: string;
  derived_at: string;
}

export class SqliteCanonicalVacancyRepository
  implements CanonicalVacancyRepository
{
  constructor(private readonly db: Database.Database) {}

  async save(vacancy: CanonicalVacancy): Promise<void> {
    const validated = validateCanonicalVacancy(vacancy);
    const replaceProjection = this.db.transaction(() => {
      const now = new Date().toISOString();
      this.db.prepare(`
        INSERT INTO canonical_vacancies (
          id, canonicalization_status,
          derivation_algorithm, derivation_algorithm_version, derived_at,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          canonicalization_status = excluded.canonicalization_status,
          derivation_algorithm = excluded.derivation_algorithm,
          derivation_algorithm_version = excluded.derivation_algorithm_version,
          derived_at = excluded.derived_at,
          updated_at = excluded.updated_at
      `).run(
        validated.id,
        validated.canonicalizationStatus,
        validated.derivation.algorithm,
        validated.derivation.algorithmVersion,
        validated.derivation.derivedAt.toISOString(),
        now,
        now,
      );

      for (const table of [
        "canonical_vacancy_organization_relationships",
        "canonical_vacancy_fields",
        "canonical_vacancy_evidence_references",
        "canonical_vacancy_source_observations",
      ]) {
        this.db.prepare(`DELETE FROM ${table} WHERE canonical_vacancy_id = ?`).run(
          validated.id,
        );
      }

      const insertMembership = this.db.prepare(`
        INSERT INTO canonical_vacancy_source_observations (
          canonical_vacancy_id, source_observation_id, observation_order
        ) VALUES (?, ?, ?)
      `);
      validated.sourceObservationIds.forEach((observationId, index) => {
        insertMembership.run(validated.id, observationId, index);
      });

      const insertReference = this.db.prepare(`
        INSERT INTO canonical_vacancy_evidence_references (
          canonical_vacancy_id, evidence_ref_id, source_observation_id, kind,
          evidence_order
        ) VALUES (?, ?, ?, ?, ?)
      `);
      validated.evidenceReferences.forEach((reference, index) => {
        insertReference.run(
          validated.id,
          reference.id,
          reference.sourceObservationId,
          reference.kind,
          index,
        );
      });

      for (const fieldName of fieldNames) {
        this.saveField(validated.id, fieldName, validated[fieldName]);
      }
      validated.organizationRelationships.forEach((relationship, index) => {
        this.saveOrganizationRelationship(validated.id, index, relationship);
      });
    });
    replaceProjection();
  }

  async findById(id: CanonicalVacancyId): Promise<CanonicalVacancy | null> {
    const vacancyRow = this.db.prepare(`
      SELECT id, canonicalization_status, derivation_algorithm,
        derivation_algorithm_version, derived_at
      FROM canonical_vacancies WHERE id = ?
    `).get(id) as VacancyRow | undefined;
    if (vacancyRow === undefined) return null;

    const sourceObservationIds = (
      this.db.prepare(`
        SELECT source_observation_id
        FROM canonical_vacancy_source_observations
        WHERE canonical_vacancy_id = ?
        ORDER BY observation_order
      `).all(id) as Array<{ source_observation_id: string }>
    ).map(({ source_observation_id }) => source_observation_id);
    const evidenceReferences = (
      this.db.prepare(`
        SELECT evidence_ref_id, source_observation_id, kind
        FROM canonical_vacancy_evidence_references
        WHERE canonical_vacancy_id = ?
        ORDER BY evidence_order
      `).all(id) as Array<{
        evidence_ref_id: string;
        source_observation_id: string;
        kind: string;
      }>
    ).map((row) => ({
      id: row.evidence_ref_id,
      sourceObservationId: row.source_observation_id,
      kind: row.kind,
    }));

    const fields = this.loadFields(id);
    const organizationRelationships = this.loadOrganizationRelationships(id);
    const canonicalizationStatus = parseCanonicalizationStatus(
      vacancyRow.canonicalization_status,
    );

    return validateCanonicalVacancy({
      id: vacancyRow.id,
      sourceObservationIds,
      evidenceReferences,
      role: fields.role as CanonicalVacancy["role"],
      publicationLanguages: fields.publicationLanguages as CanonicalVacancy["publicationLanguages"],
      location: fields.location as CanonicalVacancy["location"],
      workMode: fields.workMode as CanonicalVacancy["workMode"],
      remoteEligibleCountries: fields.remoteEligibleCountries as CanonicalVacancy["remoteEligibleCountries"],
      travel: fields.travel as CanonicalVacancy["travel"],
      engagement: fields.engagement as CanonicalVacancy["engagement"],
      compensation: fields.compensation as CanonicalVacancy["compensation"],
      experienceRequirements: fields.experienceRequirements as CanonicalVacancy["experienceRequirements"],
      educationRequirements: fields.educationRequirements as CanonicalVacancy["educationRequirements"],
      skillRequirements: fields.skillRequirements as CanonicalVacancy["skillRequirements"],
      languageRequirements: fields.languageRequirements as CanonicalVacancy["languageRequirements"],
      functionalContexts: fields.functionalContexts as CanonicalVacancy["functionalContexts"],
      industryContexts: fields.industryContexts as CanonicalVacancy["industryContexts"],
      positionCount: fields.positionCount as CanonicalVacancy["positionCount"],
      lifecycleStatus: fields.lifecycleStatus as CanonicalVacancy["lifecycleStatus"],
      organizationRelationships,
      canonicalizationStatus,
      derivation: {
        algorithm: vacancyRow.derivation_algorithm,
        algorithmVersion: vacancyRow.derivation_algorithm_version,
        derivedAt: parseDate(vacancyRow.derived_at),
      },
    });
  }

  async findByExactSourceIdentity(
    providerNamespace: string,
    externalId: string,
  ): Promise<CanonicalVacancy | null> {
    const normalizedProvider = normalizeVacancyProviderNamespace(providerNamespace);
    const rows = this.db.prepare(`
      SELECT DISTINCT
        membership.canonical_vacancy_id,
        observation.source_name
      FROM canonical_vacancy_source_observations AS membership
      INNER JOIN source_observations AS observation
        ON observation.id = membership.source_observation_id
      WHERE observation.external_id = ?
    `).all(externalId) as Array<{
      canonical_vacancy_id: string;
      source_name: string;
    }>;
    const vacancyIds = [
      ...new Set(
        rows
          .filter(
            ({ source_name }) =>
              normalizeVacancyProviderNamespace(source_name) === normalizedProvider,
          )
          .map(({ canonical_vacancy_id }) => canonical_vacancy_id),
      ),
    ];

    if (vacancyIds.length > 1) {
      throw new Error(
        `Canonical vacancy identity integrity error: provider "${normalizedProvider}" and external ID "${externalId}" belong to multiple canonical vacancies.`,
      );
    }
    if (vacancyIds[0] === undefined) return null;

    const vacancy = await this.findById(vacancyIds[0]);
    if (vacancy === null) {
      throw new Error(
        `Canonical vacancy identity integrity error: canonical vacancy "${vacancyIds[0]}" could not be reconstructed.`,
      );
    }
    return vacancy;
  }

  private saveField(
    vacancyId: string,
    fieldName: CanonicalFieldName,
    field: CanonicalField<unknown>,
  ): void {
    this.db.prepare(`
      INSERT INTO canonical_vacancy_fields (
        canonical_vacancy_id, field_name, status, value_json, confidence,
        derivation_algorithm, derivation_algorithm_version, derived_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      vacancyId,
      fieldName,
      field.status,
      field.value === undefined ? null : JSON.stringify(field.value),
      field.confidence ?? null,
      field.derivation.algorithm,
      field.derivation.algorithmVersion,
      field.derivation.derivedAt.toISOString(),
    );

    const insertFieldEvidence = this.db.prepare(`
      INSERT INTO canonical_vacancy_field_evidence (
        canonical_vacancy_id, field_name, association_kind,
        evidence_order, evidence_ref_id
      ) VALUES (?, ?, ?, ?, ?)
    `);
    for (const [kind, evidenceIds] of [
      ["SUPPORTING", field.supportingEvidenceIds],
      ["CONFLICTING", field.conflictingEvidenceIds],
    ] as const) {
      evidenceIds.forEach((evidenceId, index) => {
        insertFieldEvidence.run(vacancyId, fieldName, kind, index, evidenceId);
      });
    }

    const insertAlternative = this.db.prepare(`
      INSERT INTO canonical_vacancy_field_alternatives (
        canonical_vacancy_id, field_name, alternative_order,
        value_json, confidence
      ) VALUES (?, ?, ?, ?, ?)
    `);
    const insertAlternativeEvidence = this.db.prepare(`
      INSERT INTO canonical_vacancy_alternative_evidence (
        canonical_vacancy_id, field_name, alternative_order,
        evidence_order, evidence_ref_id
      ) VALUES (?, ?, ?, ?, ?)
    `);
    (field.alternatives ?? []).forEach((alternative, alternativeIndex) => {
      insertAlternative.run(
        vacancyId,
        fieldName,
        alternativeIndex,
        JSON.stringify(alternative.value),
        alternative.confidence ?? null,
      );
      alternative.supportingEvidenceIds.forEach((evidenceId, evidenceIndex) => {
        insertAlternativeEvidence.run(
          vacancyId,
          fieldName,
          alternativeIndex,
          evidenceIndex,
          evidenceId,
        );
      });
    });
  }

  private saveOrganizationRelationship(
    vacancyId: string,
    relationshipOrder: number,
    relationship: VacancyOrganizationRelationship,
  ): void {
    this.db.prepare(`
      INSERT INTO canonical_vacancy_organization_relationships (
        canonical_vacancy_id, relationship_order,
        organization_id, employer_cluster_id, raw_name,
        role, confidence,
        derivation_algorithm, derivation_algorithm_version, derived_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      vacancyId,
      relationshipOrder,
      relationship.organizationId ?? null,
      relationship.employerClusterId ?? null,
      relationship.rawName ?? null,
      relationship.role,
      relationship.confidence ?? null,
      relationship.derivation.algorithm,
      relationship.derivation.algorithmVersion,
      relationship.derivation.derivedAt.toISOString(),
    );
    const insertEvidence = this.db.prepare(`
      INSERT INTO canonical_vacancy_organization_evidence (
        canonical_vacancy_id, relationship_order, evidence_order, evidence_ref_id
      ) VALUES (?, ?, ?, ?)
    `);
    relationship.supportingEvidenceIds.forEach((evidenceId, index) => {
      insertEvidence.run(vacancyId, relationshipOrder, index, evidenceId);
    });
  }

  private loadFields(vacancyId: string): Record<CanonicalFieldName, CanonicalField<unknown>> {
    const rows = this.db.prepare(`
      SELECT field_name, status, value_json, confidence,
        derivation_algorithm, derivation_algorithm_version, derived_at
      FROM canonical_vacancy_fields
      WHERE canonical_vacancy_id = ?
    `).all(vacancyId) as FieldRow[];
    if (
      rows.length !== fieldNames.length ||
      rows.some(({ field_name }) => !fieldNames.includes(field_name as CanonicalFieldName))
    ) {
      throw new Error("Stored canonical vacancy has an invalid field set.");
    }
    const fieldEvidence = this.db.prepare(`
      SELECT field_name, association_kind, evidence_order, evidence_ref_id
      FROM canonical_vacancy_field_evidence
      WHERE canonical_vacancy_id = ?
      ORDER BY field_name, association_kind, evidence_order
    `).all(vacancyId) as EvidenceLinkRow[];
    const alternatives = this.db.prepare(`
      SELECT field_name, alternative_order, value_json, confidence
      FROM canonical_vacancy_field_alternatives
      WHERE canonical_vacancy_id = ?
      ORDER BY field_name, alternative_order
    `).all(vacancyId) as AlternativeRow[];
    const alternativeEvidence = this.db.prepare(`
      SELECT field_name, alternative_order, evidence_order, evidence_ref_id
      FROM canonical_vacancy_alternative_evidence
      WHERE canonical_vacancy_id = ?
      ORDER BY field_name, alternative_order, evidence_order
    `).all(vacancyId) as AlternativeEvidenceRow[];

    const result = {} as Record<CanonicalFieldName, CanonicalField<unknown>>;
    for (const row of rows) {
      const fieldName = row.field_name as CanonicalFieldName;
      const fieldAlternatives = alternatives
        .filter((item) => item.field_name === fieldName)
        .map((alternative): CanonicalAlternative<unknown> => ({
          value: parseJson(alternative.value_json),
          supportingEvidenceIds: alternativeEvidence
            .filter(
              (item) =>
                item.field_name === fieldName &&
                item.alternative_order === alternative.alternative_order,
            )
            .map(({ evidence_ref_id }) => evidence_ref_id),
          ...(alternative.confidence === null
            ? {}
            : { confidence: alternative.confidence }),
        }));
      result[fieldName] = createCanonicalField({
        status: row.status as CanonicalFieldStatus,
        ...(row.value_json === null ? {} : { value: parseJson(row.value_json) }),
        ...(fieldAlternatives.length === 0 ? {} : { alternatives: fieldAlternatives }),
        supportingEvidenceIds: linkedEvidence(
          fieldEvidence,
          fieldName,
          "SUPPORTING",
        ),
        conflictingEvidenceIds: linkedEvidence(
          fieldEvidence,
          fieldName,
          "CONFLICTING",
        ),
        ...(row.confidence === null ? {} : { confidence: row.confidence }),
        derivation: {
          algorithm: row.derivation_algorithm,
          algorithmVersion: row.derivation_algorithm_version,
          derivedAt: parseDate(row.derived_at),
        },
      });
    }
    return result;
  }

  private loadOrganizationRelationships(
    vacancyId: string,
  ): VacancyOrganizationRelationship[] {
    const rows = this.db.prepare(`
      SELECT relationship_order, organization_id, employer_cluster_id, raw_name,
        role, confidence, derivation_algorithm,
        derivation_algorithm_version, derived_at
      FROM canonical_vacancy_organization_relationships
      WHERE canonical_vacancy_id = ?
      ORDER BY relationship_order
    `).all(vacancyId) as OrganizationRow[];
    const links = this.db.prepare(`
      SELECT relationship_order, evidence_ref_id
      FROM canonical_vacancy_organization_evidence
      WHERE canonical_vacancy_id = ?
      ORDER BY relationship_order, evidence_order
    `).all(vacancyId) as Array<{
      relationship_order: number;
      evidence_ref_id: string;
    }>;
    return rows.map((row) => ({
      ...(row.organization_id === null ? {} : { organizationId: row.organization_id }),
      ...(row.employer_cluster_id === null
        ? {}
        : { employerClusterId: row.employer_cluster_id }),
      ...(row.raw_name === null ? {} : { rawName: row.raw_name }),
      role: row.role as VacancyOrganizationRole,
      ...(row.confidence === null ? {} : { confidence: row.confidence }),
      supportingEvidenceIds: links
        .filter(({ relationship_order }) => relationship_order === row.relationship_order)
        .map(({ evidence_ref_id }) => evidence_ref_id),
      derivation: {
        algorithm: row.derivation_algorithm,
        algorithmVersion: row.derivation_algorithm_version,
        derivedAt: parseDate(row.derived_at),
      },
    }));
  }
}

function linkedEvidence(
  rows: readonly EvidenceLinkRow[],
  fieldName: CanonicalFieldName,
  associationKind: "SUPPORTING" | "CONFLICTING",
): string[] {
  return rows
    .filter(
      (row) =>
        row.field_name === fieldName &&
        row.association_kind === associationKind,
    )
    .map(({ evidence_ref_id }) => evidence_ref_id);
}

function parseCanonicalizationStatus(value: string): CanonicalizationStatus {
  if (!(["PARTIAL", "USABLE", "CONFLICTED"] as const).includes(
    value as CanonicalizationStatus,
  )) {
    throw new Error("Stored canonicalization status is invalid.");
  }
  return value as CanonicalizationStatus;
}

function parseJson(value: string): unknown {
  return JSON.parse(value) as unknown;
}

function parseDate(value: string): Date {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error("Stored canonical derivation date is invalid.");
  }
  return date;
}
