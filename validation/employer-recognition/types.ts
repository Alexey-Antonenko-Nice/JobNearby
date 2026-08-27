import type { SourceObservation } from "../../src/domain/capture/SourceObservation.js";

export type ExpectedEmployerRelationship =
  | "SAME_EMPLOYER_CLUSTER"
  | "DIFFERENT_EMPLOYERS"
  | "POSSIBLE_SAME_EMPLOYER"
  | "INSUFFICIENT_EVIDENCE";

export type ExpectedConfidenceZone =
  | "AUTO_MATCH"
  | "REVIEW_REQUIRED"
  | "NO_MATCH"
  | "UNSCORED";

export type ValidationCaseStatus = "VERIFIED" | "NEEDS_REVIEW" | "OPEN";

export interface RecognitionValidationCase {
  readonly caseId: string;
  readonly observationIds: readonly [string, string];
  readonly expectedRelationship: ExpectedEmployerRelationship;
  readonly expectedConfidenceZone: ExpectedConfidenceZone;
  readonly humanExplanation: string;
  readonly status: ValidationCaseStatus;
}

export type RecognitionValidationFixture = SourceObservation;
