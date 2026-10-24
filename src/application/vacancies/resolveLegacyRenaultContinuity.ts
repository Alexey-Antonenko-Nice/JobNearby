import type { SourceObservation } from "../../domain/capture/SourceObservation.js";
import type { SourceObservationRepository } from "../../domain/capture/SourceObservationRepository.js";
import type { CanonicalVacancyRepository } from "../../domain/vacancies/CanonicalVacancyRepository.js";
import { RENAULT_WORKDAY_HOST, renaultRouteIdentity, RenaultSelectedVacancyContextLocator } from "../acquisition/RenaultWorkdayVacancy.js";
function validated(observation: SourceObservation) {
  const acquisition = observation.metadata.acquisition as {
    html?: unknown;
  } | undefined;
  return observation.source.sourceName === RENAULT_WORKDAY_HOST && typeof acquisition?.html === "string" ? new RenaultSelectedVacancyContextLocator().locate({
    providerKey: "RENAULT_WORKDAY",
    sourceUrl: observation.source.sourceUrl ?? "",
    html: acquisition.html,
    ...(observation.source.externalId ? {
      externalId: observation.source.externalId
    } : {})
  }) : undefined;
}
/** Existing duplicate legacy canonicals are never merged. One is chosen to receive the
 * recapture: the only one carrying human decisions, else the earliest. Several
 * human-decided duplicates, or no way to tell, stays ambiguous. */
async function chooseCanonical(matches: ReadonlyMap<string, number>, humanStateLookup: HumanStateLookup | undefined): Promise<string | undefined> {
  if (matches.size === 1) return [...matches.keys()][0];
  if (matches.size === 0 || !humanStateLookup) return undefined;
  const decided = await humanStateLookup([...matches.keys()]);
  const pool = [...matches].filter(([id]) => decided.has(id));
  if (pool.length > 1) return undefined;
  const candidates = pool.length === 1 ? pool : [...matches];
  return candidates.sort(([leftId, left], [rightId, right]) => left - right || leftId.localeCompare(rightId))[0]![0];
}
export type HumanStateLookup = (canonicalVacancyIds: readonly string[]) => Promise<ReadonlySet<string>>;
/** A URL match alone never migrates an identity. Both snapshots must independently
 * validate their bounded vacancy, route, Apply and displayed requisition ID. */
export async function resolveLegacyRenaultContinuity(observation: SourceObservation, deps: {
  sourceObservationRepository: SourceObservationRepository;
  canonicalVacancyRepository: CanonicalVacancyRepository;
  humanStateLookup?: HumanStateLookup;
}): Promise<string | undefined> {
  const {
    sourceName,
    sourceUrl,
    externalId
  } = observation.source;
  const lookup = deps.sourceObservationRepository.findUnidentifiedBySourceUrlFragment;
  if (!lookup || !externalId || !sourceUrl || sourceName !== RENAULT_WORKDAY_HOST || renaultRouteIdentity(sourceUrl)?.routeId !== externalId) return undefined;
  const current = validated(observation);
  if (!current) return undefined;
  const repository = deps.canonicalVacancyRepository;
  if ((await repository.findBySourceObservationId(observation.id)) || (await repository.findByExactSourceIdentity(sourceName, externalId))) return undefined;
  const matches = new Map<string, number>();
  for (const candidate of await lookup.call(deps.sourceObservationRepository, sourceName, `_${externalId}`)) {
    const previous = validated(candidate);
    if (!previous || previous.providerExternalId !== externalId) continue;
    const canonical = await repository.findBySourceObservationId(candidate.id);
    if (canonical) matches.set(canonical.id, Math.min(matches.get(canonical.id) ?? Infinity, candidate.observedAt.getTime()));
  }
  const id = await chooseCanonical(matches, deps.humanStateLookup);
  if (id === undefined) return undefined;
  for (const memberId of await repository.findClaimedSourceObservationIds(id)) {
    const member = await deps.sourceObservationRepository.findById(memberId);
    const context = member ? validated(member) : undefined;
    if (!context || context.providerExternalId !== externalId) return undefined;
  }
  return id;
}
