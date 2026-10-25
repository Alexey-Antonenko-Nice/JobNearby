import type { VacancyEvidenceExtractionInput } from "../../domain/evidence/VacancyEvidenceInput.js";
import { fromSelectedVacancyContext } from "../../domain/evidence/VacancyEvidenceInput.js";
import { MichaelPageSelectedVacancyContextLocator, michaelPagePublishedAt } from "../acquisition/MichaelPageVacancy.js";

const boundedMichaelPage = Symbol("boundedMichaelPage");
export function scopeMichaelPageVacancyEvidence(input: VacancyEvidenceExtractionInput): VacancyEvidenceExtractionInput {
  if (boundedMichaelPage in input) return input;
  const acquisition = record(input.metadata.acquisition);
  const context = new MichaelPageSelectedVacancyContextLocator().locate({ providerKey: "MICHAEL_PAGE", sourceUrl: input.source.sourceUrl ?? "",
    html: typeof acquisition?.html === "string" ? acquisition.html : "", ...(input.source.externalId === undefined ? {} : { externalId: input.source.externalId }) });
  const publishedAt = michaelPagePublishedAt(context?.metadata?.publicationText);
  const { publishedAt: _publishedAt, title: _title, displayedCompanyName: _company, locationText: _location, salaryText: _salary, contractText: _contract,
    description: _description, contactText: _contact, rawContent: _raw, ...identity } = input;
  const scoped = { ...identity, ...(publishedAt ? { publishedAt } : {}), [boundedMichaelPage]: true,
    rawContent: context?.text ?? "", metadata: { ...input.metadata, acquisition: { ...acquisition, html: context?.html ?? "",
      structuredPayload: undefined, contexts: context ? [context] : [], metadata: { ...record(acquisition?.metadata), vacancyEvidenceScope: "SELECTED_VACANCY_REQUIRED" },
    } } };
  return context ? fromSelectedVacancyContext(scoped, context) : { ...scoped, evidenceContent: { kind: "SOURCE_OBSERVATION" } };
}
function record(value: unknown): Record<string, unknown> | undefined { return value !== null && typeof value === "object" ? value as Record<string, unknown> : undefined; }
