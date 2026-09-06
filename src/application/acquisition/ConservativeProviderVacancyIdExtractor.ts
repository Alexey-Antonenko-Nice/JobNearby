import type {
  ProviderVacancyIdExtractionInput,
  ProviderVacancyIdExtractor,
} from "./ProviderVacancyIdExtractor.js";
import { extractLinkedInVacancyId } from "./LinkedInVacancyUrl.js";
import { extractRandstadVacancyId } from "./RandstadVacancyUrl.js";
import { extractWorkdayVacancyId } from "./WorkdayVacancy.js";

type ExtractionRule = (url: URL) => string | undefined;

const rules: Readonly<Record<string, ExtractionRule>> = {
  "hellowork.com": extractHellowork,
  "meteojob.com": extractMeteojob,
  "indeed.com": (url) => nonEmptyParameter(url, "vjk"),
  "linkedin.com": extractLinkedIn,
  "jobleads.com": extractJobLeads,
  "candidat.francetravail.fr": extractFranceTravail,
  "randstad.fr": extractRandstadVacancyId,
  "jobsearch.daimlertruck.com": extractDaimlerTruck,
  "burkert.com": extractBurkert,
};

export class ConservativeProviderVacancyIdExtractor
  implements ProviderVacancyIdExtractor
{
  extract(input: ProviderVacancyIdExtractionInput): string | undefined {
    if (input.sourceName.endsWith(".myworkdayjobs.com")) {
      try {
        const url = new URL(input.sourceUrl);
        if (normalizeHostname(url.hostname) !== input.sourceName) return undefined;
        return extractWorkdayVacancyId(input.sourceUrl);
      } catch {
        return undefined;
      }
    }
    if (input.sourceName === "jooble.org") {
      try { return /^\/desc\/(-\d+)\/?$/u.exec(new URL(input.sourceUrl).pathname)?.[1]; } catch { return undefined; }
    }
    if (input.sourceName === "cadremploi.fr") {
      try {
        const url = new URL(input.sourceUrl);
        return /^\/emploi\/detail_offre\/?$/u.test(url.pathname) && /^\d+$/.test(url.searchParams.get("offreId") ?? "")
          ? url.searchParams.get("offreId") ?? undefined : undefined;
      } catch { return undefined; }
    }
    if (input.sourceName === "lhh.com") {
      try { return /^\/fr-fr\/offres-emploi\/detail\/(\d+)\/?$/iu.exec(new URL(input.sourceUrl).pathname)?.[1]; } catch { return undefined; }
    }
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

function extractFranceTravail(url: URL): string | undefined {
  return /^\/offres\/recherche\/(?:emploirecherche\/)?detail\/([0-9A-Z]+)\/?$/u.exec(url.pathname)?.[1];
}

function extractDaimlerTruck(url: URL): string | undefined {
  const action = url.searchParams.get("ac");
  if (action !== null && action !== "jobad") return undefined;
  const id = nonEmptyParameter(url, "id");
  return id === undefined || !/^\d+$/u.test(id) ? undefined : id;
}

function extractBurkert(url: URL): string | undefined {
  return /^\/en\/company-career\/career\/job-openings\/([a-z0-9]+(?:-[a-z0-9]+)*)\/?$/iu.exec(url.pathname)?.[1];
}

function extractHellowork(url: URL): string | undefined {
  return /^\/[a-z]{2}-[a-z]{2}\/emplois\/(\d+)(?:\.html)?\/?$/u.exec(url.pathname)?.[1];
}

function extractMeteojob(url: URL): string | undefined {
  return /^\/jobs\/(\d+)\/?$/u.exec(url.pathname)?.[1];
}

function extractLinkedIn(url: URL): string | undefined {
  return extractLinkedInVacancyId(url);
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
