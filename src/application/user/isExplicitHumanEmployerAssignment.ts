import type { ObservationClusterAssignment } from "../../domain/recognition/ObservationClusterAssignment.js";

const explicitEmployerAssignmentAlgorithms = new Set([
  "user-vacancy-organization-role",
  "user-employer-confirmation",
  "user-employer-memory-review",
  "user-named-client-employer-review",
]);

export function isExplicitHumanEmployerAssignment(
  assignment: Pick<ObservationClusterAssignment, "status" | "algorithm"> | null | undefined,
): boolean {
  return assignment?.status === "USER_CONFIRMED"
    && explicitEmployerAssignmentAlgorithms.has(assignment.algorithm);
}
