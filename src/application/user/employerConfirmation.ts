import type { VacancyOrganizationRelationship } from "../../domain/vacancies/CanonicalVacancy.js";

export function employerConfirmationCandidate(
  relationships: readonly VacancyOrganizationRelationship[],
): string | null {
  const displayed = uniqueNames(relationships, "DISPLAYED_COMPANY");
  if (displayed.length !== 1) return null;
  const candidate = displayed[0]!;
  if (/^(?:job\s+post\s+details|d[eé]tails?\s+de\s+l['’]emploi|job\s+details|unknown(?:\s+employer)?)/iu.test(candidate)) return null;
  if (relationships.some(({ role, rawName }) =>
    (role === "EMPLOYER" && usable(rawName) !== undefined && usable(rawName) !== candidate)
    || (role === "STAFFING_AGENCY" || role === "CLIENT" || role === "RECRUITER") && usable(rawName) === candidate)) return null;
  return candidate;
}

function uniqueNames(
  relationships: readonly VacancyOrganizationRelationship[],
  role: VacancyOrganizationRelationship["role"],
): string[] {
  return [...new Set(relationships.filter(({ role: itemRole }) => itemRole === role)
    .map(({ rawName }) => usable(rawName)).filter((value): value is string => value !== undefined))];
}

function usable(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized === undefined || normalized.length === 0 ? undefined : normalized;
}