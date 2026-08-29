import type Database from "better-sqlite3";

import { normalizeVacancyProviderNamespace } from "../../../domain/vacancy-identity/normalizeVacancyProviderNamespace.js";

interface ExistingMembershipRow {
  readonly canonical_vacancy_id: string;
  readonly source_observation_id: string;
  readonly source_name: string;
  readonly external_id: string | null;
}

export const migration004 = {
  version: 4,
  name: "create_canonical_vacancy_identity_claims",

  up(db: Database.Database): void {
    const conflictingMembership = db.prepare(`
      SELECT source_observation_id
      FROM canonical_vacancy_source_observations
      GROUP BY source_observation_id
      HAVING COUNT(DISTINCT canonical_vacancy_id) > 1
      LIMIT 1
    `).get() as { source_observation_id: string } | undefined;
    if (conflictingMembership !== undefined) {
      throw new Error(
        `Canonical vacancy migration integrity error: SourceObservation "${conflictingMembership.source_observation_id}" belongs to multiple canonical vacancies.`,
      );
    }

    db.exec(`
      CREATE UNIQUE INDEX idx_canonical_vacancy_single_observation_membership
        ON canonical_vacancy_source_observations(source_observation_id);

      CREATE TABLE canonical_vacancy_observation_claims (
        source_observation_id TEXT PRIMARY KEY,
        canonical_vacancy_id TEXT NOT NULL
      );

      CREATE INDEX idx_canonical_vacancy_observation_claim_canonical
        ON canonical_vacancy_observation_claims(canonical_vacancy_id);

      CREATE TABLE canonical_vacancy_exact_identity_claims (
        provider_namespace TEXT NOT NULL,
        external_id TEXT NOT NULL,
        canonical_vacancy_id TEXT NOT NULL,
        PRIMARY KEY (provider_namespace, external_id)
      );

      CREATE INDEX idx_canonical_vacancy_exact_identity_claim_canonical
        ON canonical_vacancy_exact_identity_claims(canonical_vacancy_id);
    `);

    const rows = db.prepare(`
      SELECT membership.canonical_vacancy_id,
        membership.source_observation_id,
        observation.source_name,
        observation.external_id
      FROM canonical_vacancy_source_observations AS membership
      INNER JOIN source_observations AS observation
        ON observation.id = membership.source_observation_id
      ORDER BY membership.canonical_vacancy_id, membership.observation_order
    `).all() as ExistingMembershipRow[];
    const insertObservationClaim = db.prepare(`
      INSERT INTO canonical_vacancy_observation_claims (
        source_observation_id, canonical_vacancy_id
      ) VALUES (?, ?)
    `);
    const insertIdentityClaim = db.prepare(`
      INSERT INTO canonical_vacancy_exact_identity_claims (
        provider_namespace, external_id, canonical_vacancy_id
      ) VALUES (?, ?, ?)
      ON CONFLICT(provider_namespace, external_id) DO NOTHING
    `);
    const findIdentityClaim = db.prepare(`
      SELECT canonical_vacancy_id
      FROM canonical_vacancy_exact_identity_claims
      WHERE provider_namespace = ? AND external_id = ?
    `);

    for (const row of rows) {
      insertObservationClaim.run(
        row.source_observation_id,
        row.canonical_vacancy_id,
      );
      if (row.external_id === null) continue;
      const provider = normalizeVacancyProviderNamespace(row.source_name);
      insertIdentityClaim.run(provider, row.external_id, row.canonical_vacancy_id);
      const claim = findIdentityClaim.get(provider, row.external_id) as {
        canonical_vacancy_id: string;
      };
      if (claim.canonical_vacancy_id !== row.canonical_vacancy_id) {
        throw new Error(
          `Canonical vacancy migration identity integrity error: provider "${provider}" and external ID "${row.external_id}" belong to multiple canonical vacancies.`,
        );
      }
    }
  },
} as const;
