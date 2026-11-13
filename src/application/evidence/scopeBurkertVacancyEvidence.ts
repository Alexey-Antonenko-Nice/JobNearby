import type { VacancyEvidenceExtractionInput, VacancyEvidenceInput } from "../../domain/evidence/VacancyEvidenceInput.js";
import { BURKERT_SOURCE_NAME, locateBurkertVacancyContext } from "../acquisition/BurkertVacancyIdentity.js";
import { SchemaOrgJobPostingExtractor } from "../acquisition/SchemaOrgJobPostingExtractor.js";
import { SchemaOrgJobPostingProjector } from "../acquisition/SchemaOrgJobPostingProjector.js";
import { buildBoundedEvidenceView } from "./buildBoundedEvidenceView.js";

const boundedBurkert = Symbol("boundedBurkert");

/**
 * Bürkert evidence comes only from the unique JobPosting microdata article that acceptance proves.
 * Page-level JSON-LD, structured payload, raw content and contact text are never restored; the
 * article's own facts are re-derived from that article alone.
 */
export function scopeBurkertVacancyEvidence(input: VacancyEvidenceExtractionInput): VacancyEvidenceExtractionInput {
  if (input.source.sourceName !== BURKERT_SOURCE_NAME || boundedBurkert in input) return input;
  const { contactText: _contactText, ...inputWithoutContactText } = input;
  const acquisition = record(input.metadata.acquisition);
  const html = typeof acquisition?.html === "string" ? acquisition.html : undefined;
  const located = html === undefined || input.source.sourceUrl === undefined ? undefined
    : locateBurkertVacancyContext({ sourceName: input.source.sourceName, sourceUrl: input.source.sourceUrl, html });
  const context = located !== undefined && located.providerExternalId === input.source.externalId ? located : undefined;
  const postings = context?.html === undefined ? [] : new SchemaOrgJobPostingExtractor().extractHtml(context.html);
  if (context === undefined || postings.length !== 1) return mark(buildBoundedEvidenceView(inputWithoutContactText, undefined));
  const fields = new SchemaOrgJobPostingProjector().project(postings[0]!);
  const view = buildBoundedEvidenceView(inputWithoutContactText, context, {
    ...(fields?.title === undefined ? {} : { title: fields.title }),
    ...(fields?.displayedCompanyName === undefined ? {} : { displayedCompanyName: fields.displayedCompanyName }),
    ...(fields?.locationText === undefined ? {} : { locationText: fields.locationText }),
    ...(fields?.contractText === undefined ? {} : { contractText: fields.contractText }),
  });
  return mark({
    ...view,
    metadata: {
      ...view.metadata,
      acquisition: {
        ...record(view.metadata.acquisition),
        structuredPayload: { format: "SCHEMA_ORG_JOB_POSTING_JSON_LD", jobPostings: [postings[0]!] },
      },
    },
  });
}

function mark(view: VacancyEvidenceInput): VacancyEvidenceInput {
  Object.defineProperty(view, boundedBurkert, { value: true, configurable: false });
  return view;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" ? value as Record<string, unknown> : undefined;
}
