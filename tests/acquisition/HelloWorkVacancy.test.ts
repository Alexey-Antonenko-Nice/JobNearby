import { describe, expect, it } from "vitest";
import { BrowserCaptureAcquisitionAdapter } from "../../src/application/acquisition/BrowserCaptureAcquisitionAdapter.js";
import { DeterministicAcquisitionCaptureMapper } from "../../src/application/acquisition/DeterministicAcquisitionCaptureMapper.js";
import { createVacancyEvidenceExtractor } from "../../src/application/evidence/createVacancyEvidenceExtractor.js";
import { scopeProviderVacancyEvidence } from "../../src/application/evidence/scopeProviderVacancyEvidence.js";
import { helloWorkHtml, helloWorkPanel, helloWorkPosting, helloWorkRelated, helloWorkUrl, jsonLd } from "../fixtures/helloWorkVacancy.js";

const adapter = new BrowserCaptureAcquisitionAdapter();
function capture(html = helloWorkHtml, pageUrl = helloWorkUrl) {
  const acquisition = adapter.toAcquisitionPackage({ pageUrl, html, visibleText: `FULL PAGE ${helloWorkRelated}`,
    pageTitle: "HelloWork", capturedAt: "2026-10-21T10:00:00Z" }, "capture");
  return { acquisition, observation: new DeterministicAcquisitionCaptureMapper().toSourceObservation(acquisition, "obs") };
}
const extractor = createVacancyEvidenceExtractor();

describe("HelloWork vacancy boundary", () => {
  it("locates the active panel and retains immutable full-page content", () => {
    const { acquisition, observation } = capture();
    expect(acquisition.contexts?.[0]).toMatchObject({ providerKey: "HELLOWORK", providerExternalId: "84500085" });
    expect(acquisition.contexts?.[0]?.text).toContain("13 € / heure");
    expect(acquisition.contexts?.[0]?.text).not.toMatch(/FEHR|32 000|Outside Agency|15 ans/);
    expect(observation.metadata.acquisition).toMatchObject({ html: helloWorkHtml });
    expect(observation.rawContent).toContain("FEHR");
  });
  it("extracts the current title, company, and full location", async () => {
    const { observation } = capture();
    expect(observation).toMatchObject({ title: helloWorkPosting.title, displayedCompanyName: "Crit", locationText: "Strasbourg, Grand Est, FR" });
    const evidence = await extractor.extract(observation);
    expect(evidence.vacancyTitles.every((item) => item.value === helloWorkPosting.title)).toBe(true);
    expect(evidence.organizations.some((item) => item.value === "Crit")).toBe(true);
    expect(JSON.stringify(evidence)).not.toMatch(/FEHR|Outside Agency|Autre Technicien|Bischwiller|L'Industrie/);
  });
  it("extracts only the hourly salary and current experience and contract", async () => {
    const evidence = await extractor.extract(capture().observation);
    expect(evidence.compensations).toEqual(expect.arrayContaining([expect.objectContaining({ minimum: 13, currency: "EUR", period: "HOUR" })]));
    expect(evidence.compensations.every((item) => item.period === "HOUR")).toBe(true);
    expect(evidence.experienceRequirements.length).toBeGreaterThan(0);
    expect(JSON.stringify(evidence.experienceRequirements)).not.toContain("15");
    expect(evidence.engagements.flatMap((item) => item.normalizedTerms)).toContain("INDEFINITE");
    expect(evidence.engagements.flatMap((item) => item.normalizedTerms)).not.toContain("PART_TIME");
    expect(evidence.languageRequirements).toEqual([]);
    expect(evidence.travelRequirements).toEqual([]);
    expect(evidence.organizations).toEqual(expect.arrayContaining([expect.objectContaining({ value: "Crit", role: "STAFFING_AGENCY" })]));
  });
  it("preserves identity with tracking parameters", () => {
    expect(capture(helloWorkHtml, `${helloWorkUrl}?utm_source=x&source=y`).observation.source.externalId).toBe("84500085");
  });
  it("preserves an explicit recruiter genuinely inside the current panel", async () => {
    const html = helloWorkPanel.replace("Le poste requiert", "L'Industrie recrute. Le poste requiert");
    const evidence = await extractor.extract(capture(html).observation);
    expect(evidence.organizations).toEqual(expect.arrayContaining([expect.objectContaining({ value: "L'Industrie", role: "RECRUITER" })]));
  });
  it("rejects structured evidence that disagrees with the observation identity", async () => {
    const observation = capture().observation;
    const evidence = await extractor.extract({ ...observation, source: { ...observation.source, externalId: "99999999" } });
    expect(evidence.organizations).toEqual([]);
    expect(evidence.compensations).toEqual([]);
  });
  it("uses bounded header fields when JSON-LD is absent", () => {
    expect(capture(helloWorkPanel + helloWorkRelated).observation).toMatchObject({ title: helloWorkPosting.title, displayedCompanyName: "Crit", locationText: "Strasbourg" });
  });
  it("allows only a uniquely URL-matched structured job among multiple jobs", () => {
    const unrelated = { ...helloWorkPosting, url: helloWorkUrl.replace("84500085", "99999999"), title: "Other role" };
    expect(capture(jsonLd([unrelated, helloWorkPosting]) + helloWorkRelated).acquisition.structuredFields?.title).toBe(helloWorkPosting.title);
  });
  it.each([
    [{ ...helloWorkPosting, url: undefined }],
    [helloWorkPosting, helloWorkPosting],
    [{ ...helloWorkPosting, url: helloWorkUrl.replace("84500085", "99999999") }],
  ].map((postings) => [postings] as const))("rejects ambiguous or unrelated page-level structured jobs: %j", (postings) => {
    const { acquisition } = capture(jsonLd(postings) + helloWorkRelated);
    expect(acquisition.content.structuredPayload).toBeUndefined();
    expect(acquisition.structuredFields).toBeUndefined();
  });
  it.each([
    helloWorkRelated,
    helloWorkPanel.replace('id="offer-panel"', 'id="changed-layout"') + helloWorkRelated,
    helloWorkPanel + helloWorkPanel,
    helloWorkPanel.replace('</details>', `<a href="/fr-fr/emplois/99999999.html">Other job</a></details>`),
    helloWorkPanel.replace('</details>', '<aside>32 000 - 36 000 € / an</aside></details>'),
  ])("fails closed on an unsupported or ambiguous boundary", async (html) => {
    const { observation } = capture(html);
    const evidence = await extractor.extract({ ...observation, title: "Untrusted Title", salaryText: "32000 EUR / YEAR", displayedCompanyName: "FEHR" });
    expect(evidence.compensations).toEqual([]);
    expect(evidence.experienceRequirements).toEqual([]);
    expect(evidence.organizations).toEqual([]);
    expect(evidence.engagements).toEqual([]);
    expect(evidence.vacancyTitles).toEqual([]);
  });
  it("allows independently matched structured fields without scanning unbounded text", async () => {
    const evidence = await extractor.extract(capture(jsonLd(helloWorkPosting) + helloWorkRelated).observation);
    expect(evidence.compensations.every((item) => !item.rawText.includes("32 000"))).toBe(true);
    expect(evidence.experienceRequirements).toEqual([]);
    expect(evidence.organizations.map((item) => item.value)).toEqual(["Crit"]);
  });
  it("re-extracts old full-page snapshots without mutating their source or mapped fields", async () => {
    const old = { ...capture().observation, salaryText: "32000 - 36000 EUR / YEAR", metadata: { acquisition: { html: helloWorkHtml } } };
    const before = structuredClone(old);
    const scoped = scopeProviderVacancyEvidence(old);
    expect(scopeProviderVacancyEvidence(scoped)).toBe(scoped);
    const evidence = await extractor.extract(scoped);
    expect(evidence.compensations.every((item) => item.period === "HOUR")).toBe(true);
    expect(old).toEqual(before);
  });
});
