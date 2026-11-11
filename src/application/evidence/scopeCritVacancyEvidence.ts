import type { VacancyEvidenceExtractionInput } from "../../domain/evidence/VacancyEvidenceInput.js";
import { CritSelectedVacancyContextLocator } from "../acquisition/CritVacancy.js";
import { buildBoundedEvidenceView } from "./buildBoundedEvidenceView.js";

const boundedCrit = Symbol("boundedCrit");

export function scopeCritVacancyEvidence(input: VacancyEvidenceExtractionInput): VacancyEvidenceExtractionInput {
  if (boundedCrit in input) return input;

  const acquisition = record(input.metadata.acquisition);
  const context = new CritSelectedVacancyContextLocator().locate({
    providerKey: "CRIT",
    sourceUrl: input.source.sourceUrl ?? "",
    html: typeof acquisition?.html === "string" ? acquisition.html : "",
    ...(input.source.externalId === undefined ? {} : { externalId: input.source.externalId }),
  });
  const scoped = buildBoundedEvidenceView(input, context);

  Object.defineProperty(scoped, boundedCrit, { value: true, configurable: false });

  return scoped;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" ? (value as Record<string, unknown>) : undefined;
}
