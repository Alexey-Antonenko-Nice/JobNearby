import type { VacancyEvidenceExtractionInput } from "../../domain/evidence/VacancyEvidenceInput.js";
import { fromSelectedVacancyContext } from "../../domain/evidence/VacancyEvidenceInput.js";
import { PromanSelectedVacancyContextLocator } from "../acquisition/PromanVacancy.js";

const boundedProman = Symbol("boundedProman");
export function scopePromanVacancyEvidence(input: VacancyEvidenceExtractionInput): VacancyEvidenceExtractionInput {
  if (boundedProman in input) return input;
  const acquisition = record(input.metadata.acquisition);
  const context = new PromanSelectedVacancyContextLocator().locate({ providerKey: "PROMAN", sourceUrl: input.source.sourceUrl ?? "",
    html: typeof acquisition?.html === "string" ? acquisition.html : "", ...(input.source.externalId === undefined ? {} : { externalId: input.source.externalId }) });
  const { title: _title, displayedCompanyName: _company, locationText: _location, salaryText: _salary, contractText: _contract,
    description: _description, contactText: _contact, rawContent: _raw, ...identity } = input;
  const scoped = { ...identity, [boundedProman]: true,
    rawContent: context?.text ?? "", metadata: { ...input.metadata, acquisition: { ...acquisition, html: context?.html ?? "",
      structuredPayload: undefined, contexts: context ? [context] : [], metadata: { ...record(acquisition?.metadata), vacancyEvidenceScope: "SELECTED_VACANCY_REQUIRED" },
    } } };
  return context ? fromSelectedVacancyContext(scoped, context) : { ...scoped, evidenceContent: { kind: "SOURCE_OBSERVATION" } };
}
function record(value: unknown): Record<string, unknown> | undefined { return value !== null && typeof value === "object" ? value as Record<string, unknown> : undefined; }
