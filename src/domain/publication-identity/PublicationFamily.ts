import type { MembershipDecision } from "./MembershipDecision.js";
import { requireDate, requireText, invalid } from "./MembershipDecision.js";

export interface PublicationFamily {
  readonly id: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly representativeTitle?: string;
}
export interface PublicationFamilyMembership extends MembershipDecision {
  readonly publicationFamilyId: string;
  readonly sourceObservationId: string;
}
export function validatePublicationFamily(value: PublicationFamily): void {
  requireText(value.id); requireDate(value.createdAt); requireDate(value.updatedAt);
  if (value.updatedAt < value.createdAt) invalid("updatedAt cannot precede createdAt.");
  if (value.representativeTitle !== undefined) requireText(value.representativeTitle);
}
export interface PublicationFamilyRepository {
  save(entity: PublicationFamily): Promise<void>;
  findById(id: string): Promise<PublicationFamily | null>;
  findBySourceObservationId(id: string): Promise<PublicationFamily | null>;
  findMembersByFamilyId(id: string): Promise<readonly PublicationFamilyMembership[]>;
  findMembershipById(id: string): Promise<PublicationFamilyMembership | null>;
  findMembershipHistoryBySourceObservationId(id: string): Promise<readonly PublicationFamilyMembership[]>;
  findActiveMembershipBySourceObservationId(id: string): Promise<PublicationFamilyMembership | null>;
  addMembership(value: PublicationFamilyMembership): Promise<PublicationFamilyMembership>;
  supersedeMembership(id: string, at: Date): Promise<void>;
}
