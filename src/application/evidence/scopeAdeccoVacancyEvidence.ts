import type { VacancyEvidenceExtractionInput } from "../../domain/evidence/VacancyEvidenceInput.js";
import { AdeccoSelectedVacancyContextLocator, adeccoSelectedFacts } from "../acquisition/AdeccoSelectedVacancyContextLocator.js";
import { buildBoundedEvidenceView } from "./buildBoundedEvidenceView.js";

const boundedAdecco = Symbol("boundedAdecco");

export function scopeAdeccoVacancyEvidence(input: VacancyEvidenceExtractionInput): VacancyEvidenceExtractionInput {
  if (boundedAdecco in input) return input;

  const acquisition = record(input.metadata.acquisition);
  const context = new AdeccoSelectedVacancyContextLocator().locate({
    providerKey: "ADECCO",
    sourceUrl: input.source.sourceUrl ?? "",
    html: typeof acquisition?.html === "string" ? acquisition.html : "",
    ...(input.source.externalId === undefined ? {} : { externalId: input.source.externalId }),
  });
  const facts = context?.html === undefined ? undefined : adeccoSelectedFacts(context.html);
  const approvedProjection = facts === undefined
    ? undefined
    : { title: facts.title, ...(facts.location ? { locationText: facts.location } : {}) };
  const scoped = buildBoundedEvidenceView(input, context, approvedProjection);

  Object.defineProperty(scoped, boundedAdecco, { value: true, configurable: false });

  return scoped;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" ? (value as Record<string, unknown>) : undefined;
}
