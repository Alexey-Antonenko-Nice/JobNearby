import type { AcquisitionContext } from "../../domain/acquisition/AcquisitionContext.js";
import type { VacancyEvidenceExtractionInput } from "../../domain/evidence/VacancyEvidenceInput.js";
import { fromSelectedVacancyContext } from "../../domain/evidence/VacancyEvidenceInput.js";
import { PromanSelectedVacancyContextLocator, promanVacancyId, promanPublishedAt } from "../acquisition/PromanVacancy.js";

/** Never use historical dashboard-wide HTML as an evidence fallback. */
export function scopePromanVacancyEvidence(input: VacancyEvidenceExtractionInput): VacancyEvidenceExtractionInput {
  const id = promanVacancyId(input.source.sourceUrl ?? "");
  const identityMatches = input.source.sourceName === "mon-espace.proman-emploi.fr" && id !== undefined
    && (input.source.externalId === undefined || input.source.externalId === id);
  const acquisition = record(input.metadata.acquisition);
  const context = identityMatches ? trustedContext(acquisition, input, id) : undefined;
  const publishedAt = context?.html ? promanPublishedAt(context.html) : undefined;
  const scoped = {
    id: input.id,
    source: {
      sourceType: input.source.sourceType,
      sourceName: "mon-espace.proman-emploi.fr",
      sourceUrl: id ? new URL(`/dashboard?offre_id=${id}`, new URL(input.source.sourceUrl!).origin).href
        : "https://mon-espace.proman-emploi.fr/dashboard",
      ...(identityMatches && input.source.externalId !== undefined ? { externalId: id } : {}),
    },
    observedAt: new Date(input.observedAt.getTime()),
    ...(publishedAt === undefined ? {} : { publishedAt }),
    rawContent: context?.text ?? "",
    metadata: {
      acquisition: {
        html: context?.html ?? "",
        contexts: context ? [context] : [],
        metadata: { vacancyEvidenceScope: "SELECTED_VACANCY_REQUIRED" },
      },
    },
  };
  return context ? fromSelectedVacancyContext(scoped, context)
    : { ...scoped, evidenceContent: { kind: "SOURCE_OBSERVATION" } };
}
function trustedContext(acquisition: Record<string, unknown> | undefined, input: VacancyEvidenceExtractionInput, id: string): AcquisitionContext | undefined {
  if (acquisition?.contexts !== undefined) {
    if (!Array.isArray(acquisition.contexts) || acquisition.contexts.length !== 1) return undefined;
    const stored = record(acquisition.contexts[0]);
    const keys = ["kind", "associationMethod", "providerKey", "providerExternalId", "html", "text", "associationEvidence"];
    if (!stored || Object.keys(stored).some(key => !keys.includes(key))
      || stored.kind !== "SELECTED_VACANCY" || stored.associationMethod !== "PROVIDER_LOCATOR"
      || stored.providerKey !== "PROMAN" || stored.providerExternalId !== id) return undefined;
    const validated = sanitizedHtmlContext(stored.html, input, id);
    if (!validated || stored.text !== validated.text
      || JSON.stringify(stored.associationEvidence) !== JSON.stringify(validated.associationEvidence)) return undefined;
    // Reuse the validated context's content, never legacy acquisition or caller-supplied text.
    return validated;
  }
  return sanitizedHtmlContext(acquisition?.html, input, id);
}
function sanitizedHtmlContext(value: unknown, input: VacancyEvidenceExtractionInput, id: string): AcquisitionContext | undefined {
  // Only our reconstructed envelope qualifies; arbitrary original modal/dashboard markup does not.
  if (typeof value !== "string" || !value.startsWith('<div role="dialog" aria-modal="true"><div class="panel-container" data-offre-id="')) return undefined;
  const context = new PromanSelectedVacancyContextLocator().locate({ providerKey: "PROMAN",
    sourceUrl: input.source.sourceUrl!, externalId: id, html: value });
  return context?.html === value ? context : undefined;
}
function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}
