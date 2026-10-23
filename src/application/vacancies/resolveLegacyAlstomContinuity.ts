import type { SourceObservation } from "../../domain/capture/SourceObservation.js";
import type { SourceObservationRepository } from "../../domain/capture/SourceObservationRepository.js";
import type { CanonicalVacancyRepository } from "../../domain/vacancies/CanonicalVacancyRepository.js";
import { ALSTOM_HOST, alstomPostingId, AlstomSelectedVacancyContextLocator } from "../acquisition/AlstomVacancy.js";
function validated(observation: SourceObservation) {
  const acquisition = observation.metadata.acquisition as {
    html?: unknown;
  } | undefined;
  return observation.source.sourceName === ALSTOM_HOST && typeof acquisition?.html === "string" ? new AlstomSelectedVacancyContextLocator().locate({
    providerKey: "ALSTOM",
    sourceUrl: observation.source.sourceUrl ?? "",
    html: acquisition.html,
    ...(observation.source.externalId ? {
      externalId: observation.source.externalId
    } : {})
  }) : undefined;
}
/** A URL match alone never migrates an identity. Both snapshots must independently
 * validate their bounded vacancy, posting/Apply ID and separate requisition ID. */
export async function resolveLegacyAlstomContinuity(observation: SourceObservation, deps: {
  sourceObservationRepository: SourceObservationRepository;
  canonicalVacancyRepository: CanonicalVacancyRepository;
}): Promise<string | undefined> {
  const {
    sourceName,
    sourceUrl,
    externalId
  } = observation.source;
  const lookup = deps.sourceObservationRepository.findUnidentifiedBySourceUrlFragment;
  if (!lookup || !externalId || !sourceUrl || sourceName !== ALSTOM_HOST || alstomPostingId(sourceUrl) !== externalId) return undefined;
  const current = validated(observation);
  if (!current) return undefined;
  const repository = deps.canonicalVacancyRepository;
  if ((await repository.findBySourceObservationId(observation.id)) || (await repository.findByExactSourceIdentity(sourceName, externalId))) return undefined;
  const matches = new Set<string>();
  for (const candidate of await lookup.call(deps.sourceObservationRepository, sourceName, `/${externalId}`)) {
    const previous = validated(candidate);
    if (!previous || previous.providerExternalId !== externalId) continue;
    if (previous.metadata?.requisitionId !== current.metadata?.requisitionId) return undefined;
    const canonical = await repository.findBySourceObservationId(candidate.id);
    if (canonical) matches.add(canonical.id);
  }
  if (matches.size !== 1) return undefined;
  const id = [...matches][0]!;
  for (const memberId of await repository.findClaimedSourceObservationIds(id)) {
    const member = await deps.sourceObservationRepository.findById(memberId);
    const context = member ? validated(member) : undefined;
    if (!context || context.providerExternalId !== externalId || context.metadata?.requisitionId !== current.metadata?.requisitionId) return undefined;
  }
  return id;
}
