import type { EmployerClusterAssignmentPolicy } from "./EmployerClusterAssignmentPolicy.js";
import { validateEmployerClusterAssignmentPolicy } from "./EmployerClusterAssignmentPolicy.js";
import type { EmployerClusterDecision } from "./EmployerClusterDecision.js";
import type { EmployerClusterMatch } from "./EmployerClusterMatcher.js";

export function decideEmployerClusterAssignment(
  match: EmployerClusterMatch | null,
  policy: EmployerClusterAssignmentPolicy,
): EmployerClusterDecision {
  const validatedPolicy = validateEmployerClusterAssignmentPolicy(policy);

  if (match === null) {
    return { outcome: "NO_MATCH" };
  }

  if (
    !Number.isFinite(match.confidence) ||
    match.confidence < 0 ||
    match.confidence > 1
  ) {
    throw new Error("Employer-cluster match confidence must be between 0 and 1.");
  }

  const explanation =
    match.explanation === undefined
      ? {}
      : { explanation: match.explanation };

  if (match.confidence >= validatedPolicy.automaticAssignmentThreshold) {
    return {
      outcome: "AUTO_MATCH",
      cluster: match.cluster,
      confidence: match.confidence,
      ...explanation,
    };
  }

  if (match.confidence >= validatedPolicy.reviewThreshold) {
    return {
      outcome: "REVIEW_REQUIRED",
      candidateCluster: match.cluster,
      confidence: match.confidence,
      ...explanation,
    };
  }

  return { outcome: "NO_MATCH" };
}
