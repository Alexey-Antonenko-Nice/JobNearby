import type { PublicationCampaignContextSource } from "../../application/user/PublicationCampaignContextSource.js";
import { derivePublicationCampaignContext } from "../../application/user/derivePublicationCampaignContext.js";
import type { InMemoryPublicationFamilyRepository } from "./InMemoryPublicationFamilyRepository.js";
import type { InMemoryRecruitmentCampaignRepository } from "./InMemoryRecruitmentCampaignRepository.js";
import type { SourceObservationRepository } from "../../domain/capture/SourceObservationRepository.js";

export class InMemoryPublicationCampaignContextSource implements PublicationCampaignContextSource {
  constructor(private readonly families: InMemoryPublicationFamilyRepository,
    private readonly campaigns: InMemoryRecruitmentCampaignRepository,
    private readonly observations: Required<Pick<SourceObservationRepository, "findByIds">>) {}
  async findBySourceObservationIds(ids: readonly string[]) {
    // Both membership snapshots are synchronous, before yielding for immutable observations.
    const familySnapshot = this.families.readContextMemberships(ids);
    const campaignSnapshot = this.campaigns.readContextMemberships(familySnapshot.families.map((f) => f.id), ids);
    const observationIds = [...new Set(familySnapshot.familyMemberships.map((m) => m.sourceObservationId))];
    const observations = await this.observations.findByIds(observationIds);
    return derivePublicationCampaignContext(ids, { ...familySnapshot, ...campaignSnapshot, observations });
  }
}
