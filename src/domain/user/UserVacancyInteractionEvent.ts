import type { SourceObservationId } from "../capture/SourceObservation.js";
import type { CanonicalVacancyId } from "../vacancies/CanonicalVacancy.js";

export type UserVacancyInteractionEventId = string;
export type UserVacancyInteractionType =
  | "REVIEWED" | "INTERESTED" | "APPLIED" | "CONTACTED" | "INTERVIEW"
  | "OFFER" | "REJECTED" | "WITHDRAWN" | "CLOSED";

export interface AppliedInteractionMetadata {
  readonly channel?: "LINKEDIN" | "EMPLOYER_SITE" | "EMAIL" | "JOB_BOARD" | "OTHER";
  readonly sourceObservationId?: SourceObservationId;
}

export interface ContactedInteractionMetadata {
  readonly direction?: "INBOUND" | "OUTBOUND";
  readonly contactMethod?: "EMAIL" | "PHONE" | "LINKEDIN" | "OTHER";
}

export interface InterviewInteractionMetadata { readonly stage?: string }
export interface OfferInteractionMetadata { readonly reference?: string }
export interface RejectedInteractionMetadata { readonly actor?: "EMPLOYER" | "USER" }

export interface UserVacancyInteractionMetadataByType {
  readonly REVIEWED: never;
  readonly INTERESTED: never;
  readonly APPLIED: AppliedInteractionMetadata;
  readonly CONTACTED: ContactedInteractionMetadata;
  readonly INTERVIEW: InterviewInteractionMetadata;
  readonly OFFER: OfferInteractionMetadata;
  readonly REJECTED: RejectedInteractionMetadata;
  readonly WITHDRAWN: never;
  readonly CLOSED: never;
}

type EventFor<T extends UserVacancyInteractionType> = {
  readonly id: UserVacancyInteractionEventId;
  readonly canonicalVacancyId: CanonicalVacancyId;
  readonly type: T;
  readonly occurredAt: Date;
  readonly recordedAt: Date;
} & (UserVacancyInteractionMetadataByType[T] extends never
  ? { readonly metadata?: never }
  : { readonly metadata?: UserVacancyInteractionMetadataByType[T] });

export type UserVacancyInteractionEvent = {
  [T in UserVacancyInteractionType]: EventFor<T>
}[UserVacancyInteractionType];

export type UserVacancyState = "NEW" | UserVacancyInteractionType;

export function createUserVacancyInteractionEvent(
  event: UserVacancyInteractionEvent,
): UserVacancyInteractionEvent {
  requireText(event.id, "Interaction event ID");
  requireText(event.canonicalVacancyId, "Canonical vacancy ID");
  requireDate(event.occurredAt, "Interaction occurredAt");
  requireDate(event.recordedAt, "Interaction recordedAt");
  validateMetadata(event);
  return structuredClone(event);
}

export function compareUserVacancyInteractionEvents(
  left: UserVacancyInteractionEvent,
  right: UserVacancyInteractionEvent,
): number {
  return left.occurredAt.getTime() - right.occurredAt.getTime()
    || left.recordedAt.getTime() - right.recordedAt.getTime()
    || left.id.localeCompare(right.id);
}

export function deriveUserVacancyState(
  events: readonly UserVacancyInteractionEvent[],
): UserVacancyState {
  const latest = [...events].sort(compareUserVacancyInteractionEvents).at(-1);
  return latest?.type ?? "NEW";
}

function validateMetadata(event: UserVacancyInteractionEvent): void {
  const metadata = event.metadata;
  if (metadata === undefined) return;
  if (!isRecord(metadata)) throw new Error("Interaction metadata must be an object.");
  if (["REVIEWED", "INTERESTED", "WITHDRAWN", "CLOSED"].includes(event.type)) {
    throw new Error(`Interaction type "${event.type}" does not accept metadata.`);
  }
  const specification: Record<string, readonly string[] | null> = event.type === "APPLIED"
    ? { channel: ["LINKEDIN", "EMPLOYER_SITE", "EMAIL", "JOB_BOARD", "OTHER"], sourceObservationId: null }
    : event.type === "CONTACTED"
      ? { direction: ["INBOUND", "OUTBOUND"], contactMethod: ["EMAIL", "PHONE", "LINKEDIN", "OTHER"] }
      : event.type === "INTERVIEW"
        ? { stage: null }
        : event.type === "OFFER"
          ? { reference: null }
          : { actor: ["EMPLOYER", "USER"] };
  for (const [key, value] of Object.entries(metadata)) {
    const accepted = specification[key];
    if (accepted === undefined) throw new Error(`Metadata field "${key}" is not valid for ${event.type}.`);
    if (typeof value !== "string") throw new Error(`Metadata field "${key}" must be a string.`);
    requireText(value, `Metadata field "${key}"`);
    if (accepted !== null && !accepted.includes(value)) {
      throw new Error(`Metadata field "${key}" has an invalid value for ${event.type}.`);
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requireText(value: string, label: string): void {
  if (value.trim().length === 0) throw new Error(`${label} is required.`);
}

function requireDate(value: Date, label: string): void {
  if (Number.isNaN(value.getTime())) throw new Error(`${label} must be a valid date.`);
}
