import type Database from "better-sqlite3";
import { conflict, missing, requireText, validateDecision } from "../../domain/publication-identity/MembershipDecision.js";
import { validatePublicationFamily, type PublicationFamily, type PublicationFamilyMembership, type PublicationFamilyRepository } from "../../domain/publication-identity/PublicationFamily.js";
import { SqliteMembershipLedger, activeSql, decisionKey, isActive } from "./identityMembershipLedger.js";

export class SqlitePublicationFamilyRepository implements PublicationFamilyRepository {
  private readonly ledger: SqliteMembershipLedger<PublicationFamilyMembership>;
  constructor(private readonly db: Database.Database) { this.ledger = new SqliteMembershipLedger(db, "family"); }
  async save(value: PublicationFamily): Promise<void> {
    validatePublicationFamily(value);
    this.db.transaction(() => {
      if (this.read(value.id)) conflict("PublicationFamily ID already exists.");
      this.db.prepare("INSERT INTO publication_families (id, created_at, updated_at, representative_title) VALUES (?, ?, ?, ?)")
        .run(value.id, value.createdAt.toISOString(), value.updatedAt.toISOString(), value.representativeTitle ?? null);
    }).immediate();
  }
  private read(id: string): PublicationFamily | null {
    const row = this.db.prepare("SELECT * FROM publication_families WHERE id = ?").get(id) as { id: string; created_at: string; updated_at: string; representative_title: string | null } | undefined;
    return row ? { id: row.id, createdAt: new Date(row.created_at), updatedAt: new Date(row.updated_at), ...(row.representative_title === null ? {} : { representativeTitle: row.representative_title }) } : null;
  }
  async findById(id: string) { return this.read(id); }
  async findBySourceObservationId(id: string) { const m = await this.findActiveMembershipBySourceObservationId(id); return m ? this.read(m.publicationFamilyId) : null; }
  async findMembersByFamilyId(id: string) { return this.ledger.list(`publication_family_id = ? AND ${activeSql}`, id); }
  async findMembershipById(id: string) { return this.ledger.byId(id); }
  async findMembershipHistoryBySourceObservationId(id: string) { return this.ledger.list("source_observation_id = ?", id); }
  async findActiveMembershipBySourceObservationId(id: string) { return this.ledger.list(`source_observation_id = ? AND ${activeSql}`, id)[0] ?? null; }
  async addMembership(value: PublicationFamilyMembership) {
    validateDecision(value); requireText(value.publicationFamilyId); requireText(value.sourceObservationId);
    return this.db.transaction(() => {
      if (!this.read(value.publicationFamilyId)) missing("PublicationFamily", value.publicationFamilyId);
      if (!this.db.prepare("SELECT 1 FROM source_observations WHERE id = ?").get(value.sourceObservationId)) missing("SourceObservation", value.sourceObservationId);
      const key = decisionKey(value, value.publicationFamilyId, value.sourceObservationId);
      const replay = this.ledger.replay(value, key); if (replay) return replay;
      if (isActive(value) && this.ledger.list(`source_observation_id = ? AND ${activeSql}`, value.sourceObservationId).length) conflict("SourceObservation already has an active publication family.");
      return this.ledger.add(value, value.publicationFamilyId, key);
    }).immediate();
  }
  async supersedeMembership(id: string, at: Date) { this.ledger.supersede(id, at); }
}
