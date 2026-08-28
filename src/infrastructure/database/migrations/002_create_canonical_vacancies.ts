import type Database from "better-sqlite3";

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
];

const organizationRoles = [
  "DISPLAYED_COMPANY",
  "EMPLOYER",
  "RECRUITER",
  "STAFFING_AGENCY",
  "CONSULTANCY",
  "CLIENT",
  "PROJECT_CUSTOMER",
  "UNKNOWN",
];

function quoted(values: readonly string[]): string {
  return values.map((value) => `'${value}'`).join(", ");
}

export const migration002 = {
  version: 2,
  name: "create_canonical_vacancies",

  up(db: Database.Database): void {
    db.exec(`
      CREATE TABLE canonical_vacancies (
        id TEXT PRIMARY KEY,
        canonicalization_status TEXT NOT NULL
          CHECK (canonicalization_status IN ('PARTIAL', 'USABLE', 'CONFLICTED')),
        derivation_algorithm TEXT NOT NULL,
        derivation_algorithm_version TEXT NOT NULL,
        derived_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE canonical_vacancy_source_observations (
        canonical_vacancy_id TEXT NOT NULL,
        source_observation_id TEXT NOT NULL,
        observation_order INTEGER NOT NULL CHECK (observation_order >= 0),
        PRIMARY KEY (canonical_vacancy_id, source_observation_id),
        UNIQUE (canonical_vacancy_id, observation_order),
        FOREIGN KEY (canonical_vacancy_id)
          REFERENCES canonical_vacancies(id) ON DELETE CASCADE
      );

      CREATE INDEX idx_canonical_vacancy_source_observation
        ON canonical_vacancy_source_observations(source_observation_id);

      CREATE TABLE canonical_vacancy_evidence_references (
        canonical_vacancy_id TEXT NOT NULL,
        evidence_ref_id TEXT NOT NULL,
        source_observation_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        evidence_order INTEGER NOT NULL CHECK (evidence_order >= 0),
        PRIMARY KEY (canonical_vacancy_id, evidence_ref_id),
        UNIQUE (canonical_vacancy_id, evidence_order),
        FOREIGN KEY (canonical_vacancy_id, source_observation_id)
          REFERENCES canonical_vacancy_source_observations(
            canonical_vacancy_id,
            source_observation_id
          ) ON DELETE CASCADE
      );

      CREATE INDEX idx_canonical_vacancy_evidence_source_observation
        ON canonical_vacancy_evidence_references(source_observation_id);

      CREATE TABLE canonical_vacancy_fields (
        canonical_vacancy_id TEXT NOT NULL,
        field_name TEXT NOT NULL CHECK (field_name IN (${quoted(fieldNames)})),
        status TEXT NOT NULL
          CHECK (status IN ('RESOLVED', 'PARTIAL', 'AMBIGUOUS', 'CONFLICTED', 'UNKNOWN')),
        value_json TEXT,
        confidence REAL CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
        derivation_algorithm TEXT NOT NULL,
        derivation_algorithm_version TEXT NOT NULL,
        derived_at TEXT NOT NULL,
        PRIMARY KEY (canonical_vacancy_id, field_name),
        FOREIGN KEY (canonical_vacancy_id)
          REFERENCES canonical_vacancies(id) ON DELETE CASCADE
      );

      CREATE TABLE canonical_vacancy_field_evidence (
        canonical_vacancy_id TEXT NOT NULL,
        field_name TEXT NOT NULL,
        association_kind TEXT NOT NULL
          CHECK (association_kind IN ('SUPPORTING', 'CONFLICTING')),
        evidence_order INTEGER NOT NULL CHECK (evidence_order >= 0),
        evidence_ref_id TEXT NOT NULL,
        PRIMARY KEY (
          canonical_vacancy_id,
          field_name,
          association_kind,
          evidence_order
        ),
        FOREIGN KEY (canonical_vacancy_id, field_name)
          REFERENCES canonical_vacancy_fields(canonical_vacancy_id, field_name)
          ON DELETE CASCADE,
        FOREIGN KEY (canonical_vacancy_id, evidence_ref_id)
          REFERENCES canonical_vacancy_evidence_references(
            canonical_vacancy_id,
            evidence_ref_id
          )
      );

      CREATE TABLE canonical_vacancy_field_alternatives (
        canonical_vacancy_id TEXT NOT NULL,
        field_name TEXT NOT NULL,
        alternative_order INTEGER NOT NULL CHECK (alternative_order >= 0),
        value_json TEXT NOT NULL,
        confidence REAL CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
        PRIMARY KEY (canonical_vacancy_id, field_name, alternative_order),
        FOREIGN KEY (canonical_vacancy_id, field_name)
          REFERENCES canonical_vacancy_fields(canonical_vacancy_id, field_name)
          ON DELETE CASCADE
      );

      CREATE TABLE canonical_vacancy_alternative_evidence (
        canonical_vacancy_id TEXT NOT NULL,
        field_name TEXT NOT NULL,
        alternative_order INTEGER NOT NULL,
        evidence_order INTEGER NOT NULL CHECK (evidence_order >= 0),
        evidence_ref_id TEXT NOT NULL,
        PRIMARY KEY (
          canonical_vacancy_id,
          field_name,
          alternative_order,
          evidence_order
        ),
        FOREIGN KEY (canonical_vacancy_id, field_name, alternative_order)
          REFERENCES canonical_vacancy_field_alternatives(
            canonical_vacancy_id,
            field_name,
            alternative_order
          ) ON DELETE CASCADE,
        FOREIGN KEY (canonical_vacancy_id, evidence_ref_id)
          REFERENCES canonical_vacancy_evidence_references(
            canonical_vacancy_id,
            evidence_ref_id
          )
      );

      CREATE TABLE canonical_vacancy_organization_relationships (
        canonical_vacancy_id TEXT NOT NULL,
        relationship_order INTEGER NOT NULL CHECK (relationship_order >= 0),
        organization_id TEXT,
        employer_cluster_id TEXT,
        raw_name TEXT,
        role TEXT NOT NULL CHECK (role IN (${quoted(organizationRoles)})),
        confidence REAL CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
        derivation_algorithm TEXT NOT NULL,
        derivation_algorithm_version TEXT NOT NULL,
        derived_at TEXT NOT NULL,
        PRIMARY KEY (canonical_vacancy_id, relationship_order),
        CHECK (
          organization_id IS NOT NULL OR
          employer_cluster_id IS NOT NULL OR
          raw_name IS NOT NULL
        ),
        FOREIGN KEY (canonical_vacancy_id)
          REFERENCES canonical_vacancies(id) ON DELETE CASCADE
      );

      CREATE INDEX idx_canonical_vacancy_relationship_employer_cluster
        ON canonical_vacancy_organization_relationships(employer_cluster_id);

      CREATE INDEX idx_canonical_vacancy_relationship_organization
        ON canonical_vacancy_organization_relationships(organization_id);

      CREATE TABLE canonical_vacancy_organization_evidence (
        canonical_vacancy_id TEXT NOT NULL,
        relationship_order INTEGER NOT NULL,
        evidence_order INTEGER NOT NULL CHECK (evidence_order >= 0),
        evidence_ref_id TEXT NOT NULL,
        PRIMARY KEY (
          canonical_vacancy_id,
          relationship_order,
          evidence_order
        ),
        FOREIGN KEY (canonical_vacancy_id, relationship_order)
          REFERENCES canonical_vacancy_organization_relationships(
            canonical_vacancy_id,
            relationship_order
          ) ON DELETE CASCADE,
        FOREIGN KEY (canonical_vacancy_id, evidence_ref_id)
          REFERENCES canonical_vacancy_evidence_references(
            canonical_vacancy_id,
            evidence_ref_id
          )
      );
    `);
  },
} as const;
