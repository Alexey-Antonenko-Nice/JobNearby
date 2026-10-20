import { IndeedSelectedVacancyContextLocator, requiresIndeedSelectedContext } from "../acquisition/IndeedSelectedVacancyContextLocator.js";
import { fromSelectedVacancyContext, normalizeVacancyEvidenceInput, type VacancyEvidenceExtractionInput } from "../../domain/evidence/VacancyEvidenceInput.js";
import type { AcquisitionContext } from "../../domain/acquisition/AcquisitionContext.js";

/** Transient evidence view only. Never overwrites the immutable source snapshot. */
export function scopeIndeedVacancyEvidence(input: VacancyEvidenceExtractionInput): VacancyEvidenceExtractionInput {
  if (input.source.sourceName !== "indeed.com") return input;
  const normalized = normalizeVacancyEvidenceInput(input);
  const acquisition = record(input.metadata.acquisition);
  const existing = normalized.evidenceContent.kind === "SELECTED_VACANCY_CONTEXT" && normalized.evidenceContent.context.providerKey === "INDEED"
    ? normalized.evidenceContent.context
    : Array.isArray(acquisition?.contexts) ? acquisition.contexts.find((value): value is AcquisitionContext => record(value)?.kind === "SELECTED_VACANCY" && record(value)?.providerKey === "INDEED") : undefined;
  const html = typeof acquisition?.html === "string" ? acquisition.html : "";
  const url = input.source.sourceUrl;
  const required = existing !== undefined || record(acquisition?.metadata)?.vacancyEvidenceScope === "SELECTED_VACANCY_REQUIRED"
    || (url !== undefined && requiresIndeedSelectedContext(url, html));
  if (!required) return input;
  const context = existing ?? (url === undefined ? undefined : new IndeedSelectedVacancyContextLocator().locate({
    providerKey: "INDEED", sourceUrl: url, html,
    ...(input.source.externalId === undefined ? {} : { externalId: input.source.externalId }),
  }));
  // Generic source fields and page-level structured payloads may describe a
  // neighboring card or preferences, even when the selected context is sound.
  const { title: _title, displayedCompanyName: _company, locationText: _location,
    salaryText: _salary, contractText: _contract, contactText: _contact,
    description: _description, rawContent: _raw, ...identity } = input;
  const scoped = { ...identity, rawContent: context?.text ?? "", metadata: { ...input.metadata,
    acquisition: { ...acquisition, html: context?.html ?? "", structuredPayload: undefined,
      contexts: context === undefined ? [] : [context], metadata: { ...record(acquisition?.metadata), vacancyEvidenceScope: "SELECTED_VACANCY_REQUIRED" } },
  } };
  // No selected context means no vacancy text, not a whole-page fallback.
  return context === undefined ? { ...scoped, evidenceContent: { kind: "SOURCE_OBSERVATION" } }
    : fromSelectedVacancyContext(scoped, context);
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : undefined;
}
