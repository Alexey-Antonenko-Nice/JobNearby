import type { AcquisitionContext } from "../../domain/acquisition/AcquisitionContext.js";
import { normalizeVacancyEvidenceInput, type VacancyEvidenceExtractionInput } from "../../domain/evidence/VacancyEvidenceInput.js";
import { ConservativeProviderVacancyIdExtractor } from "../acquisition/ConservativeProviderVacancyIdExtractor.js";
import { FranceTravailSelectedVacancyContextLocator } from "../acquisition/FranceTravailSelectedVacancyContextLocator.js";
import { buildBoundedEvidenceView } from "./buildBoundedEvidenceView.js";

export const FRANCE_TRAVAIL_SOURCE_NAME = "candidat.francetravail.fr";
const REQUIRED_PROOF = ["URL_EXTERNAL_ID", "MATCHING_ACTIVE_RESULT", "OPEN_OFFER_DETAIL", "DETAIL_EXTERNAL_ID_MATCH"] as const;

/** Transient evidence view only. The selected modal is the sole evidence boundary. */
export function scopeFranceTravailVacancyEvidence(input: VacancyEvidenceExtractionInput): VacancyEvidenceExtractionInput {
  if (input.source.sourceName !== FRANCE_TRAVAIL_SOURCE_NAME) return input;
  const { contactText: _contactText, ...inputWithoutContactText } = input;
  return buildBoundedEvidenceView(inputWithoutContactText, trustedContext(input));
}

function trustedContext(input: VacancyEvidenceExtractionInput): AcquisitionContext | undefined {
  const externalId = input.source.externalId;
  const sourceUrl = input.source.sourceUrl;
  if (externalId === undefined || sourceUrl === undefined) return undefined;
  const urlId = new ConservativeProviderVacancyIdExtractor().extract({ sourceName: input.source.sourceName, sourceUrl });
  if (urlId !== externalId) return undefined;

  const normalized = normalizeVacancyEvidenceInput(input);
  const acquisition = record(input.metadata.acquisition);
  const candidates: unknown[] = [
    ...(normalized.evidenceContent.kind === "SELECTED_VACANCY_CONTEXT" ? [normalized.evidenceContent.context] : []),
    ...(Array.isArray(acquisition?.contexts) ? acquisition.contexts : []),
  ];
  const stored = candidates.filter(isFranceTravailContext);
  const valid = stored.filter(context => isTrusted(context, externalId));
  if (valid.length > 0) return valid.every(context => sameContext(context, valid[0]!)) ? valid[0] : undefined;
  // A present but untrusted stored context is never replaced by a re-derived one.
  if (stored.length > 0) return undefined;

  const html = typeof acquisition?.html === "string" ? acquisition.html : "";
  const located = new FranceTravailSelectedVacancyContextLocator().locate({ providerKey: "FRANCE_TRAVAIL", sourceUrl, externalId, html });
  return located !== undefined && isTrusted(located, externalId) ? located : undefined;
}

function isFranceTravailContext(value: unknown): value is AcquisitionContext {
  const context = record(value);
  return context?.kind === "SELECTED_VACANCY" && context.providerKey === "FRANCE_TRAVAIL";
}

function isTrusted(context: AcquisitionContext, externalId: string): boolean {
  return context.associationMethod === "PROVIDER_LOCATOR"
    && context.providerExternalId === externalId
    && REQUIRED_PROOF.every(marker => context.associationEvidence?.includes(marker) === true)
    && (context.text ?? "").trim().length > 0;
}

function sameContext(left: AcquisitionContext, right: AcquisitionContext): boolean {
  return left.html === right.html && left.text === right.text;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : undefined;
}
