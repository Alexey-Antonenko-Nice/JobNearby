import type { SourceObservationId } from "../capture/SourceObservation.js";

export type CanonicalEvidenceRefId = string;

export interface CanonicalEvidenceReference {
  readonly id: CanonicalEvidenceRefId;
  readonly sourceObservationId: SourceObservationId;
  readonly kind: string;
}
