import type { MembershipDecision } from "./MembershipDecision.js";
import { requireText, requireDate, invalid } from "./MembershipDecision.js";

export type CampaignPositionCount =
  | { readonly type: "EXACT" | "MINIMUM"; readonly value: number }
  | { readonly type: "RANGE"; readonly minimum: number; readonly maximum: number }
  | { readonly type: "PLURAL_UNKNOWN" | "UNKNOWN" };
export interface RecruitmentCampaign {
  readonly id: string;
  readonly employerClusterId: string;
  readonly status: "ACTIVE" | "PROBABLY_ACTIVE" | "ENDED" | "RECURRENT" | "UNKNOWN";
  readonly firstObservedAt: Date;
  readonly lastObservedAt: Date;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly occupation?: { readonly id: string; readonly canonicalName: string; readonly classificationSystem?: string; readonly classificationCode?: string };
  readonly location?: import("../vacancies/CanonicalVacancy.js").VacancyLocation;
  readonly positionCount?: CampaignPositionCount;
}
export type CampaignMembershipTarget =
  | { readonly publicationFamilyId: string; readonly sourceObservationId?: never }
  | { readonly sourceObservationId: string; readonly publicationFamilyId?: never };
export type RecruitmentCampaignMembership = MembershipDecision & CampaignMembershipTarget & { readonly recruitmentCampaignId: string };
export function campaignTarget(value: CampaignMembershipTarget): string {
  if ((value.publicationFamilyId !== undefined) === (value.sourceObservationId !== undefined)) invalid("Campaign membership requires exactly one target.");
  const id = value.publicationFamilyId ?? value.sourceObservationId;
  requireText(id!);
  return value.publicationFamilyId !== undefined ? `family:${id}` : `observation:${id}`;
}
export function validateRecruitmentCampaign(value: RecruitmentCampaign): void {
  [value.id, value.employerClusterId].forEach(requireText);
  [value.createdAt, value.updatedAt, value.firstObservedAt, value.lastObservedAt].forEach(requireDate);
  if (value.updatedAt < value.createdAt || value.lastObservedAt < value.firstObservedAt) invalid("Campaign dates are out of order.");
  if (!["ACTIVE", "PROBABLY_ACTIVE", "ENDED", "RECURRENT", "UNKNOWN"].includes(value.status)) invalid("Invalid campaign status.");
  if (value.occupation) {
    [value.occupation.id, value.occupation.canonicalName].forEach(requireText);
    if (value.occupation.classificationSystem !== undefined) requireText(value.occupation.classificationSystem);
    if (value.occupation.classificationCode !== undefined) requireText(value.occupation.classificationCode);
  }
  if (value.location) Object.values(value.location).forEach(requireText);
  const count = value.positionCount;
  if (count) {
    const positive = (n: number) => Number.isSafeInteger(n) && n > 0;
    if ((count.type === "EXACT" || count.type === "MINIMUM") && !positive(count.value)) invalid("Invalid position count.");
    if (count.type === "RANGE" && (!positive(count.minimum) || !positive(count.maximum) || count.maximum < count.minimum)) invalid("Invalid position range.");
    if (!["EXACT", "MINIMUM", "RANGE", "PLURAL_UNKNOWN", "UNKNOWN"].includes(count.type)) invalid("Invalid position count type.");
  }
}
export interface RecruitmentCampaignRepository {
  save(entity: RecruitmentCampaign): Promise<void>;
  findById(id: string): Promise<RecruitmentCampaign | null>;
  findByEmployerClusterId(id: string): Promise<readonly RecruitmentCampaign[]>;
  findByTarget(target: CampaignMembershipTarget): Promise<readonly RecruitmentCampaign[]>;
  findMembersByCampaignId(id: string): Promise<readonly RecruitmentCampaignMembership[]>;
  findMembershipById(id: string): Promise<RecruitmentCampaignMembership | null>;
  findMembershipHistoryByTarget(target: CampaignMembershipTarget): Promise<readonly RecruitmentCampaignMembership[]>;
  findActiveMembershipsByTarget(target: CampaignMembershipTarget): Promise<readonly RecruitmentCampaignMembership[]>;
  addMembership(value: RecruitmentCampaignMembership): Promise<RecruitmentCampaignMembership>;
  supersedeMembership(id: string, at: Date): Promise<void>;
}
