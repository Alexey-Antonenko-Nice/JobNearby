import type { VacancyEvidenceExtractionInput } from "../../domain/evidence/VacancyEvidenceInput.js";
import { SynergieSelectedVacancyContextLocator } from "../acquisition/SynergieVacancy.js";
import { buildBoundedEvidenceView } from "./buildBoundedEvidenceView.js";

const boundedSynergie = Symbol("boundedSynergie");

export function scopeSynergieVacancyEvidence(input: VacancyEvidenceExtractionInput): VacancyEvidenceExtractionInput {
  if (boundedSynergie in input) return input;

  const acquisition = record(input.metadata.acquisition);
  const context = new SynergieSelectedVacancyContextLocator().locate({
    providerKey: "SYNERGIE",
    sourceUrl: input.source.sourceUrl ?? "",
    html: typeof acquisition?.html === "string" ? acquisition.html : "",
    ...(input.source.externalId === undefined ? {} : { externalId: input.source.externalId }),
  });
  const scoped = buildBoundedEvidenceView(input, context);

  Object.defineProperty(scoped, boundedSynergie, { value: true, configurable: false });

  return scoped;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" ? (value as Record<string, unknown>) : undefined;
}
