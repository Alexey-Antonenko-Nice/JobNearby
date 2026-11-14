import type { SourceObservation, SourceObservationId } from "../../domain/capture/SourceObservation.js";
import type { AcquisitionContext } from "../../domain/acquisition/AcquisitionContext.js";
import { fromSelectedVacancyContext } from "../../domain/evidence/VacancyEvidenceInput.js";
import type { VacancyEvidenceExtractor } from "../../domain/evidence/VacancyEvidenceExtractor.js";
import { ProviderCaptureRegistry } from "./ProviderCaptureRegistry.js";
import { isPersonioHostname } from "./PersonioVacancy.js";
import { scopePersonioVacancyEvidence } from "../evidence/scopePersonioVacancyEvidence.js";
import { LiteralJsonLdDocumentExtractor } from "./LiteralJsonLdDocumentExtractor.js";
import { SchemaOrgJobPostingExtractor } from "./SchemaOrgJobPostingExtractor.js";
import { alstomElements } from "./AlstomVacancy.js";
import { extractWorkdayStructuredFields, extractWorkdayVacancyId, isWorkdaySource } from "./WorkdayVacancy.js";
import { extractLinkedInVacancyId } from "./LinkedInVacancyUrl.js";

export type VacancyCaptureRejectionReason =
  | "NO_TRUSTED_VACANCY_CONTEXT"
  | "NO_MEANINGFUL_VACANCY_EVIDENCE";

export interface AcceptedVacancyCapture {
  readonly captureAcceptedAsVacancy: true;
  readonly sourceObservationId: SourceObservationId;
}

export interface RejectedVacancyCapture {
  readonly captureAcceptedAsVacancy: false;
  readonly rejectionReason: VacancyCaptureRejectionReason;
  readonly sourceObservationId: SourceObservationId;
  // Diagnostic identity already retained by acquisition; rejection does not validate it anew.
  readonly retainedExternalId?: string;
  readonly partialRecaptureIdentity?: {
    readonly providerNamespace: string;
    readonly externalId: string;
    readonly selectedContext: AcquisitionContext;
  };
}

export type VacancyCaptureAcceptance = AcceptedVacancyCapture | RejectedVacancyCapture;

/** Revalidate the persisted capture, rather than trusting page metadata or an ID alone. */
export async function assessBrowserVacancyCapture(
  observation: SourceObservation,
  extractor: VacancyEvidenceExtractor,
): Promise<VacancyCaptureAcceptance> {
  const reject = (reason: VacancyCaptureRejectionReason): RejectedVacancyCapture => ({
    captureAcceptedAsVacancy: false,
    rejectionReason: reason,
    sourceObservationId: observation.id,
    ...(observation.source.externalId === undefined ? {} : { retainedExternalId: observation.source.externalId }),
  });
  const accept = (): AcceptedVacancyCapture => ({
    captureAcceptedAsVacancy: true,
    sourceObservationId: observation.id,
  });
  const sourceUrl = observation.source.sourceUrl;
  const acquisition = record(observation.metadata.acquisition);
  const html = typeof acquisition?.html === "string" ? acquisition.html : "";
  if (!sourceUrl || !html) return reject("NO_TRUSTED_VACANCY_CONTEXT");
  const parsedUrl = new URL(sourceUrl);
  if (!["http:", "https:"].includes(parsedUrl.protocol)) return reject("NO_TRUSTED_VACANCY_CONTEXT");
  const provider = new ProviderCaptureRegistry().capture({ sourceName: observation.source.sourceName, sourceUrl, html });
  const context = provider.context;
  if (isPersonioHostname(observation.source.sourceName)) {
    const scoped = scopePersonioVacancyEvidence(observation);
    return "evidenceContent" in scoped && scoped.evidenceContent.kind === "SELECTED_VACANCY_CONTEXT"
      && observation.source.externalId !== undefined ? accept() : reject("NO_TRUSTED_VACANCY_CONTEXT");
  }
  // These legacy locators can return an entire page or an unbounded suffix.
  if (provider.providerKey === "CADREMPLOI" || provider.providerKey === "JOOBLE"
    || context?.providerKey === "LHH" && context.associationEvidence?.includes("LHH_DETAIL_PAGE")) {
    return reject("NO_TRUSTED_VACANCY_CONTEXT");
  }
  if (context && provider.providerKey && context.providerKey === provider.providerKey
    && context.associationMethod === "PROVIDER_LOCATOR"
    && (!context.providerExternalId || context.providerExternalId === observation.source.externalId)) {
    // Generic page-level structured fields must not satisfy the title requirement.
    const { title: _title, description: _description, rawContent: _raw, ...rest } = observation;
    const input = fromSelectedVacancyContext({ ...rest, rawContent: context.text ?? "" }, context);
    const evidence = await extractor.extract(input);
    const contextText = normalizeText(context.text ?? "");
    if (evidence.vacancyTitles.some(({ value }) => {
      const title = normalizeText(value);
      return meaningfulTitle(title) && contextText.includes(title);
    })) return accept();
    const hasTrustedLinkedInIdentity = trustedLinkedInPartialIdentity(
      observation,
      provider,
      context,
    );
    const partialEvidence = hasTrustedLinkedInIdentity
      ? await extractor.extract(selectedContextEvidenceInput(observation, context))
      : undefined;
    const partialRecaptureIdentity = hasTrustedLinkedInIdentity &&
      partialEvidence !== undefined &&
      hasMeaningfulPartialEvidence(context.text ?? "", partialEvidence)
      ? {
        providerNamespace: observation.source.sourceName,
        externalId: observation.source.externalId!,
        selectedContext: context,
      }
      : undefined;
    return {
      ...reject("NO_MEANINGFUL_VACANCY_EVIDENCE"),
      ...(partialRecaptureIdentity === undefined ? {} : { partialRecaptureIdentity }),
    };
  }
  // Generic Workday's direct detail header is accepted only with a unique
  // requisition reference agreeing with the route, not the extractor's page fallback.
  if (provider.providerKey === undefined && isWorkdaySource(observation.source.sourceName, sourceUrl)
    && extractWorkdayVacancyId(sourceUrl) === observation.source.externalId
    && observation.source.externalId !== undefined) {
    const clean = html.replace(/<(script|style|template)\b[^>]*>[\s\S]*?<\/\1>/giu, "");
    const headers = alstomElements(clean, open => /\bdata-automation-id=["']jobPostingHeader["']/iu.test(open));
    const references = alstomElements(clean, open => /\bdata-automation-id=["'](?:requisitionId|subtitle)["']/iu.test(open));
    const ids = new Set(references.flatMap(value => value.match(/\bJR-[A-Z0-9]+(?:-[A-Z0-9]+)*\b/giu) ?? []).map(value => value.toUpperCase()));
    const header = headers.length === 1 ? headers[0]! : "";
    const titleElements = alstomElements(header, open => /\bdata-automation-id=["']jobTitle["']/iu.test(open));
    const hasHeaderTitle = titleElements.length === 1 || titleElements.length === 0 && /^<h[12]\b/iu.test(header);
    const title = hasHeaderTitle ? extractWorkdayStructuredFields(header, sourceUrl)?.title : undefined;
    if (ids.size === 1 && ids.has(observation.source.externalId) && !hidden(header)
      && (titleElements.length === 0 || !hidden(titleElements[0]!)) && meaningfulTitle(title ?? "")) {
      return accept();
    }
  }
  // Bürkert publishes a single bounded JobPosting article on its direct route; the registry
  // returns it as the locator context only when it is unique and its identity is unambiguous.
  if (observation.source.sourceName === "burkert.com" && provider.context?.html !== undefined
    && provider.externalId !== undefined && provider.externalId === observation.source.externalId
    && provider.context.providerExternalId === provider.externalId) {
    const postings = new SchemaOrgJobPostingExtractor().extractHtml(provider.context.html);
    if (postings.length === 1 && typeof postings[0]!.title === "string" && meaningfulTitle(postings[0]!.title)) {
      return accept();
    }
  }
  // Daimler Truck direct job ads expose one JobPosting record.
  if (observation.source.sourceName === "jobsearch.daimlertruck.com"
    && parsedUrl.hostname === "jobsearch.daimlertruck.com"
    && parsedUrl.pathname === "/index.php" && parsedUrl.searchParams.getAll("ac").length === 1
    && parsedUrl.searchParams.get("ac") === "jobad" && parsedUrl.searchParams.getAll("id").length === 1
    && provider.externalId !== undefined && provider.externalId === observation.source.externalId) {
    const postings = new SchemaOrgJobPostingExtractor().extract(new LiteralJsonLdDocumentExtractor().extract(html));
    if (postings.length === 1 && typeof postings[0]!.title === "string" && meaningfulTitle(postings[0]!.title)) {
      const postingUrl = postings[0]!.url;
      const identifier = postings[0]!.identifier;
      const identifierValue = typeof identifier === "string" ? identifier : record(identifier)?.value;
      if ((identifier === undefined || identifierValue === provider.externalId)
        && (postingUrl === undefined || typeof postingUrl === "string" && new ProviderCaptureRegistry().capture({
          sourceName: observation.source.sourceName, sourceUrl: postingUrl,
        }).externalId === provider.externalId)) return accept();
    }
  }
  return reject("NO_TRUSTED_VACANCY_CONTEXT");
}
function selectedContextEvidenceInput(
  observation: SourceObservation,
  context: AcquisitionContext,
) {
  return fromSelectedVacancyContext({
    id: observation.id,
    source: observation.source,
    observedAt: observation.observedAt,
    metadata: {
      acquisition: {
        html: context.html ?? "",
        contexts: [context],
        metadata: { vacancyEvidenceScope: "SELECTED_VACANCY_REQUIRED" },
      },
    },
  }, context);
}
function normalizeText(value: string): string {
  return value.normalize("NFKC").replace(/\s+/gu, " ").trim().toLocaleLowerCase();
}
function meaningfulTitle(value: string): boolean {
  const title = normalizeText(value);
  return title.length >= 5 && title.length <= 250
    && !/^(?:search|search jobs|job search|jobs?|careers?|vacancies|offres? d['’]emploi|recherche d['’]emploi)$/iu.test(title);
}
function trustedLinkedInPartialIdentity(
  observation: SourceObservation,
  provider: ReturnType<ProviderCaptureRegistry["capture"]>,
  context: NonNullable<ReturnType<ProviderCaptureRegistry["capture"]>["context"]>,
): boolean {
  const externalId = observation.source.externalId;
  const sourceUrl = observation.source.sourceUrl;
  if (
    observation.source.sourceName !== "linkedin.com" ||
    externalId === undefined ||
    provider.providerKey !== "LINKEDIN" ||
    provider.externalId !== externalId ||
    context.providerKey !== "LINKEDIN" ||
    context.associationMethod !== "PROVIDER_LOCATOR" ||
    context.providerExternalId !== externalId ||
    sourceUrl === undefined
  ) return false;
  const proof = context.associationEvidence ?? [];
  if (!["URL_EXTERNAL_ID", "MATCHING_JOB_DETAILS", "BOUNDED_JOB_DETAIL"]
    .every(marker => proof.includes(marker)) ||
    !["MATCHING_LINKEDIN_JOB_LINK", "MATCHING_LINKEDIN_COMPONENT_REFERENCE"]
      .some(marker => proof.includes(marker))) return false;
  try {
    const url = new URL(sourceUrl);
    return (url.protocol === "https:" || url.protocol === "http:") &&
      (url.hostname === "linkedin.com" || url.hostname.endsWith(".linkedin.com")) &&
      extractLinkedInVacancyId(url) === externalId;
  } catch {
    return false;
  }
}

function hasMeaningfulPartialEvidence(
  contextText: string,
  evidence: Awaited<ReturnType<VacancyEvidenceExtractor["extract"]>>,
): boolean {
  if (
    evidence.organizations.length > 0 ||
    evidence.locations.length > 0 ||
    evidence.engagements.length > 0 ||
    evidence.workModes.length > 0 ||
    evidence.compensations.length > 0 ||
    (evidence.positionCounts?.length ?? 0) > 0 ||
    (evidence.skillRequirements?.length ?? 0) > 0 ||
    (evidence.educationRequirements?.length ?? 0) > 0 ||
    evidence.languageRequirements.length > 0 ||
    evidence.experienceRequirements.length > 0 ||
    evidence.travelRequirements.length > 0
  ) return true;

  const lines = contextText.split(/\r?\n/u);
  const descriptionHeading = /^\s*(?:à\s+propos de l['’]offre d['’]emploi|about (?:the )?job|job description|description(?: du poste)?)\s*$/iu;
  const headingIndex = lines.findIndex(line => descriptionHeading.test(line));
  if (headingIndex < 0) return false;
  const description = lines.slice(headingIndex + 1)
    .map(line => line.trim())
    .filter(line => line.length > 0)
    .join(" ");
  return description.length >= 40 && /\p{L}{3}/u.test(description);
}
function hidden(element: string): boolean {
  const opening = element.slice(0, element.indexOf(">") + 1);
  return /\shidden(?:[\s=>])|\baria-hidden=["']true["']|\bstyle=["'][^"']*(?:display\s*:\s*none|visibility\s*:\s*hidden)/iu.test(opening);
}
function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : undefined;
}
