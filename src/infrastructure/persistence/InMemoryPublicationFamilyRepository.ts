import type { SourceObservationRepository } from "../../domain/capture/SourceObservationRepository.js";
import { conflict, missing, requireText, validateDecision } from "../../domain/publication-identity/MembershipDecision.js";
import { validatePublicationFamily, type PublicationFamily, type PublicationFamilyMembership, type PublicationFamilyRepository } from "../../domain/publication-identity/PublicationFamily.js";
import { MemoryMembershipLedger, decisionKey, isActive } from "./identityMembershipLedger.js";

export class InMemoryPublicationFamilyRepository implements PublicationFamilyRepository {
  private readonly entities = new Map<string, PublicationFamily>();
  private readonly ledger = new MemoryMembershipLedger<PublicationFamilyMembership>();
  constructor(private readonly observations: Pick<SourceObservationRepository, "findById">) {}
  async save(value: PublicationFamily): Promise<void> {
    validatePublicationFamily(value);
    if (this.entities.has(value.id)) conflict("PublicationFamily ID already exists.");
    this.entities.set(value.id, structuredClone(value));
  }
  async findById(id: string) { return structuredClone(this.entities.get(id) ?? null); }
  async findBySourceObservationId(id: string) {
    const member = this.activeMembership(id);
    return member ? this.findById(member.publicationFamilyId) : null;
  }
  async findMembersByFamilyId(id: string) { return this.ledger.list((m) => m.publicationFamilyId === id && isActive(m)); }
  async findMembershipById(id: string) { return this.ledger.byId(id); }
  async findMembershipHistoryBySourceObservationId(id: string) { return this.ledger.list((m) => m.sourceObservationId === id); }
  async findActiveMembershipBySourceObservationId(id: string) { return this.activeMembership(id); }
  /** Synchronous current-state check used after async reference reads by the in-memory campaign repository. */
  activeMembership(id: string) { return this.ledger.list((m) => m.sourceObservationId === id && isActive(m))[0] ?? null; }
  async addMembership(input: PublicationFamilyMembership) {
    const value = structuredClone(input);
    validateDecision(value); requireText(value.publicationFamilyId); requireText(value.sourceObservationId);
    const key = decisionKey(value, value.publicationFamilyId, value.sourceObservationId);
    if (!this.entities.has(value.publicationFamilyId)) missing("PublicationFamily", value.publicationFamilyId);
    if (!await this.observations.findById(value.sourceObservationId)) missing("SourceObservation", value.sourceObservationId);
    const replay = this.ledger.replay(value, key); if (replay) return replay;
    if (isActive(value) && this.activeMembership(value.sourceObservationId)) conflict("SourceObservation already has an active publication family.");
    return this.ledger.add(value, key);
  }
  async supersedeMembership(id: string, at: Date) { this.ledger.supersede(id, at); }
}
