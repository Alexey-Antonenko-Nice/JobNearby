import type { EmployerClusterId } from "../../domain/recognition/EmployerCluster.js";
import type { VacancyOrganizationRelationship } from "../../domain/vacancies/CanonicalVacancy.js";

export function effectiveEmployerClusterId(
  relationships: readonly VacancyOrganizationRelationship[],
): EmployerClusterId | null {
  const ids = [...new Set(relationships.flatMap(({ role, employerClusterId }) =>
    role === "EMPLOYER" && employerClusterId !== undefined ? [employerClusterId] : []))];
  if (ids.length > 1) {
    throw new Error("Canonical vacancy has multiple explicit employer-cluster relationships.");
  }
  return ids[0] ?? null;
}