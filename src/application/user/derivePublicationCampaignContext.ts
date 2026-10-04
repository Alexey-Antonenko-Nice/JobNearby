import { compareDecisions, isActive, type MembershipDecision } from "../../domain/publication-identity/MembershipDecision.js";
import type { PublicationCampaignContext, MembershipEvidenceView, CampaignRelationshipPath } from "../../domain/user/PublicationCampaignContext.js";
import { normalizeVacancyProviderNamespace } from "../../domain/vacancy-identity/normalizeVacancyProviderNamespace.js";
import type { PublicationCampaignSnapshot } from "./PublicationCampaignContextSource.js";

export function derivePublicationCampaignContext(currentIds: readonly string[], snapshot: PublicationCampaignSnapshot): PublicationCampaignContext {
  const current = new Set(currentIds);
  const activeFamilyMembers = distinct(snapshot.familyMemberships).filter(isActive);
  const familyIds = new Set(activeFamilyMembers.filter((m) => current.has(m.sourceObservationId)).map((m) => m.publicationFamilyId));
  const observations = new Map(snapshot.observations.map((o) => [o.id, o]));
  const families = new Map(snapshot.families.map((f) => [f.id, f]));
  const publicationFamilies = [...familyIds].sort().map((id) => {
    const family = families.get(id);
    if (!family) throw new Error(`PublicationFamily "${id}" is missing from review context.`);
    const members = activeFamilyMembers.filter((m) => m.publicationFamilyId === id).sort(compareDecisions);
    const memberIds = [...new Set(members.map((m) => m.sourceObservationId))].sort();
    const memberObservations = memberIds.map((observationId) => {
      const observation = observations.get(observationId);
      if (!observation) throw new Error(`PublicationFamily "${id}" references missing SourceObservation "${observationId}".`);
      return observation;
    });
    const timestamps = memberObservations.map((o) => o.observedAt).sort((a, b) => a.getTime() - b.getTime());
    const currentVacancyObservationIds = memberIds.filter((id) => current.has(id));
    return {
      id, representativeTitle: family.representativeTitle ?? null,
      observationCount: memberIds.length,
      sourceProviders: [...new Set(memberObservations.map((o) => normalizeVacancyProviderNamespace(o.source.sourceName)))].sort(),
      firstSeenAt: timestamps[0] ?? null, lastSeenAt: timestamps.at(-1) ?? null,
      currentVacancyObservationIds, currentVacancyObservationCount: currentVacancyObservationIds.length,
      membershipEvidence: members.map((m) => ({ ...evidence(m), publicationFamilyId: id, sourceObservationId: m.sourceObservationId })),
    };
  });
  const campaignMemberships = distinct(snapshot.campaignMemberships).filter((m) => isActive(m) && (
    m.publicationFamilyId !== undefined ? familyIds.has(m.publicationFamilyId) : current.has(m.sourceObservationId)
  ));
  const campaigns = new Map(snapshot.campaigns.map((c) => [c.id, c]));
  const recruitmentCampaigns = [...new Set(campaignMemberships.map((m) => m.recruitmentCampaignId))].sort().map((id) => {
    const campaign = campaigns.get(id);
    if (!campaign) throw new Error(`RecruitmentCampaign "${id}" is missing from review context.`);
    const relationshipPaths: CampaignRelationshipPath[] = campaignMemberships.filter((m) => m.recruitmentCampaignId === id).sort(compareDecisions).map((m) => ({
      ...evidence(m), ...(m.publicationFamilyId !== undefined
        ? { pathType: "PUBLICATION_FAMILY" as const, publicationFamilyId: m.publicationFamilyId }
        : { pathType: "DIRECT_OBSERVATION" as const, sourceObservationId: m.sourceObservationId }),
    }));
    return { ...campaign, relationshipPaths };
  });
  return { publicationFamilies, recruitmentCampaigns };
}
function distinct<T extends { readonly id: string }>(values: readonly T[]): T[] { return [...new Map(values.map((v) => [v.id, v])).values()]; }
function evidence(value: MembershipDecision): MembershipEvidenceView {
  return { membershipId: value.id, status: value.status, confidence: value.confidence,
    sourceType: value.sourceType, algorithm: value.algorithm, algorithmVersion: value.algorithmVersion,
    evaluatedAt: value.evaluatedAt, createdAt: value.createdAt,
    ...(value.explanation === undefined ? {} : { explanation: value.explanation }),
  };
}
