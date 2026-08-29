import { describe, expect, it } from "vitest";

import { BrowserCaptureAcquisitionAdapter } from "../../src/application/acquisition/BrowserCaptureAcquisitionAdapter.js";
import { DeterministicAcquisitionCaptureMapper } from "../../src/application/acquisition/DeterministicAcquisitionCaptureMapper.js";
import { DirectFieldVacancyEvidenceExtractor } from "../../src/application/evidence/DirectFieldVacancyEvidenceExtractor.js";
import { compareVacancyIdentity } from "../../src/domain/vacancy-identity/compareVacancyIdentity.js";

const adapter = new BrowserCaptureAcquisitionAdapter();
const mapper = new DeterministicAcquisitionCaptureMapper();

function capture(pageUrl: string, observationId: string, html?: string) {
  const acquisition = adapter.toAcquisitionPackage({
    pageUrl,
    pageTitle: "Vacancy page",
    visibleText: "Visible vacancy text",
    capturedAt: "2026-08-28T12:00:00Z",
    ...(html !== undefined ? { html } : {}),
  }, `acquisition-${observationId}`);
  return { acquisition, observation: mapper.toSourceObservation(acquisition, observationId) };
}

describe("provider vacancy ID browser acquisition", () => {
  it.each([
    ["Hellowork", "https://www.hellowork.com/fr-fr/emplois/82745536.html", "82745536"],
    ["Meteojob", "https://www.meteojob.com/jobs/56378291", "56378291"],
    ["Indeed", "https://fr.indeed.com/jobs?vjk=d559a370adf21f3b", "d559a370adf21f3b"],
    ["LinkedIn", "https://www.linkedin.com/jobs/search-results/?currentJobId=4459878282", "4459878282"],
    ["JobLeads", "https://www.jobleads.com/job/e83dd012cb1ce77d88ca81cbfe1d3f4a0", "e83dd012cb1ce77d88ca81cbfe1d3f4a0"],
    ["France Travail", "https://candidat.francetravail.fr/offres/recherche/detail/213BBCX", "213BBCX"],
  ])("maps the %s URL ID through AcquisitionPackage into SourceReference", (_provider, url, id) => {
    const { acquisition, observation } = capture(url, `observation-${id}`);
    expect(acquisition.externalId).toBe(id);
    expect(observation.source.externalId).toBe(id);
  });

  it("leaves Jooble captures valid and without external identity", () => {
    const { acquisition, observation } = capture(
      "https://fr.jooble.org/desc/-7778676142537344967",
      "observation-jooble",
    );
    expect(acquisition.externalId).toBeUndefined();
    expect(observation.source.externalId).toBeUndefined();
    expect(observation.rawContent).toBe("Visible vacancy text");
  });

  it("preserves Hellowork URL identity and JSON-LD reference as separate values", () => {
    const jobPosting = {
      "@type": "JobPosting",
      title: "Technicien Méthodes",
      identifier: { "@type": "PropertyValue", name: "Supplay", value: "30683633 UZO8396A3ZWR" },
    };
    const html = `<script type="application/ld+json">${JSON.stringify(jobPosting)}</script>`;
    const { acquisition, observation } = capture(
      "https://www.hellowork.com/fr-fr/emplois/82745536.html",
      "observation-hellowork-jsonld",
      html,
    );
    expect(observation.source.externalId).toBe("82745536");
    expect(acquisition.content.structuredPayload).toEqual(expect.objectContaining({
      jobPostings: [jobPosting],
    }));
    expect(observation.metadata.acquisition).toEqual(expect.objectContaining({
      structuredPayload: expect.objectContaining({ jobPostings: [jobPosting] }),
    }));
  });

  it("preserves Meteojob URL identity without promoting its JSON-LD reference", () => {
    const jobPosting = {
      "@type": "JobPosting",
      identifier: { "@type": "PropertyValue", name: "TEMPORIS", value: "9934574415" },
    };
    const html = `<script type="application/ld+json">${JSON.stringify(jobPosting)}</script>`;
    const { acquisition, observation } = capture(
      "https://www.meteojob.com/jobs/56370678",
      "observation-meteojob-jsonld",
      html,
    );
    expect(observation.source.externalId).toBe("56370678");
    expect(acquisition.content.structuredPayload).toEqual(expect.objectContaining({ jobPostings: [jobPosting] }));
    expect(observation.source.externalId).not.toBe("9934574415");
  });

  it("feeds unchanged M3.5 exact identity semantics for repeated provider captures", async () => {
    const first = capture(
      "https://fr.indeed.com/jobs?q=maintenance&vjk=d559a370adf21f3b",
      "observation-a",
    ).observation;
    const second = capture(
      "https://fr.indeed.com/?vjk=d559a370adf21f3b&from=alert",
      "observation-b",
    ).observation;
    const evidenceExtractor = new DirectFieldVacancyEvidenceExtractor();
    const comparison = compareVacancyIdentity(
      await evidenceExtractor.extract(first),
      await evidenceExtractor.extract(second),
    );
    expect(first.id).not.toBe(second.id);
    expect(comparison).toMatchObject({
      result: "SAME_VACANCY",
      reason: "EXACT_PROVIDER_EXTERNAL_ID_MATCH",
      matchedExternalIdentifier: {
        providerNamespace: "indeed.com",
        value: "d559a370adf21f3b",
      },
    });
  });

  it("does not match the same external ID across provider namespaces", async () => {
    const indeed = capture("https://fr.indeed.com/?vjk=4459878282", "observation-indeed").observation;
    const linkedIn = capture(
      "https://www.linkedin.com/jobs/search-results/?currentJobId=4459878282",
      "observation-linkedin",
    ).observation;
    const evidenceExtractor = new DirectFieldVacancyEvidenceExtractor();
    expect(compareVacancyIdentity(
      await evidenceExtractor.extract(indeed),
      await evidenceExtractor.extract(linkedIn),
    )).toMatchObject({ result: "UNRESOLVED", reason: "PROVIDER_NAMESPACE_MISMATCH" });
  });
});
