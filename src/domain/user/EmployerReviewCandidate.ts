import type { EmployerMemoryReviewCandidate } from "./EmployerMemoryReviewCandidate.js";
import type { EmployerClusterStatus } from "../recognition/EmployerCluster.js";

export interface NamedClientEmployerCandidate {
  readonly aliasEvidence?: readonly import("../recognition/EmployerAliasEvidence.js").EmployerAliasEvidence[];
  readonly type: "NAMED_CLIENT";
  readonly candidateId: string;
  readonly name: string;
  readonly sourceRelationship: "CLIENT";
  readonly canonicalVacancyId: string;
  readonly sourceObservationIds: readonly string[];
  readonly supportingEvidenceIds: readonly string[];
  readonly reasonCode: "NAMED_CLIENT_POSSIBLE_EMPLOYER";
  readonly explanation: string;
  readonly employerClusterId: string | null;
  readonly clusterStatus: EmployerClusterStatus | null;
  readonly priorConfirmationCount: number;
}

export interface EmployerAliasSelection {
  readonly type: "ALIAS_SELECTION";
  readonly candidateId: string;
  readonly name: string;
  readonly sourceRelationship: "DISPLAYED_COMPANY" | "CLIENT";
  readonly explanation: string;
  readonly options: readonly { readonly employerClusterId: string; readonly displayLabel: string }[];
}

export type EmployerReviewCandidate =
  | (EmployerMemoryReviewCandidate & { readonly type: "CONFIRMED_MEMORY" })
  | NamedClientEmployerCandidate
  | EmployerAliasSelection;

export type EmployerReviewDecision = { readonly decision: "CONFIRM" | "REJECT" } & (
  | { readonly type: "CONFIRMED_MEMORY"; readonly employerClusterId: string }
  | { readonly type: "NAMED_CLIENT"; readonly candidateId: string }
  | { readonly type: "ALIAS_SELECTION"; readonly candidateId: string; readonly employerClusterId: string }
);
