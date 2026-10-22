import type { VacancyEvidenceExtractionInput } from "../../domain/evidence/VacancyEvidenceInput.js";
import { fromSelectedVacancyContext } from "../../domain/evidence/VacancyEvidenceInput.js";
import { TalentSelectedVacancyContextLocator, talentHeaderFields, talentVacancyId } from "../acquisition/TalentSelectedVacancyContextLocator.js";

const scopedTalentInput = Symbol("scopedTalentInput");

/** A transient evidence view; immutable historical source rows are never rewritten. */
export function scopeTalentVacancyEvidence(input: VacancyEvidenceExtractionInput): VacancyEvidenceExtractionInput {
  if (scopedTalentInput in input) return input;
  const acquisition = record(input.metadata.acquisition);
  const html = typeof acquisition?.html === "string" ? acquisition.html : "";
  const sourceUrl = input.source.sourceUrl ?? "";
  const externalId = input.source.externalId ?? talentVacancyId(sourceUrl);
  const context = new TalentSelectedVacancyContextLocator().locate({ providerKey: "TALENT", sourceUrl, html,
    ...(externalId === undefined ? {} : { externalId }) });
  const { title: _title, displayedCompanyName: _company, locationText: _location, salaryText: _salary,
    contractText: _contract, description: _description, contactText: _contact, rawContent: _raw, ...identity } = input;
  const scoped = { ...identity, ...(context?.html === undefined ? {} : talentHeaderFields(context.html)),
    [scopedTalentInput]: true, rawContent: context?.text ?? "", metadata: { ...input.metadata, acquisition: {
      ...acquisition, html: context?.html ?? "", structuredPayload: undefined, contexts: context === undefined ? [] : [context],
      metadata: { ...record(acquisition?.metadata), vacancyEvidenceScope: "SELECTED_VACANCY_REQUIRED" },
    } } };
  return context === undefined ? { ...scoped, evidenceContent: { kind: "SOURCE_OBSERVATION" } }
    : fromSelectedVacancyContext(scoped, context);
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : undefined;
}
