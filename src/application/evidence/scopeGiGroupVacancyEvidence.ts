import type { VacancyEvidenceExtractionInput } from "../../domain/evidence/VacancyEvidenceInput.js";
import { GiGroupSelectedVacancyContextLocator } from "../acquisition/GiGroupVacancy.js";
import { buildBoundedEvidenceView } from "./buildBoundedEvidenceView.js";

const boundedGiGroup = Symbol("boundedGiGroup");

export function scopeGiGroupVacancyEvidence(input: VacancyEvidenceExtractionInput): VacancyEvidenceExtractionInput {
  if (boundedGiGroup in input) return input;

  const acquisition = record(input.metadata.acquisition);
  const context = new GiGroupSelectedVacancyContextLocator().locate({
    providerKey: "GI_GROUP",
    sourceUrl: input.source.sourceUrl ?? "",
    html: typeof acquisition?.html === "string" ? acquisition.html : "",
    ...(input.source.externalId === undefined ? {} : { externalId: input.source.externalId }),
  });
  const scoped = buildBoundedEvidenceView(input, context);

  Object.defineProperty(scoped, boundedGiGroup, { value: true, configurable: false });

  return scoped;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" ? (value as Record<string, unknown>) : undefined;
}
