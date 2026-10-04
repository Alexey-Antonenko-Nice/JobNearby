import type { MembershipDecision } from "../publication-identity/MembershipDecision.js";
import type { RecruitmentCampaign, CampaignMembershipTarget } from "../publication-identity/RecruitmentCampaign.js";

export type MembershipEvidenceView = Omit<MembershipDecision, "id" | "supersededAt"> & { readonly membershipId: string };
export interface PublicationFamilyContext {
  readonly id: string;
  readonly representativeTitle: string | null;
  readonly observationCount: number;
  readonly sourceProviders: readonly string[];
  readonly firstSeenAt: Date | null;
  readonly lastSeenAt: Date | null;
  readonly currentVacancyObservationIds: readonly string[];
  readonly currentVacancyObservationCount: number;
  readonly membershipEvidence: readonly (MembershipEvidenceView & { readonly publicationFamilyId: string; readonly sourceObservationId: string })[];
}
export type CampaignRelationshipPath = MembershipEvidenceView & CampaignMembershipTarget & {
  readonly pathType: "PUBLICATION_FAMILY" | "DIRECT_OBSERVATION";
};
export type RecruitmentCampaignContext = Pick<RecruitmentCampaign, "id" | "employerClusterId" | "status" | "firstObservedAt" | "lastObservedAt"> & {
  readonly relationshipPaths: readonly CampaignRelationshipPath[];
};
export interface PublicationCampaignContext {
  readonly publicationFamilies: readonly PublicationFamilyContext[];
  readonly recruitmentCampaigns: readonly RecruitmentCampaignContext[];
}
