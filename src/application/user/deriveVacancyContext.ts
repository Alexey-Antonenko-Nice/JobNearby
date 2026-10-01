import type { SourceObservation } from "../../domain/capture/SourceObservation.js";
import type { VacancyContext } from "../../domain/user/VacancyContext.js";
import { compareUserVacancyInteractionEvents, type UserVacancyInteractionEvent } from "../../domain/user/UserVacancyInteractionEvent.js";
import { normalizeVacancyProviderNamespace } from "../../domain/vacancy-identity/normalizeVacancyProviderNamespace.js";

export function deriveVacancyContext(
  canonicalVacancyId: string,
  observations: readonly SourceObservation[],
  events: readonly UserVacancyInteractionEvent[],
): VacancyContext {
  const distinct = [...new Map(observations.map((observation) => [observation.id, observation])).values()];
  const providers = [...new Set(distinct.map((observation) => normalizeVacancyProviderNamespace(observation.source.sourceName)))].sort();
  const times = distinct.map(({ observedAt }) => observedAt).sort((a, b) => a.getTime() - b.getTime());
  const ownEvents = events.filter((event) => event.canonicalVacancyId === canonicalVacancyId).sort(compareUserVacancyInteractionEvents);
  const types = new Set(ownEvents.map(({ type }) => type));
  const latest = ownEvents.at(-1);
  const application = ownEvents.filter(({ type }) => type === "APPLIED").at(-1);
  // Resolve provenance only within this canonical vacancy's persisted membership.
  const appliedObservation = distinct.find(({ id }) => id === (application?.type === "APPLIED" ? application.metadata?.sourceObservationId : undefined));
  return {
    currentCanonicalVacancyId: canonicalVacancyId,
    // Canonical-only review: multiplicity, not an as-of claim about a current observation.
    seenBefore: distinct.length > 1,
    observationCount: distinct.length, sourceCount: providers.length, sourceProviders: providers,
    firstSeenAt: times[0] ?? null, lastSeenAt: times.at(-1) ?? null,
    currentSourceObservationId: null, currentSourceProvider: null,
    reviewedBefore: types.has("REVIEWED"), interestedBefore: types.has("INTERESTED"),
    appliedBefore: types.has("APPLIED"), contactedBefore: types.has("CONTACTED"),
    interviewedBefore: types.has("INTERVIEW"), offeredBefore: types.has("OFFER"),
    rejectedBefore: types.has("REJECTED"), withdrawnBefore: types.has("WITHDRAWN"), closedBefore: types.has("CLOSED"),
    latestInteractionType: latest?.type ?? null, latestInteractionAt: latest?.occurredAt ?? null,
    appliedViaProvider: appliedObservation ? normalizeVacancyProviderNamespace(appliedObservation.source.sourceName) : null,
    appliedViaSourceObservationId: appliedObservation?.id ?? null,
  };
}
