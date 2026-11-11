import type { VacancyEvidenceExtractionInput } from "../../domain/evidence/VacancyEvidenceInput.js";
import { fromSelectedVacancyContext } from "../../domain/evidence/VacancyEvidenceInput.js";
import { LhhSelectedVacancyContextLocator } from "../acquisition/LhhVacancy.js";
import { buildBoundedEvidenceView } from "./buildBoundedEvidenceView.js";
const boundedLhh = Symbol("boundedLhh");
export function scopeLhhVacancyEvidence(input: VacancyEvidenceExtractionInput): VacancyEvidenceExtractionInput {
  if (boundedLhh in input) return input;
  const acquisition = record(input.metadata.acquisition);
  const context = new LhhSelectedVacancyContextLocator().locate({
    providerKey: "LHH",
    sourceUrl: input.source.sourceUrl ?? "",
    html: typeof acquisition?.html === "string" ? acquisition.html : "",
    ...(input.source.externalId ? { externalId: input.source.externalId } : {})
  });
  if (context?.associationEvidence?.includes("BOUNDED_SELECTED_JOB_PANE")) {
    const { contactText: _contactText, ...inputWithoutContactText } = input;
    const scoped = buildBoundedEvidenceView(inputWithoutContactText, context);
    Object.defineProperty(scoped, boundedLhh, { value: true, configurable: false });
    return scoped;
  }
  const {
    title: _title, displayedCompanyName: _company, locationText: _location, salaryText: _salary,
    contractText: _contract, description: _description, rawContent: _raw, contactText: _contact,
    publishedAt: _published, ...identity
  } = input;
  const scoped = {
    ...identity,
    [boundedLhh]: true,
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
