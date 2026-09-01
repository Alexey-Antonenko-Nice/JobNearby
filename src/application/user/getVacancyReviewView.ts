import { normalizeOrganizationEvidenceName } from "../../domain/evidence/OrganizationEvidence.js";
import type { EmployerClusterRepository } from "../../domain/recognition/EmployerClusterRepository.js";
import type { SourceObservationRepository } from "../../domain/capture/SourceObservationRepository.js";
import type { UserVacancyInteractionRepository } from "../../domain/user/UserVacancyInteractionRepository.js";
import type { VacancyReviewOrganizationRelationship, VacancyReviewView } from "../../domain/user/VacancyReviewView.js";
import type { CanonicalVacancyId, VacancyOrganizationRelationship } from "../../domain/vacancies/CanonicalVacancy.js";
import type { CanonicalVacancyRepository } from "../../domain/vacancies/CanonicalVacancyRepository.js";
import type { EmployerMemoryPublicDataSource } from "./EmployerMemoryPublicDataSource.js";
import { getEmployerMemoryView } from "./getEmployerMemoryView.js";
import { getUserVacancyHistory } from "./getUserVacancyHistory.js";

export async function getVacancyReviewView(
  canonicalVacancyId: CanonicalVacancyId,
  dependencies: {
    readonly canonicalVacancyRepository: Pick<CanonicalVacancyRepository, "findById">;
    readonly sourceObservationRepository: Pick<SourceObservationRepository, "findById">;
    readonly interactionRepository: UserVacancyInteractionRepository;
    readonly employerClusterRepository: Pick<EmployerClusterRepository, "findById">;
    readonly employerMemoryPublicDataSource: EmployerMemoryPublicDataSource;
  },
): Promise<VacancyReviewView> {
  const vacancy = await dependencies.canonicalVacancyRepository.findById(canonicalVacancyId);
  if (vacancy === null) throw new Error(`CanonicalVacancy "${canonicalVacancyId}" does not exist.`);

  const observations = await Promise.all(vacancy.sourceObservationIds.map(async (id) => {
    const observation = await dependencies.sourceObservationRepository.findById(id);
    if (observation === null) {
      throw new Error(`CanonicalVacancy "${canonicalVacancyId}" references missing SourceObservation "${id}".`);
    }
    return observation;
  }));
  const history = await getUserVacancyHistory(canonicalVacancyId, dependencies.interactionRepository);
  const eventTypes = new Set(history.events.map(({ type }) => type));
  const employerClusterId = explicitEmployerClusterId(vacancy.organizationRelationships);
  const employerMemory = employerClusterId === null ? null : await getEmployerMemoryView(
    employerClusterId,
    {
      employerClusterRepository: dependencies.employerClusterRepository,
      publicDataSource: dependencies.employerMemoryPublicDataSource,
      interactionRepository: dependencies.interactionRepository,
    },
  );
  const previousVacancies = employerMemory?.vacancies.filter(
    ({ canonicalVacancyId: id }) => id !== canonicalVacancyId,
  ) ?? [];
  const knownEmployer = previousVacancies.length > 0;
  const sourceObservationCount = observations.length;
  const multipleObservations = sourceObservationCount > 1;
  const groupedOrganizations = groupOrganizations(vacancy.organizationRelationships);

  return {
    vacancy: {
      canonicalVacancyId,
      canonicalizationStatus: vacancy.canonicalizationStatus,
      title: resolvedValue(vacancy.role)?.title ?? null,
      location: resolvedValue(vacancy.location),
      engagement: resolvedValue(vacancy.engagement),
      workMode: resolvedValue(vacancy.workMode),
      compensation: resolvedValue(vacancy.compensation),
      latestObservedAt: latestDate(observations.map(({ observedAt }) => observedAt)),
      sourceObservationCount,
    },
    user: {
      currentState: history.currentState,
      lastInteractionAt: history.events.at(-1)?.occurredAt ?? null,
      everApplied: eventTypes.has("APPLIED"),
      everInterviewed: eventTypes.has("INTERVIEW"),
      everRejected: eventTypes.has("REJECTED"),
    },
    employer: {
      employerClusterId,
      status: employerMemory?.employerCluster.status ?? null,
      resolvedEmployerId: employerMemory?.employerCluster.resolvedEmployerId ?? null,
      knownBefore: knownEmployer,
      previousVacancyCount: previousVacancies.length,
      previousInteractedVacancyCount: previousVacancies.filter(
        ({ currentUserState }) => currentUserState !== "NEW",
      ).length,
      everAppliedToEmployer: employerMemory?.vacancies.some(({ everApplied }) => everApplied) ?? false,
      everInterviewedWithEmployer: employerMemory?.vacancies.some(({ everInterviewed }) => everInterviewed) ?? false,
      everRejectedByEmployer: employerMemory?.vacancies.some(({ everRejected }) => everRejected) ?? false,
    },
    organizations: groupedOrganizations,
    recognition: {
      sameCanonicalVacancySeenBefore: multipleObservations,
      employerSeenBefore: knownEmployer,
      unresolvedEmployer: employerMemory === null
        || employerMemory.employerCluster.status === "UNRESOLVED"
        || employerMemory.employerCluster.status === "CONFLICTED",
    },
    reviewSignals: {
      isNewVacancy: history.currentState === "NEW",
      isKnownEmployer: knownEmployer,
      alreadyAppliedToThisVacancy: eventTypes.has("APPLIED"),
      previouslyAppliedToEmployer: previousVacancies.some(({ everApplied }) => everApplied),
      previouslyInterviewedWithEmployer: previousVacancies.some(({ everInterviewed }) => everInterviewed),
      previouslyRejectedByEmployer: previousVacancies.some(({ everRejected }) => everRejected),
      hasMultipleSourceObservations: multipleObservations,
    },
  };
}

function resolvedValue<T>(field: { readonly status: string; readonly value?: T }): T | null {
  return field.status === "RESOLVED" && field.value !== undefined ? field.value : null;
}

function explicitEmployerClusterId(
  relationships: readonly VacancyOrganizationRelationship[],
): string | null {
  const ids = [...new Set(relationships.flatMap(({ role, employerClusterId }) =>
    role === "EMPLOYER" && employerClusterId !== undefined ? [employerClusterId] : []))];
  if (ids.length > 1) {
    throw new Error("Canonical vacancy has multiple explicit employer-cluster relationships.");
  }
  return ids[0] ?? null;
}

function groupOrganizations(
  relationships: readonly VacancyOrganizationRelationship[],
): VacancyReviewView["organizations"] {
  const summaries = relationships.map(({ organizationId, employerClusterId, rawName, role }) => ({
    ...(organizationId === undefined ? {} : { organizationId }),
    ...(employerClusterId === undefined ? {} : { employerClusterId }),
    ...(rawName === undefined ? {} : { rawName }),
    role,
  })).sort(compareOrganizations);
  const roles = (...accepted: readonly string[]) => summaries.filter(({ role }) => accepted.includes(role));
  return {
    employerRelationships: roles("EMPLOYER"),
    displayedCompanies: roles("DISPLAYED_COMPANY"),
    recruiters: roles("RECRUITER"),
    consultancies: roles("CONSULTANCY"),
    staffingAgencies: roles("STAFFING_AGENCY"),
    clients: roles("CLIENT"),
    otherRelationships: roles("PROJECT_CUSTOMER", "UNKNOWN"),
  };
}

function compareOrganizations(
  left: VacancyReviewOrganizationRelationship,
  right: VacancyReviewOrganizationRelationship,
): number {
  return organizationKey(left).localeCompare(organizationKey(right));
}

function organizationKey(relationship: VacancyReviewOrganizationRelationship): string {
  const name = relationship.rawName === undefined
    ? ""
    : normalizeOrganizationEvidenceName(relationship.rawName);
  return [name, relationship.role, relationship.organizationId ?? "", relationship.employerClusterId ?? ""]
    .join("\u0000");
}

function latestDate(values: readonly Date[]): Date | null {
  return values.reduce<Date | null>((latest, value) =>
    latest === null || value.getTime() > latest.getTime() ? value : latest, null);
}
