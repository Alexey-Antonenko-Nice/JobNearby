import { ContactError } from "../../domain/user/Contact.js";
import { requireSelectableContact, resolveContact } from "./sqliteContactReferences.js";
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

  async appendRequested(event:UserVacancyInteractionEvent,requestId:string,fingerprint:string):Promise<UserVacancyInteractionEvent> {
    return this.db.transaction(()=>{
      const old=this.db.prepare("SELECT event_id,fingerprint FROM interaction_requests WHERE request_id=?").get(requestId) as {event_id:string;fingerprint:string}|undefined;
      if(old){if(old.fingerprint!==fingerprint)throw new ContactError("Interaction request ID was already used for different content.",409);return this.resolve(rowToEvent(this.db.prepare("SELECT * FROM user_vacancy_interaction_events WHERE id=?").get(old.event_id) as InteractionRow));}
      this.insert(event);
      this.db.prepare("INSERT INTO interaction_requests VALUES(?,?,?,?)").run(requestId,event.id,event.canonicalVacancyId,fingerprint);
      return this.resolve(event);
    }).immediate();
  }
  async append(event: UserVacancyInteractionEvent): Promise<void> {
    this.db.transaction(()=>this.insert(event)).immediate();
  }
  private resolve(event:UserVacancyInteractionEvent):UserVacancyInteractionEvent {
    const reference=this.db.prepare("SELECT contact_id FROM interaction_contact_references WHERE event_id=?").get(event.id) as {contact_id:string}|undefined;
    return reference?{...event,contactId:reference.contact_id,contact:resolveContact(this.db,reference.contact_id)}:event;
  }
  private insert(event: UserVacancyInteractionEvent): void {
    const validated = createUserVacancyInteractionEvent(event);
    try {
      if(validated.contactId!==undefined)requireSelectableContact(this.db,validated.canonicalVacancyId,validated.contactId);
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
      if(validated.contactId!==undefined)this.db.prepare("INSERT INTO interaction_contact_references VALUES(?,?,?)").run(validated.id,validated.canonicalVacancyId,validated.contactId);
    } catch (error) {
      if (isConstraint(error, "user_vacancy_interaction_events.id")) {
        throw new Error(`User vacancy interaction event "${validated.id}" already exists.`, { cause: error });
      }
      throw error;
    }
  }

  async findByCanonicalVacancyIds(ids: readonly string[]) {
    if (ids.length === 0) return [];
    const rows = this.db.prepare(`
      SELECT id, canonical_vacancy_id, event_type, occurred_at, recorded_at, metadata_json
      FROM user_vacancy_interaction_events
      WHERE canonical_vacancy_id IN (SELECT value FROM json_each(?))
      ORDER BY occurred_at, recorded_at, id
    `).all(JSON.stringify([...new Set(ids)])) as InteractionRow[];
    return rows.map(row=>this.resolve(rowToEvent(row)));
  }

  async findByCanonicalVacancyId(canonicalVacancyId: string) {
    const rows = this.db.prepare(`
      SELECT id, canonical_vacancy_id, event_type, occurred_at, recorded_at, metadata_json
      FROM user_vacancy_interaction_events
      WHERE canonical_vacancy_id = ?
      ORDER BY occurred_at, recorded_at, id
    `).all(canonicalVacancyId) as InteractionRow[];
    return rows.map(row=>this.resolve(rowToEvent(row)));
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
