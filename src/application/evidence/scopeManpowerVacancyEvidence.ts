import type { VacancyEvidenceExtractionInput } from "../../domain/evidence/VacancyEvidenceInput.js";
import { ManpowerSelectedVacancyContextLocator, manpowerFacts } from "../acquisition/ManpowerVacancy.js";
import { buildBoundedEvidenceView } from "./buildBoundedEvidenceView.js";

const boundedManpower = Symbol("boundedManpower");

export function scopeManpowerVacancyEvidence(input: VacancyEvidenceExtractionInput): VacancyEvidenceExtractionInput {
  if (boundedManpower in input) return input;

  const acquisition = record(input.metadata.acquisition);
  const context = new ManpowerSelectedVacancyContextLocator().locate({
    providerKey: "MANPOWER",
    sourceUrl: input.source.sourceUrl ?? "",
    html: typeof acquisition?.html === "string" ? acquisition.html : "",
    ...(input.source.externalId === undefined ? {} : { externalId: input.source.externalId }),
  });
  const facts = context?.html === undefined ? undefined : manpowerFacts(context.html);
  const approvedProjection = facts === undefined
    ? undefined
    : { title: facts.title, ...(facts.location ? { locationText: facts.location } : {}) };
  const scoped = buildBoundedEvidenceView(input, context, approvedProjection);

  Object.defineProperty(scoped, boundedManpower, { value: true, configurable: false });

  return scoped;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" ? (value as Record<string, unknown>) : undefined;
}
