import type { VacancyEvidenceExtractionInput } from "../../domain/evidence/VacancyEvidenceInput.js";
import { RandstadSelectedVacancyContextLocator } from "../acquisition/RandstadVacancy.js";
import { buildBoundedEvidenceView } from "./buildBoundedEvidenceView.js";

const boundedRandstad = Symbol("boundedRandstad");

export function scopeRandstadVacancyEvidence(input: VacancyEvidenceExtractionInput): VacancyEvidenceExtractionInput {
  if (boundedRandstad in input) return input;

  const acquisition = record(input.metadata.acquisition);
  const context = new RandstadSelectedVacancyContextLocator().locate({
    providerKey: "RANDSTAD",
    sourceUrl: input.source.sourceUrl ?? "",
    html: typeof acquisition?.html === "string" ? acquisition.html : "",
    ...(input.source.externalId ? { externalId: input.source.externalId } : {}),
  });

  // Build the bounded evidence view using the helper
  const scoped = buildBoundedEvidenceView(input, context);

  // Mark as bounded to avoid re-scoping
  Object.defineProperty(scoped, boundedRandstad, { value: true, configurable: false });

  return scoped;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" ? (value as Record<string, unknown>) : undefined;
}
