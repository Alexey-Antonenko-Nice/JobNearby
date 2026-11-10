import type { SourceObservation } from "../../domain/capture/SourceObservation.js";
import { fromSelectedVacancyContext } from "../../domain/evidence/VacancyEvidenceInput.js";
import type { VacancyEvidenceExtractor } from "../../domain/evidence/VacancyEvidenceExtractor.js";
import { ProviderCaptureRegistry } from "./ProviderCaptureRegistry.js";
import { extractPersonioHeaderFacts, extractPersonioVacancyId, isPersonioSource } from "./PersonioVacancy.js";
import { LiteralJsonLdDocumentExtractor } from "./LiteralJsonLdDocumentExtractor.js";
import { SchemaOrgJobPostingExtractor } from "./SchemaOrgJobPostingExtractor.js";
import { alstomElements } from "./AlstomVacancy.js";
import { extractWorkdayStructuredFields, extractWorkdayVacancyId, isWorkdaySource } from "./WorkdayVacancy.js";

export type VacancyCaptureAcceptance =
  | { readonly captureAcceptedAsVacancy: true }
  | { readonly captureAcceptedAsVacancy: false; readonly rejectionReason: "NO_TRUSTED_VACANCY_CONTEXT" | "NO_MEANINGFUL_VACANCY_EVIDENCE" };

/** Revalidate the persisted capture, rather than trusting page metadata or an ID alone. */
export async function assessBrowserVacancyCapture(
  observation: SourceObservation,
  extractor: VacancyEvidenceExtractor,
): Promise<VacancyCaptureAcceptance> {
  const sourceUrl = observation.source.sourceUrl;
  const acquisition = record(observation.metadata.acquisition);
  const html = typeof acquisition?.html === "string" ? acquisition.html : "";
  if (!sourceUrl || !html) return rejected("NO_TRUSTED_VACANCY_CONTEXT");
  const parsedUrl = new URL(sourceUrl);
  if (!["http:", "https:"].includes(parsedUrl.protocol)) return rejected("NO_TRUSTED_VACANCY_CONTEXT");
  const provider = new ProviderCaptureRegistry().capture({ sourceName: observation.source.sourceName, sourceUrl, html });
  const context = provider.context;
  // These legacy locators can return an entire page or an unbounded suffix.
  if (provider.providerKey === "CADREMPLOI" || provider.providerKey === "JOOBLE"
    || context?.providerKey === "LHH" && context.associationEvidence?.includes("LHH_DETAIL_PAGE")) {
    return rejected("NO_TRUSTED_VACANCY_CONTEXT");
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
    })) return { captureAcceptedAsVacancy: true };
    return rejected("NO_MEANINGFUL_VACANCY_EVIDENCE");
  }
  // Personio provides a unique, bounded job header on its direct /job/<id> page.
  if (isPersonioSource(observation.source.sourceName, sourceUrl)
    && extractPersonioVacancyId(sourceUrl) === observation.source.externalId
    && observation.source.externalId !== undefined) {
    const personioHeaders = alstomElements(html.replace(/<(script|style|template)\b[^>]*>[\s\S]*?<\/\1>/giu, ""),
      open => /\bclass=["'][^"']*\bjob-header\b[^"']*["']/iu.test(open));
    const personioTitles = personioHeaders.length === 1
      ? alstomElements(personioHeaders[0]!, (open, tag) => tag === "h1" && /\bclass=["'][^"']*\bjob-position-title\b[^"']*["']/iu.test(open))
      : [];
    if (meaningfulTitle(extractPersonioHeaderFacts(html).title ?? "")
      && personioTitles.length === 1 && !hidden(personioHeaders[0]!) && !hidden(personioTitles[0]!)) {
      return { captureAcceptedAsVacancy: true };
    }
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
      return { captureAcceptedAsVacancy: true };
    }
  }
  // Bürkert publishes a single bounded JobPosting article on its direct route.
  if (observation.source.sourceName === "burkert.com" && new ProviderCaptureRegistry().capture({
    sourceName: observation.source.sourceName, sourceUrl,
  }).externalId !== undefined && provider.externalId !== undefined
    && provider.externalId === observation.source.externalId
    && [...html.matchAll(/<article\b[^>]*\bitemtype=["']https:\/\/schema\.org\/JobPosting["'][^>]*>/giu)].length === 1) {
    const postings = new SchemaOrgJobPostingExtractor().extractHtml(html);
    if (postings.length === 1 && typeof postings[0]!.title === "string" && meaningfulTitle(postings[0]!.title)) {
      return { captureAcceptedAsVacancy: true };
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
        }).externalId === provider.externalId)) return { captureAcceptedAsVacancy: true };
    }
  }
  return rejected("NO_TRUSTED_VACANCY_CONTEXT");
}

function rejected(rejectionReason: "NO_TRUSTED_VACANCY_CONTEXT" | "NO_MEANINGFUL_VACANCY_EVIDENCE"): VacancyCaptureAcceptance {
  return { captureAcceptedAsVacancy: false, rejectionReason };
}
function normalizeText(value: string): string {
  return value.normalize("NFKC").replace(/\s+/gu, " ").trim().toLocaleLowerCase();
}
function meaningfulTitle(value: string): boolean {
  const title = normalizeText(value);
  return title.length >= 5 && title.length <= 250
    && !/^(?:search|search jobs|job search|jobs?|careers?|vacancies|offres? d['’]emploi|recherche d['’]emploi)$/iu.test(title);
}
function hidden(element: string): boolean {
  const opening = element.slice(0, element.indexOf(">") + 1);
  return /\shidden(?:[\s=>])|\baria-hidden=["']true["']|\bstyle=["'][^"']*(?:display\s*:\s*none|visibility\s*:\s*hidden)/iu.test(opening);
}
function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : undefined;
}
