import type { VacancyEvidenceExtractionInput } from "../../domain/evidence/VacancyEvidenceInput.js";
import { extractPersonioHeaderFacts, isPersonioHostname, isPersonioSource, PersonioSelectedVacancyContextLocator } from "../acquisition/PersonioVacancy.js";
import { buildBoundedEvidenceView } from "./buildBoundedEvidenceView.js";

/** No page fields, JSON-LD, contacts or sibling regions are evidence for Personio. */
export function scopePersonioVacancyEvidence(input: VacancyEvidenceExtractionInput): VacancyEvidenceExtractionInput {
  if (!isPersonioHostname(input.source.sourceName)) return input;
  const { contactText: _contact, ...withoutContact } = input;
  const empty = () => buildBoundedEvidenceView(withoutContact, undefined);
  const url = input.source.sourceUrl;
  if (url === undefined || !isPersonioSource(input.source.sourceName, url)) return empty();
  const acquisition = record(input.metadata.acquisition);
  const locator = new PersonioSelectedVacancyContextLocator();
  const locate = (html: string) => locator.locate({ providerKey: "PERSONIO", sourceUrl: url, html,
    ...(input.source.externalId === undefined ? {} : { externalId: input.source.externalId }) });
  const html = typeof acquisition?.html === "string" ? acquisition.html : undefined;
  const located = html === undefined ? undefined : locate(html);
  if (html !== undefined && located === undefined) return empty();
  const contexts = acquisition?.contexts;
  if (contexts !== undefined && !Array.isArray(contexts)) return empty();
  const supplied = Array.isArray(contexts) ? contexts : [];
  const selected = "evidenceContent" in input && input.evidenceContent.kind === "SELECTED_VACANCY_CONTEXT"
    ? input.evidenceContent.context : undefined;
  if (supplied.length > 1) return empty();
  let context = located;
  for (const candidate of [...supplied, ...(selected === undefined ? [] : [selected])]) {
    const stored = record(candidate);
    if (stored?.kind !== "SELECTED_VACANCY" || stored.providerKey !== "PERSONIO"
      || stored.associationMethod !== "PROVIDER_LOCATOR" || typeof stored.html !== "string") return empty();
    const checked = locate(stored.html);
    if (checked === undefined || stored.providerExternalId !== checked.providerExternalId
      || stored.html !== checked.html || stored.text !== checked.text
      || located !== undefined && located.html !== checked.html) return empty();
    context = candidate;
  }
  if (context === undefined) return empty();
  const facts = extractPersonioHeaderFacts(context.html!);
  return buildBoundedEvidenceView(withoutContact, context, {
    ...(facts.title === undefined ? {} : { title: facts.title }),
    ...(facts.contractTerms.length === 0 ? {} : { contractText: facts.contractTerms.join(" · ") }),
  });
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" ? value as Record<string, unknown> : undefined;
}

