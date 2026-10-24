import type Database from "better-sqlite3";

import { EMPLOYER_IDENTITY_ALGORITHM } from "../../domain/user/EmployerIdentityReview.js";

/** Canonical vacancies that carry any recorded human decision or interaction. */
export function sqliteCanonicalHumanState(database: Database.Database) {
  return async (canonicalVacancyIds: readonly string[]): Promise<ReadonlySet<string>> => {
    const rows = database.prepare(`
      SELECT canonical_vacancy_id AS id FROM user_vacancy_interaction_events
        WHERE canonical_vacancy_id IN (SELECT value FROM json_each(?))
      UNION SELECT canonical_vacancy_id FROM vacancy_organization_role_decisions
        WHERE canonical_vacancy_id IN (SELECT value FROM json_each(?))
      UNION SELECT m.canonical_vacancy_id FROM canonical_vacancy_source_observations m
        JOIN observation_cluster_assignments a ON a.source_observation_id = m.source_observation_id
        WHERE m.canonical_vacancy_id IN (SELECT value FROM json_each(?))
          AND (a.status = 'USER_CONFIRMED' OR a.algorithm = ?)
    `).all(JSON.stringify(canonicalVacancyIds), JSON.stringify(canonicalVacancyIds), JSON.stringify(canonicalVacancyIds), EMPLOYER_IDENTITY_ALGORITHM) as { id: string }[];
    return new Set(rows.map((row) => row.id));
  };
}
