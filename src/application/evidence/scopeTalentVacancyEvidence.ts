import type { VacancyEvidenceExtractionInput } from "../../domain/evidence/VacancyEvidenceInput.js";
import { TalentSelectedVacancyContextLocator, talentHeaderFields, talentVacancyId } from "../acquisition/TalentSelectedVacancyContextLocator.js";
import { buildBoundedEvidenceView } from "./buildBoundedEvidenceView.js";

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
  const header = context?.html === undefined ? undefined : talentHeaderFields(context.html);
  const approvedProjection = header === undefined
    ? undefined
    : {
      title: header.title,
      displayedCompanyName: header.displayedCompanyName,
      locationText: header.locationText,
    };
  const scoped = buildBoundedEvidenceView(input, context, approvedProjection);

  Object.defineProperty(scoped, scopedTalentInput, { value: true, configurable: false });

  return scoped;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : undefined;
}
