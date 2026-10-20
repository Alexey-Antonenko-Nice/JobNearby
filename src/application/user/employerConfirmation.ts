import { normalizeOrganizationEvidenceName } from "../../domain/evidence/OrganizationEvidence.js";
import type { CanonicalVacancy, VacancyOrganizationRelationship } from "../../domain/vacancies/CanonicalVacancy.js";
import { findConfirmedEmployerMemory } from "../recognition/findConfirmedEmployerMemory.js";
import type { MemoryReviewDependencies } from "./employerMemoryReview.js";

/** A read-only identity proof, shared by review and direct-confirmation POST. */
export async function isEmployerConfirmationRedundant(
  vacancy: CanonicalVacancy,
  candidate: string | null,
  dependencies: MemoryReviewDependencies,
): Promise<boolean> {
  const repository = dependencies.assignmentRepository;
  const findCandidates = dependencies.employerClusterRepository.findCandidates;
  if (candidate === null || !repository || !findCandidates) return false;
  const effective = await Promise.all(vacancy.sourceObservationIds.map((id) => repository.findEffectiveByObservationId(id)));
  const current = effective.at(-1);
  // Explicit current confirmations retain their existing idempotent POST behavior.
  // This rule prevents a propagated ACCEPTED assignment becoming USER_CONFIRMED.
  if (current?.status !== "ACCEPTED") return false;
  if (effective.some((assignment) => assignment !== null && assignment.employerClusterId !== current.employerClusterId)) return false;
  if (vacancy.organizationRelationships.some((relationship) => relationship.role === "EMPLOYER"
    && relationship.employerClusterId !== undefined && relationship.employerClusterId !== current.employerClusterId)) return false;
  const cluster = await dependencies.employerClusterRepository.findById(current.employerClusterId);
  if (!cluster || !["PROBABLY_RESOLVED", "RESOLVED"].includes(cluster.status)) return false;
  const proposals = await Promise.all(vacancy.sourceObservationIds.map((id) => repository.findCurrentProposalByObservationId(id)));
  if (proposals.some((proposal) => proposal !== null)) return false;
  const memory = await findConfirmedEmployerMemory(
    vacancy.organizationRelationships, vacancy.sourceObservationIds,
    { findCandidates: findCandidates.bind(dependencies.employerClusterRepository) },
    repository, dependencies.aliasRepository,
  );
  return memory.names.length === 1 && memory.matches.length === 1
    && memory.matches[0]!.cluster.id === current.employerClusterId
    && normalizeOrganizationEvidenceName(memory.matches[0]!.currentOrganizationName) === normalizeOrganizationEvidenceName(candidate);
}

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
