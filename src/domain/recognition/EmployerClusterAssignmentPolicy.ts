export interface EmployerClusterAssignmentPolicy {
  readonly automaticAssignmentThreshold: number;
  readonly reviewThreshold: number;
}

export const DEFAULT_EMPLOYER_CLUSTER_ASSIGNMENT_POLICY: EmployerClusterAssignmentPolicy =
  Object.freeze({
    automaticAssignmentThreshold: 0.9,
    reviewThreshold: 0.65,
  });

export function validateEmployerClusterAssignmentPolicy(
  policy: EmployerClusterAssignmentPolicy,
): EmployerClusterAssignmentPolicy {
  const { automaticAssignmentThreshold, reviewThreshold } = policy;

  if (
    !Number.isFinite(reviewThreshold) ||
    !Number.isFinite(automaticAssignmentThreshold) ||
    reviewThreshold < 0 ||
    reviewThreshold > automaticAssignmentThreshold ||
    automaticAssignmentThreshold > 1
  ) {
    throw new Error(
      "Employer-cluster assignment thresholds must satisfy 0 <= reviewThreshold <= automaticAssignmentThreshold <= 1.",
    );
  }

  return Object.freeze({
    automaticAssignmentThreshold,
    reviewThreshold,
  });
}
