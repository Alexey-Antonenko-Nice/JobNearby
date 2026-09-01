import { normalizeOrganizationEvidenceName } from "../../domain/evidence/OrganizationEvidence.js";
import type { EmployerClusterId } from "../../domain/recognition/EmployerCluster.js";
import type { EmployerClusterRepository } from "../../domain/recognition/EmployerClusterRepository.js";
import type {
  EmployerMemoryOrganizationRelationship,
  EmployerMemoryOrganizationSeen,
  EmployerMemoryVacancy,
  EmployerMemoryView,
} from "../../domain/user/EmployerMemoryView.js";
import type { UserVacancyInteractionRepository } from "../../domain/user/UserVacancyInteractionRepository.js";
import { getUserVacancyHistory } from "./getUserVacancyHistory.js";
import type { EmployerMemoryPublicDataSource } from "./EmployerMemoryPublicDataSource.js";

export async function getEmployerMemoryView(
  employerClusterId: EmployerClusterId,
  dependencies: {
    readonly employerClusterRepository: Pick<EmployerClusterRepository, "findById">;
    readonly publicDataSource: EmployerMemoryPublicDataSource;
    readonly interactionRepository: UserVacancyInteractionRepository;
  },
): Promise<EmployerMemoryView> {
  const cluster = await dependencies.employerClusterRepository.findById(employerClusterId);
  if (cluster === null) throw new Error(`EmployerCluster "${employerClusterId}" does not exist.`);
  const publicVacancies = await dependencies.publicDataSource.findByEmployerClusterId(employerClusterId);
  const vacancies = await Promise.all(publicVacancies.map(async (vacancy): Promise<EmployerMemoryVacancy> => {
    const history = await getUserVacancyHistory(vacancy.canonicalVacancyId, dependencies.interactionRepository);
    const eventTypes = new Set(history.events.map(({ type }) => type));
    return {
      ...vacancy,
      currentUserState: history.currentState,
      lastUserInteractionAt: history.events.at(-1)?.occurredAt ?? null,
      everApplied: eventTypes.has("APPLIED"),
      everInterviewed: eventTypes.has("INTERVIEW"),
      everRejected: eventTypes.has("REJECTED"),
      recruiterConsultancyRelationships: vacancy.organizationRelationships.filter(
        ({ role }) => role === "RECRUITER" || role === "CONSULTANCY" || role === "STAFFING_AGENCY",
      ),
    };
  }));
  vacancies.sort((left, right) =>
    (right.latestObservedAt?.getTime() ?? Number.NEGATIVE_INFINITY)
      - (left.latestObservedAt?.getTime() ?? Number.NEGATIVE_INFINITY)
    || left.canonicalVacancyId.localeCompare(right.canonicalVacancyId));

  return {
    employerCluster: {
      id: cluster.id,
      status: cluster.status,
      ...(cluster.resolvedEmployerId === undefined ? {} : { resolvedEmployerId: cluster.resolvedEmployerId }),
    },
    organizationsSeen: aggregateOrganizations(vacancies),
    vacancies,
    summary: summarize(vacancies),
  };
}

function aggregateOrganizations(vacancies: readonly EmployerMemoryVacancy[]): EmployerMemoryOrganizationSeen[] {
  const aggregates = new Map<string, {
    rawName: string;
    role: EmployerMemoryOrganizationSeen["role"];
    vacancyIds: Set<string>;
    observationCountByVacancy: Map<string, number>;
  }>();
  for (const vacancy of vacancies) for (const relationship of vacancy.organizationRelationships) {
    if (relationship.rawName === undefined) continue;
    const key = `${normalizeOrganizationEvidenceName(relationship.rawName)}\u0000${relationship.role}`;
    const aggregate = aggregates.get(key) ?? {
      rawName: relationship.rawName.trim(), role: relationship.role,
      vacancyIds: new Set(), observationCountByVacancy: new Map(),
    };
    const rawName = relationship.rawName.trim();
    if (rawName < aggregate.rawName) aggregate.rawName = rawName;
    aggregate.vacancyIds.add(vacancy.canonicalVacancyId);
    aggregate.observationCountByVacancy.set(vacancy.canonicalVacancyId, vacancy.sourceObservationCount);
    aggregates.set(key, aggregate);
  }
  return [...aggregates.values()].map((aggregate) => ({
    rawName: aggregate.rawName,
    role: aggregate.role,
    canonicalVacancyIds: [...aggregate.vacancyIds].sort(),
    observationCount: [...aggregate.observationCountByVacancy.values()].reduce((sum, count) => sum + count, 0),
  })).sort((left, right) =>
    normalizeOrganizationEvidenceName(left.rawName).localeCompare(normalizeOrganizationEvidenceName(right.rawName))
    || left.role.localeCompare(right.role));
}

function summarize(vacancies: readonly EmployerMemoryVacancy[]): EmployerMemoryView["summary"] {
  const latestVacancy = maximumDate(vacancies.map(({ latestObservedAt }) => latestObservedAt));
  const latestInteraction = maximumDate(vacancies.map(({ lastUserInteractionAt }) => lastUserInteractionAt));
  const currentStateCounts: Partial<Record<EmployerMemoryVacancy["currentUserState"], number>> = {};
  for (const { currentUserState } of vacancies) {
    currentStateCounts[currentUserState] = (currentStateCounts[currentUserState] ?? 0) + 1;
  }
  return {
    vacancyCount: vacancies.length,
    interactedVacancyCount: vacancies.filter(({ currentUserState }) => currentUserState !== "NEW").length,
    everAppliedCount: vacancies.filter(({ everApplied }) => everApplied).length,
    everInterviewedCount: vacancies.filter(({ everInterviewed }) => everInterviewed).length,
    everRejectedCount: vacancies.filter(({ everRejected }) => everRejected).length,
    currentStateCounts,
    latestVacancyObservedAt: latestVacancy,
    latestUserInteractionAt: latestInteraction,
  };
}

function maximumDate(values: readonly (Date | null)[]): Date | null {
  return values.reduce<Date | null>((latest, value) =>
    value !== null && (latest === null || value.getTime() > latest.getTime()) ? value : latest, null);
}
