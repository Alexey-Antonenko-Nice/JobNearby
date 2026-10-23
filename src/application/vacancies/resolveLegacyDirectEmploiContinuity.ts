import type { SourceObservation } from "../../domain/capture/SourceObservation.js";
import type { SourceObservationRepository } from "../../domain/capture/SourceObservationRepository.js";
import type { CanonicalVacancyId } from "../../domain/vacancies/CanonicalVacancy.js";
import type { CanonicalVacancyRepository } from "../../domain/vacancies/CanonicalVacancyRepository.js";
import { DirectEmploiSelectedVacancyContextLocator, directEmploiPostingId, isDirectEmploiSource } from "../acquisition/DirectEmploiVacancy.js";

function selected(observation: SourceObservation, externalId?: string) {
  const acquisition = observation.metadata.acquisition;
  const html = acquisition !== null && typeof acquisition === "object" ? (acquisition as { html?: unknown }).html : undefined;
  return typeof html === "string" ? new DirectEmploiSelectedVacancyContextLocator().locate({
    providerKey: "DIRECT_EMPLOI", sourceUrl: observation.source.sourceUrl ?? "", html, ...(externalId ? { externalId } : {}),
  }) : undefined;
}

/**
 * Direct Emploi captures made before the posting ID was recognized have no external ID.
 * When the same validated posting ID arrives, attach to their canonical vacancy only if exactly
 * one such canonical exists and re-validation confirms the same selected vacancy.
 * Any doubt returns undefined so a separate canonical is created instead of a wrong merge.
 */
export async function resolveLegacyDirectEmploiContinuity(
  observation: SourceObservation,
  dependencies: { readonly sourceObservationRepository: SourceObservationRepository; readonly canonicalVacancyRepository: CanonicalVacancyRepository },
): Promise<CanonicalVacancyId | undefined> {
  const { sourceName, sourceUrl, externalId } = observation.source;
  const lookup = dependencies.sourceObservationRepository.findUnidentifiedBySourceUrlFragment;
  if (!lookup || !externalId || !sourceUrl || !isDirectEmploiSource(sourceName, sourceUrl) || directEmploiPostingId(sourceUrl) !== externalId) return undefined;
  const current = selected(observation, externalId);
  if (!current || current.providerExternalId !== externalId) return undefined;
  const repository = dependencies.canonicalVacancyRepository;
  if (await repository.findBySourceObservationId(observation.id) || await repository.findByExactSourceIdentity(sourceName, externalId)) return undefined;
  const currentReference = current.metadata?.displayedReference;
  const canonicals = new Set<CanonicalVacancyId>();
  for (const candidate of await lookup.call(dependencies.sourceObservationRepository, sourceName, `/candidatOffre/${externalId}`)) {
    if (candidate.id === observation.id) continue;
    const context = selected(candidate);
    if (!context || context.providerExternalId !== externalId) continue;
    const previousReference = context.metadata?.displayedReference;
    if (currentReference !== undefined && previousReference !== undefined && currentReference !== previousReference) return undefined;
    const canonical = await repository.findBySourceObservationId(candidate.id);
    if (canonical) canonicals.add(canonical.id);
  }
  if (canonicals.size !== 1) return undefined;
  const [canonicalId] = [...canonicals];
  const claimed = await repository.findClaimedSourceObservationIds(canonicalId!);
  const members = dependencies.sourceObservationRepository.findByIds
    ? await dependencies.sourceObservationRepository.findByIds(claimed) : [];
  return members.every(member => member.source.externalId === undefined || member.source.externalId === externalId) ? canonicalId : undefined;
}
