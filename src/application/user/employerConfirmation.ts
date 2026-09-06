import { normalizeOrganizationEvidenceName } from "../../domain/evidence/OrganizationEvidence.js";
import type { VacancyOrganizationRelationship } from "../../domain/vacancies/CanonicalVacancy.js";

export function employerConfirmationCandidate(
  relationships: readonly VacancyOrganizationRelationship[],
): string | null {
  const displayed = uniqueNames(relationships, "DISPLAYED_COMPANY");
  if (displayed.length !== 1) return null;
  const candidate = displayed[0]!;
  if (/^(?:job\s+post\s+details|d[eé]tails?\s+de\s+l['’]emploi|job\s+details|unknown(?:\s+employer)?)/iu.test(candidate)) return null;
  const candidateKey = normalizeOrganizationEvidenceName(candidate);
  if (relationships.some(({ role, rawName }) => {
    // CLIENT evidence makes the direct-company shortcut unsafe; it does not
    // establish either the displayed company or the client as the employer.
    if (role === "CLIENT") return true;
    const name = usable(rawName);
    if (name === undefined) return false;
    const sameOrganization = normalizeOrganizationEvidenceName(name) === candidateKey;
    return (role === "EMPLOYER" && !sameOrganization)
      || ((role === "STAFFING_AGENCY" || role === "RECRUITER") && sameOrganization);
  })) return null;
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