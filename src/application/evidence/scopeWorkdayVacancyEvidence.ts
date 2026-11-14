import type { AcquisitionContext } from "../../domain/acquisition/AcquisitionContext.js";
import type { VacancyEvidenceExtractionInput } from "../../domain/evidence/VacancyEvidenceInput.js";
import { requiresGenericWorkdayScope, locateGenericWorkdayContext } from "../acquisition/GenericWorkdayVacancy.js";
import { extractWorkdayStructuredFields } from "../acquisition/WorkdayVacancy.js";
import { buildBoundedEvidenceView } from "./buildBoundedEvidenceView.js";

export function scopeWorkdayVacancyEvidence(input: VacancyEvidenceExtractionInput): VacancyEvidenceExtractionInput {
  const url = input.source.sourceUrl ?? "";
  if (!requiresGenericWorkdayScope(input.source.sourceName, url)) return input;
  const { contactText: _contact, ...withoutContact } = input;
  const empty = () => buildBoundedEvidenceView(withoutContact, undefined);
  const acquisition = record(input.metadata.acquisition);
  const locate = (html: string) => locateGenericWorkdayContext({ sourceName: input.source.sourceName,
    sourceUrl: url, html, ...(input.source.externalId === undefined ? {} : { externalId: input.source.externalId }) });
  const html = typeof acquisition?.html === "string" ? acquisition.html : undefined;
  const located = html === undefined ? undefined : locate(html);
  if (html !== undefined && located === undefined) return empty();
  if (acquisition?.contexts !== undefined && !Array.isArray(acquisition.contexts)) return empty();
  const stored: unknown[] = Array.isArray(acquisition?.contexts) ? acquisition.contexts : [];
  if (stored.length > 1) return empty();
  const selected = "evidenceContent" in input && input.evidenceContent.kind === "SELECTED_VACANCY_CONTEXT"
    ? input.evidenceContent.context : undefined;
  let context = located;
  for (const candidate of [...stored, ...(selected === undefined ? [] : [selected])]) {
    const value = record(candidate);
    if (value?.kind !== "SELECTED_VACANCY" || value.associationMethod !== "PROVIDER_LOCATOR"
      || value.providerKey !== undefined || typeof value.html !== "string"
      || record(value.metadata)?.providerNamespace !== "GENERIC_WORKDAY"
      || record(value.metadata)?.sourceName !== input.source.sourceName) return empty();
    const checked = locate(value.html);
    if (checked === undefined || value.providerExternalId !== checked.providerExternalId
      || value.html !== checked.html || value.text !== checked.text
      || context !== undefined && context.html !== checked.html) return empty();
    context = candidate as AcquisitionContext;
  }
  if (context === undefined) return empty();
  const fields = extractWorkdayStructuredFields(context.html!, url);
  return buildBoundedEvidenceView(withoutContact, context, {
    ...(fields?.title === undefined ? {} : { title: fields.title }),
    ...(fields?.displayedCompanyName === undefined ? {} : { displayedCompanyName: fields.displayedCompanyName }),
    ...(fields?.locationText === undefined ? {} : { locationText: fields.locationText }),
    ...(fields?.contractText === undefined ? {} : { contractText: fields.contractText }),
  });
}
function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" ? value as Record<string, unknown> : undefined;
}
