import type { VacancyEvidenceExtractionInput } from "../../domain/evidence/VacancyEvidenceInput.js";
import { ExpectraSelectedVacancyContextLocator } from "../acquisition/ExpectraVacancy.js";
import { buildBoundedEvidenceView } from "./buildBoundedEvidenceView.js";

const bounded = Symbol("boundedExpectra");

export function scopeExpectraVacancyEvidence(input: VacancyEvidenceExtractionInput): VacancyEvidenceExtractionInput {
  if (bounded in input) return input;

  const acquisition = record(input.metadata.acquisition);
  const context = new ExpectraSelectedVacancyContextLocator().locate({
    providerKey: "EXPECTRA_MONACO",
    sourceUrl: input.source.sourceUrl ?? "",
    html: typeof acquisition?.html === "string" ? acquisition.html : "",
    ...(input.source.externalId === undefined ? {} : { externalId: input.source.externalId }),
  });

  // Build the bounded evidence view using the helper
  const scoped = buildBoundedEvidenceView(input, context);

  // Mark as bounded to avoid re-scoping
  Object.defineProperty(scoped, bounded, { value: true, configurable: false });

  return scoped;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" ? (value as Record<string, unknown>) : undefined;
}
