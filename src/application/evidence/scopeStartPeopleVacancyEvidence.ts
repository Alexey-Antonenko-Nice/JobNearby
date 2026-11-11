import type { VacancyEvidenceExtractionInput } from "../../domain/evidence/VacancyEvidenceInput.js";
import { StartPeopleSelectedVacancyContextLocator } from "../acquisition/StartPeopleVacancy.js";
import { buildBoundedEvidenceView } from "./buildBoundedEvidenceView.js";

const boundedStartPeople = Symbol("boundedStartPeople");

export function scopeStartPeopleVacancyEvidence(input: VacancyEvidenceExtractionInput): VacancyEvidenceExtractionInput {
  if (boundedStartPeople in input) return input;

  const acquisition = record(input.metadata.acquisition);
  const context = new StartPeopleSelectedVacancyContextLocator().locate({
    providerKey: "START_PEOPLE",
    sourceUrl: input.source.sourceUrl ?? "",
    html: typeof acquisition?.html === "string" ? acquisition.html : "",
    ...(input.source.externalId === undefined ? {} : { externalId: input.source.externalId }),
  });
  const scoped = buildBoundedEvidenceView(input, context);

  Object.defineProperty(scoped, boundedStartPeople, { value: true, configurable: false });

  return scoped;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" ? (value as Record<string, unknown>) : undefined;
}
