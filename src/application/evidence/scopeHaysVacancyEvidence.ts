import type { VacancyEvidenceExtractionInput } from "../../domain/evidence/VacancyEvidenceInput.js";
import { fromSelectedVacancyContext } from "../../domain/evidence/VacancyEvidenceInput.js";
import { HaysSelectedVacancyContextLocator } from "../acquisition/HaysVacancy.js";
const boundedHays = Symbol("boundedHays");
export function scopeHaysVacancyEvidence(input: VacancyEvidenceExtractionInput): VacancyEvidenceExtractionInput {
  if (boundedHays in input) return input;
  const acquisition = record(input.metadata.acquisition);
  const context = new HaysSelectedVacancyContextLocator().locate({
    providerKey: "HAYS",
    sourceUrl: input.source.sourceUrl ?? "",
    html: typeof acquisition?.html === "string" ? acquisition.html : "",
    ...(input.source.externalId ? { externalId: input.source.externalId } : {})
  });
  const {
    title: _title, displayedCompanyName: _company, locationText: _location, salaryText: _salary,
    contractText: _contract, description: _description, rawContent: _raw, contactText: _contact,
    publishedAt: _published, ...identity
  } = input;
  const scoped = {
    ...identity,
    [boundedHays]: true,
    rawContent: context?.text ?? "",
    metadata: {
      ...input.metadata,
      acquisition: {
        ...acquisition,
        html: context?.html ?? "",
        structuredPayload: undefined,
        contexts: context ? [context] : [],
        metadata: { vacancyEvidenceScope: "SELECTED_VACANCY_REQUIRED" }
      }
    }
  };
  return context ? fromSelectedVacancyContext(scoped, context) : { ...scoped, evidenceContent: { kind: "SOURCE_OBSERVATION" } };
}
function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" ? value as Record<string, unknown> : undefined;
}
