import type { VacancyEvidenceExtractionInput } from "../../domain/evidence/VacancyEvidenceInput.js";
import { MichaelPageSelectedVacancyContextLocator, michaelPagePublishedAt } from "../acquisition/MichaelPageVacancy.js";
import { buildBoundedEvidenceView } from "./buildBoundedEvidenceView.js";

const boundedMichaelPage = Symbol("boundedMichaelPage");

export function scopeMichaelPageVacancyEvidence(input: VacancyEvidenceExtractionInput): VacancyEvidenceExtractionInput {
  if (boundedMichaelPage in input) return input;

  const acquisition = record(input.metadata.acquisition);
  const context = new MichaelPageSelectedVacancyContextLocator().locate({
    providerKey: "MICHAEL_PAGE",
    sourceUrl: input.source.sourceUrl ?? "",
    html: typeof acquisition?.html === "string" ? acquisition.html : "",
    ...(input.source.externalId === undefined ? {} : { externalId: input.source.externalId }),
  });
  const publishedAt = michaelPagePublishedAt(context?.metadata?.publicationText);
  const approvedProjection = publishedAt === undefined ? undefined : { publishedAt };
  const scoped = buildBoundedEvidenceView(input, context, approvedProjection);

  Object.defineProperty(scoped, boundedMichaelPage, { value: true, configurable: false });

  return scoped;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" ? (value as Record<string, unknown>) : undefined;
}
