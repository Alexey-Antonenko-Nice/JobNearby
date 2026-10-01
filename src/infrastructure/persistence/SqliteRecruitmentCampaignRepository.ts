import type Database from "better-sqlite3";
import { conflict, missing, requireText, validateDecision } from "../../domain/publication-identity/MembershipDecision.js";
import { campaignTarget, validateRecruitmentCampaign, type CampaignMembershipTarget, type RecruitmentCampaign, type RecruitmentCampaignMembership, type RecruitmentCampaignRepository } from "../../domain/publication-identity/RecruitmentCampaign.js";
import { SqliteMembershipLedger, activeSql, decisionKey, isActive } from "./identityMembershipLedger.js";

export class SqliteRecruitmentCampaignRepository implements RecruitmentCampaignRepository {
  private readonly ledger: SqliteMembershipLedger<RecruitmentCampaignMembership>;
  constructor(private readonly db: Database.Database) { this.ledger = new SqliteMembershipLedger(db, "campaign"); }
  async save(value: RecruitmentCampaign): Promise<void> {
    validateRecruitmentCampaign(value);
    this.db.transaction(() => {
      if (!this.db.prepare("SELECT 1 FROM employer_clusters WHERE id = ?").get(value.employerClusterId)) missing("EmployerCluster", value.employerClusterId);
      if (this.read(value.id)) conflict("RecruitmentCampaign ID already exists.");
      this.db.prepare(`INSERT INTO recruitment_campaigns (id, employer_cluster_id, status, first_observed_at, last_observed_at,
        created_at, updated_at, occupation_json, location_json, position_count_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(value.id, value.employerClusterId, value.status, value.firstObservedAt.toISOString(), value.lastObservedAt.toISOString(),
          value.createdAt.toISOString(), value.updatedAt.toISOString(), json(value.occupation), json(value.location), json(value.positionCount));
    }).immediate();
  }
  private read(id: string): RecruitmentCampaign | null { const row = this.db.prepare("SELECT * FROM recruitment_campaigns WHERE id = ?").get(id) as Row | undefined; return row ? map(row) : null; }
  async findById(id: string) { return this.read(id); }
  async findByEmployerClusterId(id: string) { return (this.db.prepare("SELECT * FROM recruitment_campaigns WHERE employer_cluster_id = ? ORDER BY id").all(id) as Row[]).map(map); }
  async findByTarget(target: CampaignMembershipTarget) {
    campaignTarget(target);
    const [column, id] = targetColumn(target);
    return (this.db.prepare(`SELECT * FROM recruitment_campaigns WHERE id IN (
      SELECT recruitment_campaign_id FROM recruitment_campaign_memberships WHERE ${column} = ? AND ${activeSql}
    ) ORDER BY id`).all(id) as Row[]).map(map);
  }
  async findMembersByCampaignId(id: string) { return this.ledger.list(`recruitment_campaign_id = ? AND ${activeSql}`, id); }
  async findMembershipById(id: string) { return this.ledger.byId(id); }
  async findMembershipHistoryByTarget(target: CampaignMembershipTarget) { campaignTarget(target); const [col, id] = targetColumn(target); return this.ledger.list(`${col} = ?`, id); }
  async findActiveMembershipsByTarget(target: CampaignMembershipTarget) { campaignTarget(target); const [col, id] = targetColumn(target); return this.ledger.list(`${col} = ? AND ${activeSql}`, id); }
  async addMembership(value: RecruitmentCampaignMembership) {
    validateDecision(value); requireText(value.recruitmentCampaignId);
    const target = campaignTarget(value);
    return this.db.transaction(() => {
      if (!this.read(value.recruitmentCampaignId)) missing("RecruitmentCampaign", value.recruitmentCampaignId);
      if (value.publicationFamilyId !== undefined) {
        if (!this.db.prepare("SELECT 1 FROM publication_families WHERE id = ?").get(value.publicationFamilyId)) missing("PublicationFamily", value.publicationFamilyId);
      } else if (!this.db.prepare("SELECT 1 FROM source_observations WHERE id = ?").get(value.sourceObservationId!)) missing("SourceObservation", value.sourceObservationId!);
      const key = decisionKey(value, value.recruitmentCampaignId, target);
      const replay = this.ledger.replay(value, key); if (replay) return replay;
      if (value.sourceObservationId !== undefined && this.db.prepare(`SELECT 1 FROM publication_family_memberships WHERE source_observation_id = ? AND ${activeSql}`).get(value.sourceObservationId)) conflict("Target the active publication family instead of its observation.");
      const [column, id] = targetColumn(value);
      if (isActive(value) && this.ledger.list(`recruitment_campaign_id = ? AND ${column} = ? AND ${activeSql}`, value.recruitmentCampaignId, id).length) conflict("Campaign relationship already has an active decision.");
      return this.ledger.add(value, value.recruitmentCampaignId, key);
    }).immediate();
  }
  async supersedeMembership(id: string, at: Date) { this.ledger.supersede(id, at); }
}
function targetColumn(target: CampaignMembershipTarget): [string, string] {
  return target.publicationFamilyId !== undefined ? ["publication_family_id", target.publicationFamilyId] : ["source_observation_id", target.sourceObservationId!];
}
function json(value: unknown): string | null { return value === undefined ? null : JSON.stringify(value); }
interface Row { id: string; employer_cluster_id: string; status: RecruitmentCampaign["status"]; first_observed_at: string; last_observed_at: string; created_at: string; updated_at: string; occupation_json: string | null; location_json: string | null; position_count_json: string | null; }
function map(row: Row): RecruitmentCampaign {
  return { id: row.id, employerClusterId: row.employer_cluster_id, status: row.status,
    firstObservedAt: new Date(row.first_observed_at), lastObservedAt: new Date(row.last_observed_at), createdAt: new Date(row.created_at), updatedAt: new Date(row.updated_at),
    ...(row.occupation_json === null ? {} : { occupation: JSON.parse(row.occupation_json) as NonNullable<RecruitmentCampaign["occupation"]> }),
    ...(row.location_json === null ? {} : { location: JSON.parse(row.location_json) as NonNullable<RecruitmentCampaign["location"]> }),
    ...(row.position_count_json === null ? {} : { positionCount: JSON.parse(row.position_count_json) as NonNullable<RecruitmentCampaign["positionCount"]> }),
  };
}
