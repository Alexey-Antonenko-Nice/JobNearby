import type { SourceObservation } from "../../domain/capture/SourceObservation.js";
import type { SourceObservationRepository } from "../../domain/capture/SourceObservationRepository.js";
import type { CanonicalVacancyRepository } from "../../domain/vacancies/CanonicalVacancyRepository.js";
import { stellantisVacancyId, StellantisSelectedVacancyContextLocator } from "../acquisition/StellantisVacancy.js";
function validated(observation: SourceObservation) {
  const acquisition = observation.metadata.acquisition as {
    html?: unknown;
  } | undefined;
  return observation.source.sourceName === "jobs.groupe-psa.com" && typeof acquisition?.html === "string" ? new StellantisSelectedVacancyContextLocator().locate({
    providerKey: "STELLANTIS",
    sourceUrl: observation.source.sourceUrl ?? "",
    html: acquisition.html,
    ...(observation.source.externalId ? {
      externalId: observation.source.externalId
    } : {})
  }) : undefined;
}
/** A URL match alone never migrates an identity. Both snapshots must independently
 * validate their bounded vacancy, route/Apply ID and displayed references. */
export async function resolveLegacyStellantisContinuity(observation: SourceObservation, deps: {
  sourceObservationRepository: SourceObservationRepository;
  canonicalVacancyRepository: CanonicalVacancyRepository;
}): Promise<string | undefined> {
  const {
    sourceName,
    sourceUrl,
    externalId
  } = observation.source;
  const lookup = deps.sourceObservationRepository.findUnidentifiedBySourceUrlFragment;
  if (!lookup || !externalId || !sourceUrl || sourceName !== "jobs.groupe-psa.com" || stellantisVacancyId(sourceUrl) !== externalId) return undefined;
  const current = validated(observation);
  if (!current) return undefined;
  const repository = deps.canonicalVacancyRepository;
  if ((await repository.findBySourceObservationId(observation.id)) || (await repository.findByExactSourceIdentity(sourceName, externalId))) return undefined;
  const matches = new Set<string>();
  for (const candidate of await lookup.call(deps.sourceObservationRepository, sourceName, `_${externalId}.aspx`)) {
    const previous = validated(candidate);
    if (!previous || previous.providerExternalId !== externalId) continue;
    const canonical = await repository.findBySourceObservationId(candidate.id);
    if (canonical) matches.add(canonical.id);
  }
  if (matches.size !== 1) return undefined;
  const id = [...matches][0]!;
  for (const memberId of await repository.findClaimedSourceObservationIds(id)) {
    const member = await deps.sourceObservationRepository.findById(memberId);
    const context = member ? validated(member) : undefined;
    if (!context || context.providerExternalId !== externalId) return undefined;
  }
  return id;
}
