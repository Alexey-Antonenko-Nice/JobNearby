import type {
  ProviderVacancyIdExtractionInput,
  ProviderVacancyIdExtractor,
} from "./ProviderVacancyIdExtractor.js";

type ExtractionRule = (url: URL) => string | undefined;

const rules: Readonly<Record<string, ExtractionRule>> = {
  "hellowork.com": extractHellowork,
  "meteojob.com": extractMeteojob,
  "indeed.com": (url) => nonEmptyParameter(url, "vjk"),
  "linkedin.com": extractLinkedIn,
  "jobleads.com": extractJobLeads,
};

export class ConservativeProviderVacancyIdExtractor
  implements ProviderVacancyIdExtractor
{
  extract(input: ProviderVacancyIdExtractionInput): string | undefined {
    const rule = rules[input.sourceName];
    if (rule === undefined) return undefined;
    try {
      const url = new URL(input.sourceUrl);
      if (normalizeHostname(url.hostname) !== input.sourceName) return undefined;
      return rule(url);
    } catch {
      return undefined;
    }
  }
}

function extractHellowork(url: URL): string | undefined {
  return /^\/[a-z]{2}-[a-z]{2}\/emplois\/(\d+)(?:\.html)?\/?$/u.exec(url.pathname)?.[1];
}

function extractMeteojob(url: URL): string | undefined {
  return /^\/jobs\/(\d+)\/?$/u.exec(url.pathname)?.[1];
}

function extractLinkedIn(url: URL): string | undefined {
  if (!url.pathname.startsWith("/jobs/")) return undefined;
  return nonEmptyParameter(url, "currentJobId");
}

function extractJobLeads(url: URL): string | undefined {
  const value = /^\/job\/([^/]+)\/?$/u.exec(url.pathname)?.[1];
  return value === undefined || value.trim().length === 0 ? undefined : value;
}

function nonEmptyParameter(url: URL, name: string): string | undefined {
  const value = url.searchParams.get(name);
  return value === null || value.trim().length === 0 ? undefined : value.trim();
}

function normalizeHostname(hostname: string): string {
  const normalized = hostname.toLocaleLowerCase();
  const withoutWww = normalized.startsWith("www.") ? normalized.slice(4) : normalized;
  const labels = withoutWww.split(".");
  return labels.length > 2 && /^[a-z]{2}(?:-[a-z]{2})?$/u.test(labels[0] ?? "")
    ? labels.slice(1).join(".")
    : withoutWww;
}
