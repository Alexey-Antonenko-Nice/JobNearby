import type { VacancyEvidenceExtractionInput } from "../../domain/evidence/VacancyEvidenceInput.js";
import { DAIMLER_TRUCK_SOURCE, trustedDaimlerJobPosting } from "../acquisition/DaimlerTruckVacancy.js";
import { SchemaOrgJobPostingProjector } from "../acquisition/SchemaOrgJobPostingProjector.js";

/** A single validated JSON-LD object is the boundary; no selected DOM context is needed. */
export function scopeDaimlerTruckVacancyEvidence(input: VacancyEvidenceExtractionInput): VacancyEvidenceExtractionInput {
  if (input.source.sourceName !== DAIMLER_TRUCK_SOURCE) return input;
  const acquisition = input.metadata.acquisition;
  const html = acquisition !== null && typeof acquisition === "object" ? (acquisition as Record<string, unknown>).html : undefined;
  const posting = trustedDaimlerJobPosting({ ...input.source, ...(typeof html === "string" ? { html } : {}) });
  return {
    id: input.id, source: input.source, observedAt: input.observedAt,
    ...(posting === undefined ? {} : new SchemaOrgJobPostingProjector().project(posting)),
    // Page text, contact text, metadata fields and stale selected contexts must not survive.
    rawContent: "",
    evidenceContent: { kind: "SOURCE_OBSERVATION" },
    metadata: posting === undefined ? {} : { acquisition: {
      html: '<script type="application/ld+json">' + JSON.stringify(posting).replace(/</gu, "\\u003c") + "</script>",
      structuredPayload: { format: "SCHEMA_ORG_JOB_POSTING_JSON_LD", jobPostings: [posting] },
    } },
  };
}
