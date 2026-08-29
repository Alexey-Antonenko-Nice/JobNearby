import { describe, expect, it } from "vitest";

import { ConservativeProviderVacancyIdExtractor } from "../../src/application/acquisition/ConservativeProviderVacancyIdExtractor.js";

const extractor = new ConservativeProviderVacancyIdExtractor();

function extract(sourceName: string, sourceUrl: string): string | undefined {
  return extractor.extract({ sourceName, sourceUrl });
}

describe("ConservativeProviderVacancyIdExtractor", () => {
  it("extracts Hellowork provider listing IDs from exact vacancy routes", () => {
    expect(extract("hellowork.com", "https://www.hellowork.com/fr-fr/emplois/82745536.html?utm_source=x#job"))
      .toBe("82745536");
    expect(extract("hellowork.com", "https://www.hellowork.com/fr-fr/emplois/000123/"))
      .toBe("000123");
  });

  it.each([
    "https://www.hellowork.com/",
    "https://www.hellowork.com/fr-fr/",
    "https://www.hellowork.com/fr-fr/emplois/",
    "https://www.hellowork.com/fr-fr/recherche.html",
  ])("does not extract from unrelated Hellowork URL %s", (url) => {
    expect(extract("hellowork.com", url)).toBeUndefined();
  });

  it("rejects a foreign hostname containing the Hellowork name", () => {
    expect(extract("hellowork.com", "https://fake-hellowork.com/fr-fr/emplois/82745536.html"))
      .toBeUndefined();
  });

  it("extracts Meteojob IDs only from exact numeric job routes", () => {
    expect(extract("meteojob.com", "https://www.meteojob.com/jobs/56378291?tracking=kept"))
      .toBe("56378291");
    for (const url of [
      "https://www.meteojob.com/",
      "https://www.meteojob.com/jobs",
      "https://www.meteojob.com/recherche",
      "https://www.meteojob.com/jobs/not-numeric",
    ]) expect(extract("meteojob.com", url)).toBeUndefined();
  });

  it("extracts exact Indeed vjk values regardless of parameter order", () => {
    expect(extract("indeed.com", "https://fr.indeed.com/jobs?q=maintenance&vjk=d559a370adf21f3b"))
      .toBe("d559a370adf21f3b");
    expect(extract("indeed.com", "https://fr.indeed.com/?vjk=ABC-001&q=role"))
      .toBe("ABC-001");
  });

  it("does not extract an absent or empty Indeed vjk or trust a fake hostname", () => {
    expect(extract("indeed.com", "https://fr.indeed.com/jobs?q=maintenance")).toBeUndefined();
    expect(extract("indeed.com", "https://fr.indeed.com/jobs?vjk=")).toBeUndefined();
    expect(extract("indeed.com", "https://fake-indeed.com/jobs?vjk=abc")).toBeUndefined();
  });

  it("extracts LinkedIn currentJobId only within the jobs route", () => {
    expect(extract("linkedin.com", "https://www.linkedin.com/jobs/search-results/?x=1&currentJobId=4459878282"))
      .toBe("4459878282");
    expect(extract("linkedin.com", "https://www.linkedin.com/jobs/search-results/")).toBeUndefined();
    expect(extract("linkedin.com", "https://www.linkedin.com/jobs/search-results/?currentJobId=")).toBeUndefined();
    expect(extract("linkedin.com", "https://www.linkedin.com/feed/?currentJobId=4459878282"))
      .toBeUndefined();
  });

  it("extracts exact JobLeads vacancy path segments", () => {
    expect(extract("jobleads.com", "https://www.jobleads.com/job/e83dd012cb1ce77d88ca81cbfe1d3f4a0?campaign=x"))
      .toBe("e83dd012cb1ce77d88ca81cbfe1d3f4a0");
    expect(extract("jobleads.com", "https://www.jobleads.com/")).toBeUndefined();
    expect(extract("jobleads.com", "https://www.jobleads.com/search/results")).toBeUndefined();
    expect(extract("jobleads.com", "https://www.jobleads.com/job/")).toBeUndefined();
  });

  it("intentionally leaves Jooble path IDs unsupported", () => {
    expect(extract("jooble.org", "https://fr.jooble.org/desc/-7778676142537344967"))
      .toBeUndefined();
  });

  it("extracts France Travail IDs only from the demonstrated detail route", () => {
    expect(extract(
      "candidat.francetravail.fr",
      "https://candidat.francetravail.fr/offres/recherche/detail/213BBCX",
    )).toBe("213BBCX");
    expect(extract(
      "candidat.francetravail.fr",
      "https://candidat.francetravail.fr/offres/recherche/detail/212YCRF",
    )).toBe("212YCRF");
    expect(extract(
      "candidat.francetravail.fr",
      "https://candidat.francetravail.fr/offres/recherche?detail=213BBCX",
    )).toBeUndefined();
    expect(extract(
      "fake-francetravail.fr",
      "https://fake-francetravail.fr/offres/recherche/detail/213BBCX",
    )).toBeUndefined();
  });

  it("is non-fatal for unknown providers, malformed URLs, and source-name mismatches", () => {
    expect(extract("example.com", "https://example.com/jobs/123")).toBeUndefined();
    expect(extract("indeed.com", "not a URL")).toBeUndefined();
    expect(extract("meteojob.com", "https://www.hellowork.com/fr-fr/emplois/123.html"))
      .toBeUndefined();
  });
});
