import { normalizeOrganizationEvidenceName } from "../../domain/evidence/OrganizationEvidence.js";
import type { EmployerClusterRepository } from "../../domain/recognition/EmployerClusterRepository.js";
import type { SourceObservationRepository } from "../../domain/capture/SourceObservationRepository.js";
import type { UserVacancyInteractionRepository } from "../../domain/user/UserVacancyInteractionRepository.js";
import type { VacancyInboxItem } from "../../domain/user/VacancyInboxItem.js";
import type { CanonicalVacancy, VacancyOrganizationRelationship } from "../../domain/vacancies/CanonicalVacancy.js";
import type { CanonicalVacancyRepository } from "../../domain/vacancies/CanonicalVacancyRepository.js";
import type { EmployerMemoryPublicDataSource } from "./EmployerMemoryPublicDataSource.js";
import { collectVacancySourceLinks } from "./collectVacancySourceLinks.js";
import { getEmployerMemoryView } from "./getEmployerMemoryView.js";
import { getUserVacancyHistory } from "./getUserVacancyHistory.js";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

export async function getVacancyInbox(
  input: { readonly limit?: number } = {},
  dependencies: {
    readonly canonicalVacancyRepository: Pick<CanonicalVacancyRepository, "findAll">;
    readonly sourceObservationRepository: Pick<SourceObservationRepository, "findById">;
    readonly interactionRepository: UserVacancyInteractionRepository;
    readonly employerClusterRepository: Pick<EmployerClusterRepository, "findById">;
    readonly employerMemoryPublicDataSource: EmployerMemoryPublicDataSource;
  },
): Promise<readonly VacancyInboxItem[]> {
  const limit = validateLimit(input.limit);
  const vacancies = await dependencies.canonicalVacancyRepository.findAll();
  const items = await Promise.all(vacancies.map((vacancy) => itemFor(vacancy, dependencies)));
  return items.sort(compareItems).slice(0, limit);
}

function validateLimit(limit: number | undefined): number {
  if (limit === undefined) return DEFAULT_LIMIT;
  if (!Number.isInteger(limit) || limit <= 0 || limit > MAX_LIMIT) {
    throw new Error(`Inbox limit must be an integer between 1 and ${MAX_LIMIT}.`);
  }
  return limit;
}

async function itemFor(vacancy: CanonicalVacancy, dependencies: Parameters<typeof getVacancyInbox>[1]): Promise<VacancyInboxItem> {
  const observations = await Promise.all(vacancy.sourceObservationIds.map(async (id) => {
    const observation = await dependencies.sourceObservationRepository.findById(id);
    if (observation === null) throw new Error(`CanonicalVacancy "${vacancy.id}" references missing SourceObservation "${id}".`);
    return observation;
  }));
  const history = await getUserVacancyHistory(vacancy.id, dependencies.interactionRepository);
  const employerRelationship = vacancy.organizationRelationships.find(({ role }) => role === "EMPLOYER");
  const employerMemory = employerRelationship?.employerClusterId === undefined ? null : await getEmployerMemoryView(employerRelationship.employerClusterId, {
    employerClusterRepository: dependencies.employerClusterRepository, publicDataSource: dependencies.employerMemoryPublicDataSource, interactionRepository: dependencies.interactionRepository,
  });
  const eventTypes = new Set(history.events.map(({ type }) => type));
  const sourceObservationCount = observations.length;
  const dates = observations.map(({ observedAt }) => observedAt);
  const previousVacancyCount = employerMemory?.vacancies.filter(({ canonicalVacancyId }) => canonicalVacancyId !== vacancy.id).length ?? 0;
  return {
    canonicalVacancyId: vacancy.id, canonicalizationStatus: vacancy.canonicalizationStatus,
    title: resolved(vacancy.role)?.title ?? null, location: resolved(vacancy.location), engagement: resolved(vacancy.engagement), workMode: resolved(vacancy.workMode),
    latestObservedAt: extremeDate(dates, Math.max), firstObservedAt: extremeDate(dates, Math.min), sourceObservationCount, sourceLinks: collectVacancySourceLinks(observations),
    userState: history.currentState, lastUserInteractionAt: history.events.at(-1)?.occurredAt ?? null,
    employer: { employerClusterId: employerRelationship?.employerClusterId ?? null, status: employerMemory?.employerCluster.status ?? null, knownBefore: previousVacancyCount > 0, unresolvedEmployer: employerRelationship?.employerClusterId === undefined || employerMemory?.employerCluster.status === "UNRESOLVED" },
    organizations: { employerName: organizationNames(vacancy.organizationRelationships, "EMPLOYER")[0] ?? null, displayedCompanyNames: organizationNames(vacancy.organizationRelationships, "DISPLAYED_COMPANY"), recruiterNames: organizationNames(vacancy.organizationRelationships, "RECRUITER"), consultancyNames: organizationNames(vacancy.organizationRelationships, "CONSULTANCY") },
    signals: { sameCanonicalVacancySeenBefore: sourceObservationCount > 1, hasMultipleSourceObservations: sourceObservationCount > 1, alreadyAppliedToThisVacancy: eventTypes.has("APPLIED") },
  };
}

function resolved<T>(field: { readonly status: string; readonly value?: T }): T | null { return field.status === "RESOLVED" ? field.value ?? null : null; }
function extremeDate(values: readonly Date[], operation: (...values: number[]) => number): Date | null { if (values.length === 0) return null; return new Date(operation(...values.map((value) => value.getTime()))); }
function organizationNames(relationships: readonly VacancyOrganizationRelationship[], role: VacancyOrganizationRelationship["role"]): string[] { const names = new Map<string, string>(); for (const { rawName, role: relationshipRole } of relationships) if (relationshipRole === role && rawName !== undefined) { const value = rawName.trim(); if (value) { const key = normalizeOrganizationEvidenceName(value); const existing = names.get(key); if (existing === undefined || value.localeCompare(existing) < 0) names.set(key, value); } } return [...names.values()].sort((left, right) => normalizeOrganizationEvidenceName(left).localeCompare(normalizeOrganizationEvidenceName(right)) || left.localeCompare(right)); }
function compareItems(left: VacancyInboxItem, right: VacancyInboxItem): number { return (right.latestObservedAt?.getTime() ?? Number.NEGATIVE_INFINITY) - (left.latestObservedAt?.getTime() ?? Number.NEGATIVE_INFINITY) || left.canonicalVacancyId.localeCompare(right.canonicalVacancyId); }