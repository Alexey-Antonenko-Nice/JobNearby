import type { VacancyEvidenceExtractionInput } from "../../domain/evidence/VacancyEvidenceInput.js";
import { fromSelectedVacancyContext } from "../../domain/evidence/VacancyEvidenceInput.js";
import { ManpowerSelectedVacancyContextLocator, manpowerFacts } from "../acquisition/ManpowerVacancy.js";

const boundedManpower = Symbol("boundedManpower");
export function scopeManpowerVacancyEvidence(input: VacancyEvidenceExtractionInput): VacancyEvidenceExtractionInput {
  if (boundedManpower in input) return input;
  const acquisition = record(input.metadata.acquisition);
  const context = new ManpowerSelectedVacancyContextLocator().locate({ providerKey: "MANPOWER", sourceUrl: input.source.sourceUrl ?? "",
    html: typeof acquisition?.html === "string" ? acquisition.html : "", ...(input.source.externalId === undefined ? {} : { externalId: input.source.externalId }) });
  const facts = context?.html === undefined ? undefined : manpowerFacts(context.html);
  const { title: _title, displayedCompanyName: _company, locationText: _location, salaryText: _salary, contractText: _contract,
    description: _description, contactText: _contact, rawContent: _raw, ...identity } = input;
  const scoped = { ...identity, [boundedManpower]: true,
    ...(facts === undefined ? {} : { title: facts.title, ...(facts.location ? { locationText: facts.location } : {}) }),
    rawContent: context?.text ?? "", metadata: { ...input.metadata, acquisition: { ...acquisition, html: context?.html ?? "",
      structuredPayload: undefined, contexts: context ? [context] : [], metadata: { ...record(acquisition?.metadata), vacancyEvidenceScope: "SELECTED_VACANCY_REQUIRED" },
    } } };
  return context ? fromSelectedVacancyContext(scoped, context) : { ...scoped, evidenceContent: { kind: "SOURCE_OBSERVATION" } };
}
function record(value: unknown): Record<string, unknown> | undefined { return value !== null && typeof value === "object" ? value as Record<string, unknown> : undefined; }
