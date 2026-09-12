import type { EmployerClusterStatus } from "../recognition/EmployerCluster.js";

export interface EmployerMemoryReviewCandidate {
  readonly aliasEvidence?: readonly import("../recognition/EmployerAliasEvidence.js").EmployerAliasEvidence[];
  readonly employerClusterId: string;
  readonly displayLabel: string;
  readonly status: EmployerClusterStatus;
  readonly currentOrganizationName: string;
  readonly reasonCodes: readonly ("MULTIPLE_CONFIRMED_CLUSTERS" | "MULTIPLE_CURRENT_EMPLOYER_NAMES" | "CONFLICTING_EFFECTIVE_ASSIGNMENT" | "RECOGNITION_REVIEW_REQUIRED")[];
  readonly explanation: string;
  readonly priorConfirmationExists: true;
  readonly priorConfirmationCount: number;
}
