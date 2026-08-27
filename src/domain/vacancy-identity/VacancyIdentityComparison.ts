import type { SourceObservationId } from "../capture/SourceObservation.js";
import type { ExternalIdentifierEvidence } from "../evidence/ExternalIdentifierEvidence.js";

export type VacancyIdentityMatch = "SAME_VACANCY" | "UNRESOLVED";

export type VacancyIdentityComparisonReason =
  | "EXACT_PROVIDER_EXTERNAL_ID_MATCH"
  | "MISSING_EXTERNAL_ID"
  | "PROVIDER_NAMESPACE_MISMATCH"
  | "EXTERNAL_ID_MISMATCH";

export interface MatchedVacancyExternalIdentifier {
  readonly providerNamespace: string;
  readonly value: string;
  readonly leftEvidence: ExternalIdentifierEvidence;
  readonly rightEvidence: ExternalIdentifierEvidence;
}

export interface VacancyIdentityComparison {
  readonly result: VacancyIdentityMatch;
  readonly reason: VacancyIdentityComparisonReason;
  readonly leftObservationId: SourceObservationId;
  readonly rightObservationId: SourceObservationId;
  readonly matchedExternalIdentifier?: MatchedVacancyExternalIdentifier;
}
