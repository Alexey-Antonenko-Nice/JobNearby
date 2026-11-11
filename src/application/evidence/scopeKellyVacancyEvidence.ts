import type { VacancyEvidenceExtractionInput } from "../../domain/evidence/VacancyEvidenceInput.js";
import { KellySelectedVacancyContextLocator } from "../acquisition/KellyWorkdayVacancy.js";
import { buildBoundedEvidenceView } from "./buildBoundedEvidenceView.js";

const boundedKelly = Symbol("boundedKelly");
export function scopeKellyVacancyEvidence(input: VacancyEvidenceExtractionInput): VacancyEvidenceExtractionInput {
  if (boundedKelly in input) return input;
  const acquisition = record(input.metadata.acquisition);
  const context = new KellySelectedVacancyContextLocator().locate({ providerKey: "KELLY_WORKDAY", sourceUrl: input.source.sourceUrl ?? "",
    html: typeof acquisition?.html === "string" ? acquisition.html : "", ...(input.source.externalId === undefined ? {} : { externalId: input.source.externalId }) });
  const { contactText: _contactText, ...inputWithoutContactText } = input;
  const scoped = buildBoundedEvidenceView(inputWithoutContactText, context);
  Object.defineProperty(scoped, boundedKelly, { value: true, configurable: false });
  return scoped;
}
function record(value: unknown): Record<string, unknown> | undefined { return value !== null && typeof value === "object" ? value as Record<string, unknown> : undefined; }
