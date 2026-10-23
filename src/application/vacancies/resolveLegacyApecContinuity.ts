import type { SourceObservation } from "../../domain/capture/SourceObservation.js";
import type { SourceObservationRepository } from "../../domain/capture/SourceObservationRepository.js";
import type { CanonicalVacancyId } from "../../domain/vacancies/CanonicalVacancy.js";
import type { CanonicalVacancyRepository } from "../../domain/vacancies/CanonicalVacancyRepository.js";
import { ApecSelectedVacancyContextLocator, apecVacancyId, isApecSource } from "../acquisition/ApecVacancy.js";

function selected(observation: SourceObservation, externalId?: string) {
  const acquisition = observation.metadata.acquisition;
  const html = acquisition !== null && typeof acquisition === "object" ? (acquisition as { html?: unknown }).html : undefined;
  return typeof html === "string" ? new ApecSelectedVacancyContextLocator().locate({
    providerKey: "APEC", sourceUrl: observation.source.sourceUrl ?? "", html, ...(externalId ? { externalId } : {}),
  }) : undefined;
}

/**
 * APEC observations captured before the reference was recognized have no external ID.
 * When the same validated reference now arrives, attach to their canonical vacancy only if
 * exactly one such canonical exists and re-validation confirms the same selected vacancy.
 * Any doubt returns undefined so a separate canonical is created instead of a wrong merge.
 */
export async function resolveLegacyApecContinuity(
  observation: SourceObservation,
  dependencies: { readonly sourceObservationRepository: SourceObservationRepository; readonly canonicalVacancyRepository: CanonicalVacancyRepository },
): Promise<CanonicalVacancyId | undefined> {
  const { sourceName, sourceUrl, externalId } = observation.source;
  const lookup = dependencies.sourceObservationRepository.findUnidentifiedBySourceUrlFragment;
  if (!lookup || !externalId || !sourceUrl || !isApecSource(sourceName, sourceUrl) || apecVacancyId(sourceUrl) !== externalId.toUpperCase()) return undefined;
  const current = selected(observation, externalId);
  if (!current || current.providerExternalId !== externalId.toUpperCase()) return undefined;
  const repository = dependencies.canonicalVacancyRepository;
  if (await repository.findBySourceObservationId(observation.id) || await repository.findByExactSourceIdentity(sourceName, externalId)) return undefined;
  const currentCompany = current.metadata?.companyReference;
  const canonicals = new Map<string, CanonicalVacancyId>();
  for (const candidate of await lookup.call(dependencies.sourceObservationRepository, sourceName, `/detail-offre/${externalId}`)) {
    if (candidate.id === observation.id) continue;
    const context = selected(candidate);
    if (!context || context.providerExternalId !== externalId.toUpperCase()) continue;
    const previousCompany = context.metadata?.companyReference;
    if (currentCompany !== undefined && previousCompany !== undefined && currentCompany !== previousCompany) return undefined;
    const canonical = await repository.findBySourceObservationId(candidate.id);
    if (canonical) canonicals.set(canonical.id, canonical.id);
  }
  if (canonicals.size !== 1) return undefined;
  const [canonicalId] = [...canonicals.values()];
  const claimed = await repository.findClaimedSourceObservationIds(canonicalId!);
  const members = dependencies.sourceObservationRepository.findByIds
    ? await dependencies.sourceObservationRepository.findByIds(claimed) : [];
  return members.every(member => member.source.externalId === undefined || member.source.externalId.toUpperCase() === externalId.toUpperCase())
    ? canonicalId : undefined;
}
