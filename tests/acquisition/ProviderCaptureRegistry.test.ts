import { describe, expect, it } from "vitest";

import { ProviderCaptureRegistry } from "../../src/application/acquisition/ProviderCaptureRegistry.js";

const registry = new ProviderCaptureRegistry();

function capture(sourceUrl: string, sourceName = sourceNameFromUrl(sourceUrl), html?: string) {
  return registry.capture({ sourceName, sourceUrl, ...(html === undefined ? {} : { html }) });
}

function sourceNameFromUrl(sourceUrl: string): string {
  const hostname = new URL(sourceUrl).hostname.toLocaleLowerCase().replace(/^www\./u, "");
  const labels = hostname.split(".");
  return labels.length > 2 && /^[a-z]{2}(?:-[a-z]{2})?$/u.test(labels[0] ?? "")
    ? labels.slice(1).join(".")
    : hostname;
}

describe("ProviderCaptureRegistry", () => {
  it.each([
    ["candidat.francetravail.fr", "https://candidat.francetravail.fr/offres/recherche/detail/213BBCX", "FRANCE_TRAVAIL"],
    ["indeed.com", "https://fr.indeed.com/?vjk=abc", "INDEED"],
    ["linkedin.com", "https://www.linkedin.com/jobs/search/?currentJobId=4426980052", "LINKEDIN"],
    ["jooble.org", "https://fr.jooble.org/desc/-123", "JOOBLE"],
    ["cadremploi.fr", "https://www.cadremploi.fr/emploi/detail_offre?offreId=123", "CADREMPLOI"],
    ["lhh.com", "https://www.lhh.com/fr-fr/offres-emploi/detail/2089206701", "LHH"],
    ["airproducts.wd5.myworkdayjobs.com", "https://airproducts.wd5.myworkdayjobs.com/fr-FR/AP0001/details/x_JR-2026-21408", undefined],
    ["jobsearch.daimlertruck.com", "https://jobsearch.daimlertruck.com/index.php?ac=jobad&id=425255", undefined],
    ["burkert.com", "https://www.burkert.com/en/company-career/career/job-openings/teamleiter-kunststofftechnik-m-w-d", undefined],
    ["randstad.fr", "https://www.randstad.fr/emploi/x_001-mmo-0000054_10l/", undefined],
    ["hellowork.com", "https://www.hellowork.com/fr-fr/emplois/82745536.html", undefined],
    ["meteojob.com", "https://www.meteojob.com/jobs/56378291", undefined],
  ] as const)("dispatches %s", (sourceName, url, providerKey) => {
    expect(capture(url, sourceName).providerKey).toBe(providerKey);
  });

  it("uses generic fallback for unknown providers", () => {
    expect(capture("https://unknown.example/jobs/1").providerKey).toBeUndefined();
    expect(capture("https://unknown.example/jobs/1").externalId).toBeUndefined();
  });

  it("preserves representative identities through one registry path", () => {
    expect(capture("https://fr.indeed.com/?vjk=abc").externalId).toBe("abc");
    expect(capture("https://fr.jooble.org/desc/-123?tracking=x").externalId).toBe("-123");
    expect(capture("https://www.cadremploi.fr/emploi/detail_offre?offreId=123&utm_source=x").externalId).toBe("123");
    expect(capture("https://www.lhh.com/fr-fr/offres-emploi/detail/456?utm_source=x").externalId).toBe("456");
  });
});
