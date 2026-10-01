import type { SourceObservationRepository } from "../../domain/capture/SourceObservationRepository.js";
import type { EmployerClusterRepository } from "../../domain/recognition/EmployerClusterRepository.js";
import { conflict, missing, requireText, validateDecision } from "../../domain/publication-identity/MembershipDecision.js";
import { campaignTarget, validateRecruitmentCampaign, type CampaignMembershipTarget, type RecruitmentCampaign, type RecruitmentCampaignMembership, type RecruitmentCampaignRepository } from "../../domain/publication-identity/RecruitmentCampaign.js";
import { InMemoryPublicationFamilyRepository } from "./InMemoryPublicationFamilyRepository.js";
import { MemoryMembershipLedger, decisionKey, isActive } from "./identityMembershipLedger.js";

export class InMemoryRecruitmentCampaignRepository implements RecruitmentCampaignRepository {
  private readonly entities = new Map<string, RecruitmentCampaign>();
  private readonly ledger = new MemoryMembershipLedger<RecruitmentCampaignMembership>();
  constructor(private readonly observations: Pick<SourceObservationRepository, "findById">,
    private readonly employers: Pick<EmployerClusterRepository, "findById">,
    private readonly families: InMemoryPublicationFamilyRepository) {}
  async save(input: RecruitmentCampaign): Promise<void> {
    const value = structuredClone(input); validateRecruitmentCampaign(value);
    if (!await this.employers.findById(value.employerClusterId)) missing("EmployerCluster", value.employerClusterId);
    if (this.entities.has(value.id)) conflict("RecruitmentCampaign ID already exists.");
    this.entities.set(value.id, value);
  }
  async findById(id: string) { return structuredClone(this.entities.get(id) ?? null); }
  async findByEmployerClusterId(id: string) {
    return [...this.entities.values()].filter((e) => e.employerClusterId === id).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0).map((e) => structuredClone(e));
  }
  async findByTarget(target: CampaignMembershipTarget) {
    const ids = new Set((await this.findActiveMembershipsByTarget(target)).map((m) => m.recruitmentCampaignId));
    return [...ids].sort().map((id) => structuredClone(this.entities.get(id)!));
  }
  async findMembersByCampaignId(id: string) { return this.ledger.list((m) => m.recruitmentCampaignId === id && isActive(m)); }
  async findMembershipById(id: string) { return this.ledger.byId(id); }
  async findMembershipHistoryByTarget(target: CampaignMembershipTarget) {
    const key = campaignTarget(target); return this.ledger.list((m) => campaignTarget(m) === key);
  }
  async findActiveMembershipsByTarget(target: CampaignMembershipTarget) { return (await this.findMembershipHistoryByTarget(target)).filter(isActive); }
  async addMembership(input: RecruitmentCampaignMembership) {
    const value = structuredClone(input);
    validateDecision(value); requireText(value.recruitmentCampaignId);
    const target = campaignTarget(value); const key = decisionKey(value, value.recruitmentCampaignId, target);
    if (!this.entities.has(value.recruitmentCampaignId)) missing("RecruitmentCampaign", value.recruitmentCampaignId);
    if (value.publicationFamilyId !== undefined) {
      if (!await this.families.findById(value.publicationFamilyId)) missing("PublicationFamily", value.publicationFamilyId);
    } else if (!await this.observations.findById(value.sourceObservationId!)) missing("SourceObservation", value.sourceObservationId!);
    const replay = this.ledger.replay(value, key); if (replay) return replay;
    if (value.sourceObservationId !== undefined && this.families.activeMembership(value.sourceObservationId)) conflict("Target the active publication family instead of its observation.");
    if (isActive(value) && this.ledger.list((m) => isActive(m) && m.recruitmentCampaignId === value.recruitmentCampaignId && campaignTarget(m) === target).length) conflict("Campaign relationship already has an active decision.");
    return this.ledger.add(value, key);
  }
  async supersedeMembership(id: string, at: Date) { this.ledger.supersede(id, at); }
}
