import type Database from "better-sqlite3";
import { compareDecisions, conflict, decisionKey, isActive, missing, validateSupersession, type MembershipDecision } from "../../domain/publication-identity/MembershipDecision.js";
import type { PublicationFamilyMembership } from "../../domain/publication-identity/PublicationFamily.js";
import type { RecruitmentCampaignMembership } from "../../domain/publication-identity/RecruitmentCampaign.js";

type Membership = PublicationFamilyMembership | RecruitmentCampaignMembership;
export class MemoryMembershipLedger<M extends MembershipDecision> {
  private readonly rows = new Map<string, M>();
  private readonly decisions = new Map<string, string>();
  replay(value: M, key: string): M | null {
    const sameId = this.rows.get(value.id);
    const replayId = this.decisions.get(key);
    if (sameId && replayId !== value.id) conflict("Membership ID already identifies a different decision.");
    return replayId ? structuredClone(this.rows.get(replayId)!) : null;
  }
  add(value: M, key: string): M {
    this.rows.set(value.id, structuredClone(value)); this.decisions.set(key, value.id);
    return structuredClone(value);
  }
  byId(id: string): M | null { return structuredClone(this.rows.get(id) ?? null); }
  list(predicate: (value: M) => boolean): M[] {
    return [...this.rows.values()].filter(predicate).sort(compareDecisions).map((v) => structuredClone(v));
  }
  supersede(id: string, at: Date): void {
    const value = this.rows.get(id); if (!value) missing("Membership", id);
    validateSupersession(value, at);
    this.rows.set(id, { ...value, supersededAt: new Date(at) });
  }
}

export const activeSql = "superseded_at IS NULL AND status IN ('ACCEPTED', 'USER_CONFIRMED')";
export class SqliteMembershipLedger<M extends Membership> {
  private readonly table: string;
  private readonly owner: string;
  constructor(private readonly db: Database.Database, private readonly kind: "family" | "campaign") {
    this.table = kind === "family" ? "publication_family_memberships" : "recruitment_campaign_memberships";
    this.owner = kind === "family" ? "publication_family_id" : "recruitment_campaign_id";
  }
  byId(id: string): M | null { return this.list("id = ?", id)[0] ?? null; }
  list(where: string, ...params: string[]): M[] {
    return (this.db.prepare(`SELECT * FROM ${this.table} WHERE ${where} ORDER BY evaluated_at, id`).all(...params) as Row[]).map((row) => this.map(row));
  }
  replay(value: M, key: string): M | null {
    const id = this.db.prepare(`SELECT decision_key FROM ${this.table} WHERE id = ?`).get(value.id) as { decision_key: string } | undefined;
    if (id && id.decision_key !== key) conflict("Membership ID already identifies a different decision.");
    return this.list("decision_key = ?", key)[0] ?? null;
  }
  add(value: M, ownerId: string, key: string): M {
    const familyId = "publicationFamilyId" in value ? value.publicationFamilyId : undefined;
    const observationId = value.sourceObservationId;
    this.db.prepare(`INSERT INTO ${this.table} (id, ${this.owner}, ${this.kind === "campaign" ? "publication_family_id," : ""}
      source_observation_id, confidence, status, algorithm, algorithm_version, evaluated_at, created_at, source_type, explanation, decision_key)
      VALUES (@id, @owner, ${this.kind === "campaign" ? "@family," : ""} @observation, @confidence, @status, @algorithm, @version, @evaluated, @created, @source, @explanation, @key)`)
      .run({ id: value.id, owner: ownerId, family: familyId ?? null, observation: observationId ?? null,
        confidence: value.confidence, status: value.status, algorithm: value.algorithm, version: value.algorithmVersion,
        evaluated: value.evaluatedAt.toISOString(), created: value.createdAt.toISOString(), source: value.sourceType, explanation: value.explanation ?? null, key });
    return structuredClone(value);
  }
  supersede(id: string, at: Date): void {
    this.db.transaction(() => {
      const value = this.byId(id); if (!value) missing("Membership", id);
      validateSupersession(value, at);
      this.db.prepare(`UPDATE ${this.table} SET superseded_at = ? WHERE id = ?`).run(at.toISOString(), id);
    }).immediate();
  }
  private map(row: Row): M {
    return {
      id: row.id, ...(this.kind === "family" ? { publicationFamilyId: row.publication_family_id! } : {
        recruitmentCampaignId: row.recruitment_campaign_id!,
        ...(row.publication_family_id === null ? {} : { publicationFamilyId: row.publication_family_id }),
      }),
      ...(row.source_observation_id === null ? {} : { sourceObservationId: row.source_observation_id }),
      confidence: row.confidence, status: row.status, algorithm: row.algorithm, algorithmVersion: row.algorithm_version,
      evaluatedAt: new Date(row.evaluated_at), createdAt: new Date(row.created_at), sourceType: row.source_type,
      ...(row.explanation === null ? {} : { explanation: row.explanation }),
      ...(row.superseded_at === null ? {} : { supersededAt: new Date(row.superseded_at) }),
    } as M;
  }
}
interface Row {
  id: string; publication_family_id: string | null; recruitment_campaign_id?: string; source_observation_id: string | null;
  confidence: number; status: MembershipDecision["status"]; algorithm: string; algorithm_version: string;
  evaluated_at: string; created_at: string; source_type: MembershipDecision["sourceType"]; explanation: string | null; superseded_at: string | null;
}
export { decisionKey, isActive };
