import { getEmployerAliasSelection } from "./employerAliasReview.js";
import type { EmployerAliasEvidenceRepository } from "../../domain/recognition/EmployerAliasEvidence.js";
import { getNamedClientEmployerCandidate } from "./namedClientEmployerReview.js";
import type { EmployerReviewCandidate } from "../../domain/user/EmployerReviewCandidate.js";
import { hasRejectedEmployerMemory, getEmployerMemoryReviewCandidates } from "./employerMemoryReview.js";
import { normalizeOrganizationEvidenceName } from "../../domain/evidence/OrganizationEvidence.js";
import type { EmployerClusterRepository } from "../../domain/recognition/EmployerClusterRepository.js";
import type { SourceObservationRepository } from "../../domain/capture/SourceObservationRepository.js";
import type { UserVacancyInteractionRepository } from "../../domain/user/UserVacancyInteractionRepository.js";
import type { VacancyReviewOrganizationRelationship, VacancyReviewView } from "../../domain/user/VacancyReviewView.js";
import type { CanonicalVacancyId, VacancyOrganizationRelationship } from "../../domain/vacancies/CanonicalVacancy.js";
import type { CanonicalVacancyRepository } from "../../domain/vacancies/CanonicalVacancyRepository.js";
import type { EmployerMemoryPublicDataSource } from "./EmployerMemoryPublicDataSource.js";
import { collectVacancySourceLinks } from "./collectVacancySourceLinks.js";
import { effectiveEmployerClusterId } from "./effectiveEmployerClusterId.js";
import { getEmployerMemoryView } from "./getEmployerMemoryView.js";
import { getUserVacancyHistory } from "./getUserVacancyHistory.js";
import { employerConfirmationCandidate } from "./employerConfirmation.js";

export async function getVacancyReviewView(
  canonicalVacancyId: CanonicalVacancyId,
  dependencies: {
    readonly aliasRepository?: EmployerAliasEvidenceRepository;
    readonly canonicalVacancyRepository: Pick<CanonicalVacancyRepository, "findById">;
    readonly sourceObservationRepository: Pick<SourceObservationRepository, "findById">;
    readonly interactionRepository: UserVacancyInteractionRepository;
    readonly employerClusterRepository: Pick<EmployerClusterRepository, "findById"> & Partial<Pick<EmployerClusterRepository, "findCandidates">>;
    readonly assignmentRepository?: import("../../domain/recognition/ObservationClusterAssignmentRepository.js").ObservationClusterAssignmentRepository;
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
  const confirmedAssignment = dependencies.assignmentRepository === undefined ? null : await latestEffectiveAssignment(vacancy.sourceObservationIds, dependencies.assignmentRepository);
  const employerClusterId = confirmedAssignment?.employerClusterId ?? effectiveEmployerClusterId(vacancy.organizationRelationships);
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

  const memoryCandidates = await getEmployerMemoryReviewCandidates(vacancy, dependencies);
  const namedClient = memoryCandidates.length === 0 ? await getNamedClientEmployerCandidate(vacancy, dependencies) : null;
  const aliasSelection = memoryCandidates.length === 0 ? await getEmployerAliasSelection(vacancy, dependencies) : null;
  const employerCandidates: EmployerReviewCandidate[] = [...memoryCandidates.map((candidate) => ({ ...candidate, type: "CONFIRMED_MEMORY" as const })), ...(namedClient ? [namedClient] : []), ...(aliasSelection ? [aliasSelection] : [])];
  const knownAliases = employerClusterId && dependencies.aliasRepository ? await dependencies.aliasRepository.findByClusterId(employerClusterId) : [];
  const rejectedMemory = await hasRejectedEmployerMemory(vacancy, employerConfirmationCandidate(vacancy.organizationRelationships), dependencies);
  return {
    ...(employerCandidates.length === 0 ? {} : { employerReview: { required: true as const, candidates: employerCandidates } }),
    ...(memoryCandidates.length === 0 ? {} : { employerMemoryReview: { required: true as const, candidates: memoryCandidates } }),
    vacancy: {
      canonicalVacancyId,
      canonicalizationStatus: vacancy.canonicalizationStatus,
      title: resolvedValue(vacancy.role)?.title ?? null,
      location: resolvedValue(vacancy.location),
      locationAlternatives: vacancy.location.alternatives?.map(({ value }) => value) ?? [],
      engagement: resolvedValue(vacancy.engagement),
      workMode: resolvedValue(vacancy.workMode),
      compensation: resolvedValue(vacancy.compensation),
      latestObservedAt: latestDate(observations.map(({ observedAt }) => observedAt)),
      sourceObservationCount,
      sourceLinks: collectVacancySourceLinks(observations),
    },
    user: {
      currentState: history.currentState,
      lastInteractionAt: history.events.at(-1)?.occurredAt ?? null,
      everApplied: eventTypes.has("APPLIED"),
      everInterviewed: eventTypes.has("INTERVIEW"),
      everRejected: eventTypes.has("REJECTED"),
    },
    employer: {
      ...(knownAliases.length === 0 ? {} : { aliasEvidence: knownAliases }),
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
      confirmationCandidate: memoryCandidates.length > 0 || rejectedMemory ? null : (employerMemory?.employerCluster.status !== undefined
        && employerMemory.employerCluster.status !== "UNRESOLVED"
        && employerMemory.employerCluster.status !== "PROBABLY_RESOLVED")
        || confirmedAssignment?.status === "USER_CONFIRMED"
        ? null : employerConfirmationCandidate(vacancy.organizationRelationships),
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

async function latestEffectiveAssignment(
  observationIds: readonly string[],
  repository: import("../../domain/recognition/ObservationClusterAssignmentRepository.js").ObservationClusterAssignmentRepository,
) {
  const assignments = (await Promise.all(observationIds.map((id) => repository.findEffectiveByObservationId(id)))).filter((value) => value !== null);
  return assignments.find(({ status }) => status === "USER_CONFIRMED") ?? assignments.at(-1) ?? null;
}

function resolvedValue<T>(field: { readonly status: string; readonly value?: T }): T | null {
  return field.status === "RESOLVED" && field.value !== undefined ? field.value : null;
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
