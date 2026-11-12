import type { AcquisitionContext } from "../../domain/acquisition/AcquisitionContext.js";
import type { VacancyEvidenceExtractionInput } from "../../domain/evidence/VacancyEvidenceInput.js";
import { normalizeVacancyEvidenceInput } from "../../domain/evidence/VacancyEvidenceInput.js";
import { buildBoundedEvidenceView } from "./buildBoundedEvidenceView.js";
import { LinkedInSelectedVacancyContextLocator } from "../acquisition/LinkedInSelectedVacancyContextLocator.js";
import { extractLinkedInVacancyId } from "../acquisition/LinkedInVacancyUrl.js";

/**
 * LinkedIn evidence scoping for the direct job view and matching-link search pane.
 * All other LinkedIn layouts keep their legacy input unchanged.
 *
 * The locator also emits LINKEDIN_DIRECT_JOB_DETAILS_SCREEN for SDUI panes on
 * /jobs/search-results/ (including B-Hive), so that marker alone is not proof of
 * the direct view. Eligibility additionally requires a /jobs/view/ URL whose ID
 * agrees with the source ID and the context ID.
 *
 * The context is taken from the evidence content, then the stored acquisition
 * contexts, and finally from the locator over the captured HTML.
 */
export function scopeLinkedInVacancyEvidence(input: VacancyEvidenceExtractionInput): VacancyEvidenceExtractionInput {
  if (input.source.sourceName !== "linkedin.com") return input;

  const normalized = normalizeVacancyEvidenceInput(input);
  const acquisition = record(input.metadata.acquisition);

  const existing = normalized.evidenceContent.kind === "SELECTED_VACANCY_CONTEXT" &&
    normalized.evidenceContent.context.providerKey === "LINKEDIN"
    ? normalized.evidenceContent.context
    : Array.isArray(acquisition?.contexts)
      ? acquisition.contexts.find((value): value is AcquisitionContext =>
          record(value)?.kind === "SELECTED_VACANCY" &&
          record(value)?.providerKey === "LINKEDIN")
      : undefined;

  const html = typeof acquisition?.html === "string" ? acquisition.html : "";
  const url = input.source.sourceUrl;

  const context = existing ?? (url === undefined ? undefined :
    new LinkedInSelectedVacancyContextLocator().locate({
      providerKey: "LINKEDIN",
      sourceUrl: url,
      html,
      ...(input.source.externalId === undefined ? {} : { externalId: input.source.externalId }),
    }));

  if (context !== undefined && (isDirectView(context, url, input.source.externalId) ||
    isMatchingLinkSearchPane(context, url, input.source.externalId))) {
    // Page-level contact text is not part of the selected vacancy.
    const { contactText: _contactText, ...inputWithoutContactText } = input;
    return buildBoundedEvidenceView(inputWithoutContactText, context);
  }

  return input;
}

function isDirectView(context: AcquisitionContext, url: string | undefined, externalId: string | undefined): boolean {
  if (url === undefined || externalId === undefined) return false;
  if (context.providerKey !== "LINKEDIN" || context.providerExternalId !== externalId) return false;
  if (context.associationEvidence?.includes("LINKEDIN_DIRECT_JOB_DETAILS_SCREEN") !== true) return false;
  try {
    const parsed = new URL(url);
    return /^\/jobs\/view\/[^/]+\/?$/u.test(parsed.pathname) && extractLinkedInVacancyId(parsed) === externalId;
  } catch {
    return false;
  }
}

function isMatchingLinkSearchPane(context: AcquisitionContext, url: string | undefined, externalId: string | undefined): boolean {
  if (url === undefined || externalId === undefined) return false;
  if (context.kind !== "SELECTED_VACANCY" || context.associationMethod !== "PROVIDER_LOCATOR") return false;
  if (context.providerKey !== "LINKEDIN" || context.providerExternalId !== externalId) return false;
  const proof = context.associationEvidence ?? [];
  if (!["URL_EXTERNAL_ID", "MATCHING_JOB_DETAILS", "BOUNDED_JOB_DETAIL", "MATCHING_LINKEDIN_JOB_LINK"]
    .every((marker) => proof.includes(marker))) return false;
  // SDUI search screens (including B-Hive) and component-only panes stay legacy.
  if (proof.includes("LINKEDIN_DIRECT_JOB_DETAILS_SCREEN") ||
    proof.includes("MATCHING_LINKEDIN_COMPONENT_REFERENCE")) return false;
  try {
    const parsed = new URL(url);
    return (parsed.protocol === "https:" || parsed.protocol === "http:") &&
      (parsed.hostname === "linkedin.com" || parsed.hostname.endsWith(".linkedin.com")) &&
      /^\/jobs\/(?:search|search-results)\/?$/u.test(parsed.pathname) &&
      extractLinkedInVacancyId(parsed) === externalId;
  } catch {
    return false;
  }
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : undefined;
}
