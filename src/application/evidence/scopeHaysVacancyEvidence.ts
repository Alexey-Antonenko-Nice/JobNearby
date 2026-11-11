import type { VacancyEvidenceExtractionInput } from "../../domain/evidence/VacancyEvidenceInput.js";
import { HaysSelectedVacancyContextLocator } from "../acquisition/HaysVacancy.js";
import { buildBoundedEvidenceView } from "./buildBoundedEvidenceView.js";

const boundedHays = Symbol("boundedHays");

export function scopeHaysVacancyEvidence(input: VacancyEvidenceExtractionInput): VacancyEvidenceExtractionInput {
  if (boundedHays in input) return input;

  const acquisition = record(input.metadata.acquisition);
  const context = new HaysSelectedVacancyContextLocator().locate({
    providerKey: "HAYS",
    sourceUrl: input.source.sourceUrl ?? "",
    html: typeof acquisition?.html === "string" ? acquisition.html : "",
    ...(input.source.externalId ? { externalId: input.source.externalId } : {}),
  });

  // Build the bounded evidence view using the helper
  const scoped = buildBoundedEvidenceView(input, context);

  // Mark as bounded to avoid re-scoping
  Object.defineProperty(scoped, boundedHays, { value: true, configurable: false });

  return scoped;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" ? (value as Record<string, unknown>) : undefined;
}
