import type { SourceReference } from "./SourceReference.js";

export type SourceObservationId = string;

export interface SourceObservation {
  readonly id: SourceObservationId;
  readonly source: SourceReference;

  readonly observedAt: Date;
  readonly publishedAt?: Date;

  readonly title?: string;
  readonly displayedCompanyName?: string;
  readonly locationText?: string;
  readonly description?: string;
  readonly salaryText?: string;
  readonly contractText?: string;
  readonly contactText?: string;

  readonly rawContent?: string;
  readonly contentFingerprint?: string;

  readonly metadata: Readonly<Record<string, unknown>>;
}
