import type {
  EmployerMatchContradiction,
  EmployerMatchSignal,
} from "./EmployerEvidenceComparison.js";

export type DimensionAssessment =
  | "UNKNOWN"
  | "WEAK_POSITIVE"
  | "MEDIUM_POSITIVE"
  | "STRONG_POSITIVE"
  | "VERY_STRONG_POSITIVE"
  | "WEAK_NEGATIVE"
  | "MODERATE_NEGATIVE"
  | "STRONG_NEGATIVE"
  | "DECISIVE_NEGATIVE";

export interface EmployerMatchDimensionAssessment {
  readonly assessment: DimensionAssessment;
  readonly supportingSignals: readonly EmployerMatchSignal[];
  readonly contradictions: readonly EmployerMatchContradiction[];
}

export interface EmployerMatchAssessment {
  readonly identity: EmployerMatchDimensionAssessment;
  readonly geography: EmployerMatchDimensionAssessment;
  readonly characteristics: EmployerMatchDimensionAssessment;
  readonly intermediary: EmployerMatchDimensionAssessment;
}
