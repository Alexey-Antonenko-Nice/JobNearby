import type { EmployerAliasEvidenceRepository } from "../../domain/recognition/EmployerAliasEvidence.js";
import { compareUserVacancyInteractionEvents, deriveUserVacancyState } from "../../domain/user/UserVacancyInteractionEvent.js";
import { normalizeOrganizationEvidenceName } from "../../domain/evidence/OrganizationEvidence.js";
import type { EmployerClusterId } from "../../domain/recognition/EmployerCluster.js";
import type { EmployerClusterRepository } from "../../domain/recognition/EmployerClusterRepository.js";
import type {
  EmployerMemoryOrganizationSeen,
  EmployerMemoryVacancy,
  EmployerMemoryView,
} from "../../domain/user/EmployerMemoryView.js";
import type { UserVacancyInteractionRepository } from "../../domain/user/UserVacancyInteractionRepository.js";
import type { EmployerMemoryPublicDataSource } from "./EmployerMemoryPublicDataSource.js";

export async function getEmployerMemoryView(
  employerClusterId: EmployerClusterId,
  dependencies: {
    readonly employerClusterRepository: Pick<EmployerClusterRepository, "findById">;
    readonly excludeCanonicalVacancyId?: string;
    readonly aliasRepository?: EmployerAliasEvidenceRepository;
    readonly publicDataSource: EmployerMemoryPublicDataSource;
    readonly interactionRepository: UserVacancyInteractionRepository;
  },
): Promise<EmployerMemoryView> {
  const cluster = await dependencies.employerClusterRepository.findById(employerClusterId);
  if (cluster === null) throw new Error(`EmployerCluster "${employerClusterId}" does not exist.`);
  const publicVacancies = [...new Map((await dependencies.publicDataSource.findByEmployerClusterId(employerClusterId))
    .filter((vacancy) => vacancy.canonicalVacancyId !== dependencies.excludeCanonicalVacancyId)
    .map((vacancy) => [vacancy.canonicalVacancyId, vacancy])).values()];
  const ids = publicVacancies.map(({ canonicalVacancyId }) => canonicalVacancyId);
  const repository = dependencies.interactionRepository;
  const allEvents = repository.findByCanonicalVacancyIds
    ? await repository.findByCanonicalVacancyIds(ids)
    : (await Promise.all(ids.map((id) => repository.findByCanonicalVacancyId(id)))).flat();
  const eventsByVacancy = new Map<string, typeof allEvents[number][]>();
  for (const event of allEvents) {
    const events = eventsByVacancy.get(event.canonicalVacancyId) ?? [];
    events.push(event);
    eventsByVacancy.set(event.canonicalVacancyId, events);
  }
  const vacancies = publicVacancies.map((vacancy): EmployerMemoryVacancy => {
    const events = (eventsByVacancy.get(vacancy.canonicalVacancyId) ?? []).sort(compareUserVacancyInteractionEvents);
    const eventTypes = new Set(events.map(({ type }) => type));
    return {
      ...vacancy,
      currentUserState: deriveUserVacancyState(events),
      lastUserInteractionAt: events.at(-1)?.occurredAt ?? null,
      everContacted: eventTypes.has("CONTACTED"),
      everOffered: eventTypes.has("OFFER"),
      everWithdrawn: eventTypes.has("WITHDRAWN"),
      everApplied: eventTypes.has("APPLIED"),
      everInterviewed: eventTypes.has("INTERVIEW"),
      everRejected: eventTypes.has("REJECTED"),
      recruiterConsultancyRelationships: vacancy.organizationRelationships.filter(
        ({ role }) => role === "RECRUITER" || role === "CONSULTANCY" || role === "STAFFING_AGENCY",
      ),
    };
  });
  vacancies.sort((left, right) =>
    (right.latestObservedAt?.getTime() ?? Number.NEGATIVE_INFINITY)
      - (left.latestObservedAt?.getTime() ?? Number.NEGATIVE_INFINITY)
    || left.canonicalVacancyId.localeCompare(right.canonicalVacancyId));

  const aliases = await dependencies.aliasRepository?.findActiveByClusterId(employerClusterId) ?? [];
  const knownNames = new Map<string, string>();
  for (const name of [cluster.displayLabel, ...aliases.map(({ aliasName }) => aliasName)]) {
    if (name?.trim() && !knownNames.has(normalizeOrganizationEvidenceName(name))) {
      knownNames.set(normalizeOrganizationEvidenceName(name), name);
    }
  }
  return {
    knownNames: [...knownNames.values()],
    employerCluster: {
      id: cluster.id,
      status: cluster.status,
      ...(cluster.displayLabel === undefined ? {} : { displayLabel: cluster.displayLabel }),
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
    everContactedCount: vacancies.filter(({ everContacted }) => everContacted).length,
    everOfferedCount: vacancies.filter(({ everOffered }) => everOffered).length,
    everWithdrawnCount: vacancies.filter(({ everWithdrawn }) => everWithdrawn).length,
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
