import type { EmployerCharacteristicEvidence } from "../evidence/EmployerCharacteristicEvidence.js";
import type { LocationEvidence } from "../evidence/LocationEvidence.js";
import type { OrganizationEvidence } from "../evidence/OrganizationEvidence.js";

export type MatchSignalStrength =
  | "WEAK"
  | "MEDIUM"
  | "STRONG"
  | "VERY_STRONG";

export type ContradictionStrength =
  | "WEAK"
  | "MODERATE"
  | "STRONG"
  | "DECISIVE";

export type EmployerRelevantEvidence =
  | OrganizationEvidence
  | LocationEvidence
  | EmployerCharacteristicEvidence;

export type EmployerMatchSignalKind =
  | "EMPLOYER_IDENTITY"
  | "INTERMEDIARY_CONTEXT"
  | "LOCATION"
  | "CHARACTERISTIC";

export interface EmployerMatchSignal {
  readonly kind: EmployerMatchSignalKind;
  readonly strength: MatchSignalStrength;
  readonly explanation: string;
  readonly leftEvidence: EmployerRelevantEvidence;
  readonly rightEvidence: EmployerRelevantEvidence;
}

export type EmployerMatchContradictionKind =
  | "EMPLOYER_IDENTITY"
  | "CHARACTERISTIC";

export interface EmployerMatchContradiction {
  readonly kind: EmployerMatchContradictionKind;
  readonly strength: ContradictionStrength;
  readonly explanation: string;
  readonly leftEvidence: EmployerRelevantEvidence;
  readonly rightEvidence: EmployerRelevantEvidence;
}

export interface EmployerEvidenceComparison {
  readonly positiveSignals: readonly EmployerMatchSignal[];
  readonly contradictions: readonly EmployerMatchContradiction[];
}
