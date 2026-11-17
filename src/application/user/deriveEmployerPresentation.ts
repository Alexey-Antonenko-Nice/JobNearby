import type { EmployerClusterStatus } from "../../domain/recognition/EmployerCluster.js";
import type { ObservationClusterAssignment } from "../../domain/recognition/ObservationClusterAssignment.js";
import type { VacancyOrganizationRelationship } from "../../domain/vacancies/CanonicalVacancy.js";
import type { EmployerDisplayState } from "../../domain/user/EmployerDisplayState.js";
import { isExplicitHumanEmployerAssignment } from "./isExplicitHumanEmployerAssignment.js";

export function deriveEmployerPresentation(input: {
  readonly clusterStatus: EmployerClusterStatus | null;
  readonly assignment: Pick<ObservationClusterAssignment, "status" | "algorithm"> | null;
  readonly hasHumanEmployerRoleDecision: boolean;
  readonly reviewRequired: boolean;
  readonly confirmedEmployerName?: string;
  readonly clusterDisplayName?: string;
  readonly organizationRelationships: readonly VacancyOrganizationRelationship[];
}): { readonly displayState: EmployerDisplayState; readonly displayName: string | null } {
  const displayState = input.reviewRequired || input.clusterStatus === "CONFLICTED"
    ? "REVIEW_REQUIRED"
    : input.hasHumanEmployerRoleDecision || isExplicitHumanEmployerAssignment(input.assignment)
      ? "HUMAN_CONFIRMED"
      : input.assignment?.status === "ACCEPTED" && input.assignment.algorithm === "confirmed-employer-memory"
        ? "MEMORY_REUSED"
        : input.clusterStatus === null || input.clusterStatus === "UNRESOLVED"
          ? "UNRESOLVED"
          : "INFERRED";
  const displayName = usableName(input.confirmedEmployerName)
    ?? usableName(input.clusterDisplayName)
    ?? uniqueName(input.organizationRelationships, "EMPLOYER")
    ?? uniqueName(input.organizationRelationships, "DISPLAYED_COMPANY");
  return { displayState, displayName };
}

function uniqueName(
  relationships: readonly VacancyOrganizationRelationship[],
  role: VacancyOrganizationRelationship["role"],
): string | null {
  const names = [...new Set(relationships.flatMap((relationship) => {
    if (relationship.role !== role || relationship.rawName === undefined) return [];
    const name = usableName(relationship.rawName);
    return name === null ? [] : [name];
  }))];
  return names.length === 1 ? names[0]! : null;
}

function usableName(value: string | undefined): string | null {
  const name = value?.trim();
  return name === undefined || name.length === 0 || /^unknown\s+employer(?:\s*[—-].*)?$/iu.test(name)
    ? null
    : name;
}
