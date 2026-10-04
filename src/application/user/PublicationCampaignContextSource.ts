import type { PublicationCampaignContext } from "../../domain/user/PublicationCampaignContext.js";
import type { PublicationFamily, PublicationFamilyMembership } from "../../domain/publication-identity/PublicationFamily.js";
import type { RecruitmentCampaign, RecruitmentCampaignMembership } from "../../domain/publication-identity/RecruitmentCampaign.js";
import type { SourceObservation } from "../../domain/capture/SourceObservation.js";

export interface PublicationCampaignContextSource {
  findBySourceObservationIds(ids: readonly string[]): Promise<PublicationCampaignContext>;
}
/** Public-only snapshot. Memberships and identity entities come from one coherent read. */
export interface PublicationCampaignSnapshot {
  readonly families: readonly PublicationFamily[];
  readonly familyMemberships: readonly PublicationFamilyMembership[];
  readonly campaigns: readonly Pick<RecruitmentCampaign, "id" | "employerClusterId" | "status" | "firstObservedAt" | "lastObservedAt">[];
  readonly campaignMemberships: readonly RecruitmentCampaignMembership[];
  readonly observations: readonly (Pick<SourceObservation, "id" | "observedAt"> & { readonly source: Pick<SourceObservation["source"], "sourceName"> })[];
}
