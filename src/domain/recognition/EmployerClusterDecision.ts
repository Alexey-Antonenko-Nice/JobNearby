import type { EmployerCluster } from "./EmployerCluster.js";

export type EmployerClusterDecision =
  | {
      readonly outcome: "AUTO_MATCH";
      readonly cluster: EmployerCluster;
      readonly confidence: number;
      readonly explanation?: string;
    }
  | {
      readonly outcome: "REVIEW_REQUIRED";
      readonly candidateCluster: EmployerCluster;
      readonly confidence: number;
      readonly explanation?: string;
    }
  | { readonly outcome: "NO_MATCH" };
