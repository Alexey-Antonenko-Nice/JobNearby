import type Database from "better-sqlite3";
import type { PublicationCampaignContextSource, PublicationCampaignSnapshot } from "../../application/user/PublicationCampaignContextSource.js";
import { derivePublicationCampaignContext } from "../../application/user/derivePublicationCampaignContext.js";
import type { PublicationFamilyMembership } from "../../domain/publication-identity/PublicationFamily.js";
import type { RecruitmentCampaignMembership } from "../../domain/publication-identity/RecruitmentCampaign.js";
import { SqliteMembershipLedger, activeSql } from "./identityMembershipLedger.js";

export class SqlitePublicationCampaignContextSource implements PublicationCampaignContextSource {
  constructor(private readonly db: Database.Database) {}
  async findBySourceObservationIds(ids: readonly string[]) {
    if (ids.length === 0) return { publicationFamilies: [], recruitmentCampaigns: [] };
    return this.db.transaction(() => {
      const currentJson = JSON.stringify([...new Set(ids)]);
      const familyLedger = new SqliteMembershipLedger<PublicationFamilyMembership>(this.db, "family");
      const currentMemberships = familyLedger.list(`source_observation_id IN (SELECT value FROM json_each(?)) AND ${activeSql}`, currentJson);
      const familyIds = [...new Set(currentMemberships.map((m) => m.publicationFamilyId))];
      const familyJson = JSON.stringify(familyIds);
      const familyMemberships = familyIds.length ? familyLedger.list(`publication_family_id IN (SELECT value FROM json_each(?)) AND ${activeSql}`, familyJson) : [];
      const families = familyIds.length ? (this.db.prepare(`SELECT * FROM publication_families WHERE id IN (SELECT value FROM json_each(?)) ORDER BY id`).all(familyJson) as FamilyRow[]).map((r) => ({
        id: r.id, createdAt: new Date(r.created_at), updatedAt: new Date(r.updated_at),
        ...(r.representative_title === null ? {} : { representativeTitle: r.representative_title }),
      })) : [];
      const memberIds = [...new Set(familyMemberships.map((m) => m.sourceObservationId))];
      const observations = memberIds.length ? (this.db.prepare(`SELECT id, source_name, observed_at FROM source_observations
        WHERE id IN (SELECT value FROM json_each(?)) ORDER BY id`).all(JSON.stringify(memberIds)) as ObservationRow[]).map((r) => ({
          id: r.id, source: { sourceName: r.source_name }, observedAt: new Date(r.observed_at),
        })) : [];
      const campaignLedger = new SqliteMembershipLedger<RecruitmentCampaignMembership>(this.db, "campaign");
      // UNION uses the existing target indexes and preserves both kinds of recorded path.
      const campaignMemberships = campaignLedger.list(`id IN (
        SELECT id FROM recruitment_campaign_memberships WHERE publication_family_id IN (SELECT value FROM json_each(?)) AND ${activeSql}
        UNION SELECT id FROM recruitment_campaign_memberships WHERE source_observation_id IN (SELECT value FROM json_each(?)) AND ${activeSql}
      )`, familyJson, currentJson);
      const campaignIds = [...new Set(campaignMemberships.map((m) => m.recruitmentCampaignId))];
      const campaigns = campaignIds.length ? (this.db.prepare(`SELECT id, employer_cluster_id, status, first_observed_at, last_observed_at
        FROM recruitment_campaigns WHERE id IN (SELECT value FROM json_each(?)) ORDER BY id`).all(JSON.stringify(campaignIds)) as CampaignRow[]).map((r) => ({
          id: r.id, employerClusterId: r.employer_cluster_id, status: r.status,
          firstObservedAt: new Date(r.first_observed_at), lastObservedAt: new Date(r.last_observed_at),
        })) : [];
      return derivePublicationCampaignContext(ids, { families, familyMemberships, observations, campaigns, campaignMemberships });
    }).deferred();
  }
}
interface FamilyRow { id: string; created_at: string; updated_at: string; representative_title: string | null; }
interface ObservationRow { id: string; source_name: string; observed_at: string; }
interface CampaignRow { id: string; employer_cluster_id: string; status: PublicationCampaignSnapshot["campaigns"][number]["status"]; first_observed_at: string; last_observed_at: string; }
