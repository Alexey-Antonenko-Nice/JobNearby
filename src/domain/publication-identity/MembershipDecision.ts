import type { ObservationClusterAssignmentStatus } from "../recognition/ObservationClusterAssignment.js";

export interface MembershipDecision {
  readonly id: string;
  readonly confidence: number;
  readonly status: ObservationClusterAssignmentStatus;
  readonly algorithm: string;
  readonly algorithmVersion: string;
  readonly evaluatedAt: Date;
  readonly createdAt: Date;
  readonly sourceType: "USER_CONFIRMED" | "SYSTEM_MANUAL" | "TEST_FIXTURE";
  readonly explanation?: string;
  readonly supersededAt?: Date;
}

export class IdentityMembershipError extends Error {
  constructor(readonly code: "INVALID" | "MISSING_REFERENCE" | "CONFLICT", message: string) {
    super(message);
    this.name = "IdentityMembershipError";
  }
}
export function invalid(message: string): never { throw new IdentityMembershipError("INVALID", message); }
export function missing(kind: string, id: string): never { throw new IdentityMembershipError("MISSING_REFERENCE", `${kind} "${id}" does not exist.`); }
export function conflict(message: string): never { throw new IdentityMembershipError("CONFLICT", message); }
export function requireText(value: string): void { if (typeof value !== "string" || !value.trim()) invalid("Non-empty text is required."); }
export function requireDate(value: Date): void { if (!(value instanceof Date) || !Number.isFinite(value.getTime())) invalid("Valid date is required."); }
export function validateDecision(value: MembershipDecision): void {
  [value.id, value.algorithm, value.algorithmVersion].forEach(requireText);
  [value.evaluatedAt, value.createdAt].forEach(requireDate);
  if (value.supersededAt !== undefined) invalid("Use explicit supersession, not addMembership, to end a decision.");
  if (!Number.isFinite(value.confidence) || value.confidence < 0 || value.confidence > 1) invalid("Confidence must be between 0 and 1.");
  if (!["PROPOSED", "ACCEPTED", "REJECTED", "USER_CONFIRMED"].includes(value.status)) invalid("Invalid membership status.");
  if (!["USER_CONFIRMED", "SYSTEM_MANUAL", "TEST_FIXTURE"].includes(value.sourceType)) invalid("Explicit membership sourceType is required.");
  if (value.explanation !== undefined) requireText(value.explanation);
}
export function isActive(value: MembershipDecision): boolean {
  return value.supersededAt === undefined && (value.status === "ACCEPTED" || value.status === "USER_CONFIRMED");
}
export function compareDecisions(a: MembershipDecision, b: MembershipDecision): number {
  return a.evaluatedAt.getTime() - b.evaluatedAt.getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}
/** ID and recording time are not provenance: retrying the same decision returns its original record. */
export function decisionKey(value: MembershipDecision, identityId: string, target: string): string {
  return JSON.stringify([identityId, target, value.confidence, value.status, value.algorithm,
    value.algorithmVersion, value.evaluatedAt.toISOString(), value.sourceType, value.explanation ?? null]);
}
export function validateSupersession(value: MembershipDecision, at: Date): void {
  requireDate(at);
  if (at < value.createdAt || at < value.evaluatedAt) invalid("Supersession cannot precede the decision.");
  if (value.supersededAt && value.supersededAt.getTime() !== at.getTime()) conflict("Membership was already superseded at a different time.");
}
