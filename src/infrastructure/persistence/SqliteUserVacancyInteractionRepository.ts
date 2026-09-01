import type Database from "better-sqlite3";

import {
  createUserVacancyInteractionEvent,
  type UserVacancyInteractionEvent,
  type UserVacancyInteractionType,
} from "../../domain/user/UserVacancyInteractionEvent.js";
import type { UserVacancyInteractionRepository } from "../../domain/user/UserVacancyInteractionRepository.js";

interface InteractionRow {
  readonly id: string;
  readonly canonical_vacancy_id: string;
  readonly event_type: UserVacancyInteractionType;
  readonly occurred_at: string;
  readonly recorded_at: string;
  readonly metadata_json: string | null;
}

export class SqliteUserVacancyInteractionRepository
  implements UserVacancyInteractionRepository {
  constructor(private readonly db: Database.Database) {}

  async append(event: UserVacancyInteractionEvent): Promise<void> {
    const validated = createUserVacancyInteractionEvent(event);
    try {
      this.db.prepare(`
        INSERT INTO user_vacancy_interaction_events (
          id, canonical_vacancy_id, event_type, occurred_at, recorded_at, metadata_json
        ) VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        validated.id,
        validated.canonicalVacancyId,
        validated.type,
        validated.occurredAt.toISOString(),
        validated.recordedAt.toISOString(),
        validated.metadata === undefined ? null : JSON.stringify(validated.metadata),
      );
    } catch (error) {
      if (isConstraint(error, "user_vacancy_interaction_events.id")) {
        throw new Error(`User vacancy interaction event "${validated.id}" already exists.`, { cause: error });
      }
      throw error;
    }
  }

  async findByCanonicalVacancyId(canonicalVacancyId: string) {
    const rows = this.db.prepare(`
      SELECT id, canonical_vacancy_id, event_type, occurred_at, recorded_at, metadata_json
      FROM user_vacancy_interaction_events
      WHERE canonical_vacancy_id = ?
      ORDER BY occurred_at, recorded_at, id
    `).all(canonicalVacancyId) as InteractionRow[];
    return rows.map(rowToEvent);
  }
}

function rowToEvent(row: InteractionRow): UserVacancyInteractionEvent {
  const metadata: unknown = row.metadata_json === null ? undefined : JSON.parse(row.metadata_json);
  const event = {
    id: row.id,
    canonicalVacancyId: row.canonical_vacancy_id,
    type: row.event_type,
    occurredAt: new Date(row.occurred_at),
    recordedAt: new Date(row.recorded_at),
    ...(metadata === undefined ? {} : { metadata }),
  } as UserVacancyInteractionEvent;
  return createUserVacancyInteractionEvent(event);
}

function isConstraint(error: unknown, target: string): boolean {
  return error instanceof Error && error.message.includes("UNIQUE constraint failed")
    && error.message.includes(target);
}
