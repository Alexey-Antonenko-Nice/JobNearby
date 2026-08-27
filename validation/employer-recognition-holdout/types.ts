import type { SourceObservation } from "../../src/domain/capture/SourceObservation.js";

export type HoldoutExpectedEmployerRelationship =
  | "SAME_EMPLOYER_CLUSTER"
  | "DIFFERENT_EMPLOYERS"
  | "POSSIBLE_SAME_EMPLOYER"
  | "INSUFFICIENT_EVIDENCE";

export type HoldoutExpectedConfidenceZone =
  | "AUTO_MATCH"
  | "REVIEW_REQUIRED"
  | "NO_MATCH"
  | "UNSCORED";

export interface EmployerRecognitionHoldoutCase {
  readonly caseId: string;
  readonly observationIds: readonly [string, string];
  readonly expectedRelationship: HoldoutExpectedEmployerRelationship;
  readonly expectedConfidenceZone: HoldoutExpectedConfidenceZone;
  readonly humanExplanation: string;
}

export type EmployerRecognitionHoldoutFixture = SourceObservation;
