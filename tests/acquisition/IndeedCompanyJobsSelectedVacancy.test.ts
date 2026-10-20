import { describe, expect, it } from "vitest";
import { BrowserCaptureAcquisitionAdapter } from "../../src/application/acquisition/BrowserCaptureAcquisitionAdapter.js";
import { DeterministicAcquisitionCaptureMapper } from "../../src/application/acquisition/DeterministicAcquisitionCaptureMapper.js";
import { indeedUrlVacancyId, requiresIndeedSelectedContext } from "../../src/application/acquisition/IndeedSelectedVacancyContextLocator.js";
import { createVacancyEvidenceExtractor } from "../../src/application/evidence/createVacancyEvidenceExtractor.js";
import { ExistingPipelineCanonicalVacancyAdapter } from "../../src/application/vacancies/ExistingPipelineCanonicalVacancyAdapter.js";
import { DeterministicCanonicalVacancyCanonicalizer } from "../../src/application/vacancies/DeterministicCanonicalVacancyCanonicalizer.js";
import { createDatabase } from "../../src/infrastructure/database/createDatabase.js";
import { createCaptureProcessingRuntime } from "../../src/infrastructure/runtime/createCaptureProcessingRuntime.js";
import { SqliteCanonicalVacancyRepository } from "../../src/infrastructure/persistence/SqliteCanonicalVacancyRepository.js";
import { SqliteSourceObservationRepository } from "../../src/infrastructure/persistence/SqliteSourceObservationRepository.js";

const id = "6e0ad005e79c6d26";
const url = `https://fr.indeed.com/cmp/Ondal-France---Mibelle-Group/jobs?jk=${id}&start=0`;
const title = "Technicien de maintenance/automation (H/F)";
const salary = "De 36 000 € à 39 000 € par an";
// The actual company-jobs markers differ from the search-results/native pane.
function pane(identity = `data-indeed-apply-jk="${id}"`, description = "Maintenance des installations.") {
  return `<div data-testid="JobDetail"><div id="acme-webapp-job-details-section" role="region">
    <div data-testid="JobDetailHead">
      <div data-testid="jobDetailTitle"><h3>${title}</h3></div>
      <div data-testid="jobDetailSubtitle"><span>MIBELLE GROUP - Sarreguemines (57)</span></div>
      <span>${salary}</span><span class="indeed-apply-widget" ${identity}><a href="#">Postuler sur Indeed</a></span>
    </div>
    <div data-testid="jobDetailDescription"><div><p>${description}</p></div></div>
  </div></div>`;
}
function page(detail = pane()) {
  return `<header><h1>ONDAL FRANCE - MIBELLE GROUP Emploi et carrière</h1></header>
    <div data-testid="JobList">
      <div class="result job_other1"><a data-jk="other1">Opérateur de production (H/F)</a><div>24 000 - 27 000 € / an</div><p>CDI</p></div>
      <div class="result job_other2"><a data-jk="other2">Technicien de maintenance H/F</a><div>35 000 - 42 000 € / an</div><p>Temps plein</p></div>
      <div class="result job_other3"><a data-jk="other3">Approvisionneur de ligne / cariste</a><div>2 070 - 2 100 € / mois</div></div>
    </div>${detail}<footer>Company profile information</footer>`;
}
function payload(markup = page(), pageUrl = url) {
  return { pageUrl, pageTitle: "ONDAL FRANCE - MIBELLE GROUP", visibleText: "Full company jobs page with several vacancies", html: markup, capturedAt: "2026-10-20T10:00:00Z" };
}
function capture(markup = page(), pageUrl = url) {
  const acquisition = new BrowserCaptureAcquisitionAdapter().toAcquisitionPackage(payload(markup, pageUrl), "acquisition");
  return { acquisition, observation: new DeterministicAcquisitionCaptureMapper().toSourceObservation(acquisition, "observation") };
}
async function projection(markup = page(), pageUrl = url) {
  const captured = capture(markup, pageUrl);
  const evidence = await createVacancyEvidenceExtractor().extract(captured.observation);
  const canonical = new ExistingPipelineCanonicalVacancyAdapter(new DeterministicCanonicalVacancyCanonicalizer()).canonicalize({
    canonicalVacancyId: "canonical", observations: [captured.observation], extractedEvidence: [evidence],
    derivation: { algorithm: "test", algorithmVersion: "1", derivedAt: new Date("2026-10-20") },
  });
  return { ...captured, evidence, canonical };
}

describe("Indeed company-jobs selected pane", () => {
  it.each([url, url.replace("&start=0", "&start=10&tracking=test"), url.replace("/jobs?", "/jobs/?")])("recognizes supported company jobs identity at %s", (pageUrl) => {
    expect(indeedUrlVacancyId(pageUrl)).toBe(id);
    expect(requiresIndeedSelectedContext(pageUrl)).toBe(true);
    expect(capture(page(), pageUrl).acquisition.externalId).toBe(id);
  });

  it.each([
    "https://fr.indeed.com/cmp/Example/reviews?jk=abc",
    "https://fr.indeed.com/cmp/Example?jk=abc",
    "https://fr.indeed.com/cmp/Example/jobs/other?jk=abc",
    "https://fake-indeed.com/cmp/Example/jobs?jk=abc",
  ])("does not accept company-job jk on unrelated routes/hosts: %s", (pageUrl) => {
    expect(indeedUrlVacancyId(pageUrl)).toBeUndefined();
  });

  it("projects selected title, company, locality and annual salary without neighboring/profile evidence", async () => {
    const { acquisition, observation, evidence, canonical } = await projection();
    expect(acquisition.contexts).toHaveLength(1);
    expect(acquisition.contexts![0]).toMatchObject({ providerKey: "INDEED", providerExternalId: id });
    expect(acquisition.contexts![0]!.html).toMatch(/^<div data-testid="JobDetail"/u);
    expect(canonical.role).toMatchObject({ status: "RESOLVED", value: { title } });
    expect(canonical.location).toMatchObject({ status: "RESOLVED", value: { rawText: "Sarreguemines (57)" } });
    expect(canonical.compensation).toMatchObject({ status: "RESOLVED", value: { rawText: salary, currency: "EUR", minimum: 36000, maximum: 39000, period: "YEAR" } });
    expect(canonical.organizationRelationships).toEqual([expect.objectContaining({ role: "DISPLAYED_COMPANY", rawName: "MIBELLE GROUP" })]);
    expect(canonical.engagement.status).toBe("UNKNOWN");
    expect(observation.rawContent).toContain("Full company jobs page");
    expect(observation.metadata.acquisition).toMatchObject({ contexts: acquisition.contexts });
    expect(JSON.stringify(evidence)).not.toMatch(/ONDAL|Opérateur de production|Approvisionneur|24000|27000|35000|42000|2070|2100/u);
    expect(acquisition.contexts![0]!.text).not.toContain("Technicien de maintenance H/F");
    for (const item of [...evidence.vacancyTitles, ...evidence.organizations, ...evidence.locations, ...evidence.compensations]) {
      expect(item.provenance.contentOrigin).toBe("SELECTED_VACANCY_CONTEXT");
    }
  });

  it("accepts URL jk when the supported pane does not repeat an explicit identifier", () => {
    const { acquisition } = capture(page(pane("")));
    expect(acquisition.contexts![0]?.providerExternalId).toBe(id);
    expect(acquisition.contexts![0]?.associationEvidence).toContain("URL_EXTERNAL_ID");
    expect(acquisition.contexts![0]?.associationEvidence).not.toContain("DETAIL_EXTERNAL_ID_MATCH");
  });

  it("can use an explicit pane key without a URL jk", () => {
    expect(capture(page(), url.replace(`jk=${id}&`, "")).acquisition.externalId).toBe(id);
  });

  it("keeps the selected title verbatim across company jobs variants", async () => {
    const actualTitle = "Technicien de maintenance/automaticien (H/F)";
    const { canonical } = await projection(page().replace(title, actualTitle));
    expect(canonical.role.value?.title).toBe(actualTitle);
  });

  it("extracts employment terms only when present in the selected description", async () => {
    const { canonical } = await projection(page(pane(undefined, "CDI à temps plein.")));
    expect(canonical.engagement).toMatchObject({ status: "RESOLVED", value: { normalizedTerms: expect.arrayContaining(["INDEFINITE", "FULL_TIME"]) } });
  });

  it.each([
    `data-indeed-apply-jk="other"`,
    `data-indeed-apply-jk="${id}" data-indeed-apply-joburl="https://fr.indeed.com/viewjob?jk=other"`,
    `data-indeed-apply-jk="${id}" data-indeed-apply-pingbackurl="https://gdc.indeed.com/conv/orgIndApp?jk=other"`,
  ])("fails closed for conflicting selected identity %s", async (identity) => {
    const { acquisition, evidence, canonical } = await projection(page(pane(identity)));
    expect(acquisition.contexts).toBeUndefined();
    expect(evidence.organizations).toEqual([]);
    expect(evidence.compensations).toEqual([]);
    expect(canonical.role.status).toBe("UNKNOWN");
    expect(canonical.location.status).toBe("UNKNOWN");
    expect(canonical.compensation.status).toBe("UNKNOWN");
  });

  it.each([
    ["missing", ""],
    ["unbounded", pane().slice(0, -6)],
    ["duplicate", pane() + pane()],
    ["missing description marker", pane().replace('data-testid="jobDetailDescription"', 'data-testid="unknownDescription"')],
    ["whole profile mislabeled as detail", `<div data-testid="JobDetail">${page()}</div>`],
  ])("preserves fail-closed behavior for %s pane", async (_label, detail) => {
    const { acquisition, evidence, canonical } = await projection(page(detail));
    expect(acquisition.contexts).toBeUndefined();
    expect(evidence.vacancyTitles).toEqual([]);
    expect(evidence.organizations).toEqual([]);
    expect(evidence.locations).toEqual([]);
    expect(evidence.engagements).toEqual([]);
    expect(evidence.compensations).toEqual([]);
    expect(canonical.role.status).toBe("UNKNOWN");
    expect(canonical.engagement.status).toBe("UNKNOWN");
  });

  it("rejects ambiguous URL jk values without falling back to profile evidence", async () => {
    const { acquisition, canonical } = await projection(page(), `${url}&jk=other`);
    expect(acquisition.contexts).toBeUndefined();
    expect(canonical.role.status).toBe("UNKNOWN");
  });

  it("preserves source immutability and canonical identity across exact and changed captures", async () => {
    const db = createDatabase(":memory:");
    try {
      const runtime = createCaptureProcessingRuntime(db);
      const first = await runtime.captureAndProcessBrowserVacancy(payload());
      if (first.processing.status !== "PROCESSED") throw new Error("Processing failed");
      const sources = new SqliteSourceObservationRepository(db);
      const original = await sources.findById(first.capture.observationId);
      const second = await runtime.captureAndProcessBrowserVacancy({ ...payload(), capturedAt: "2026-10-20T11:00:00Z" });
      expect(second.capture.observationId).toBe(first.capture.observationId);
      expect(second.processing).toMatchObject({ status: "PROCESSED", canonicalVacancyId: first.processing.canonicalVacancyId, observationAdded: false });
      expect(await sources.countCaptureOccurrences([first.capture.observationId])).toBe(2);
      const changed = await runtime.captureAndProcessBrowserVacancy({ ...payload(page(pane(undefined, "Updated selected job description."))), capturedAt: "2026-10-20T12:00:00Z" });
      expect(changed.capture.observationId).not.toBe(first.capture.observationId);
      expect(changed.processing).toMatchObject({ status: "PROCESSED", canonicalVacancyId: first.processing.canonicalVacancyId, observationAdded: true });
      expect(await sources.findById(first.capture.observationId)).toEqual(original);
      const canonical = await new SqliteCanonicalVacancyRepository(db).findById(first.processing.canonicalVacancyId);
      expect(canonical?.sourceObservationIds).toHaveLength(2);
      expect(canonical?.compensation).toMatchObject({ status: "RESOLVED", value: { minimum: 36000, maximum: 39000, period: "YEAR" } });
      expect(db.prepare("SELECT COUNT(*) AS count FROM source_observations").get()).toEqual({ count: 2 });
      expect(db.prepare("SELECT COUNT(*) AS count FROM canonical_vacancies").get()).toEqual({ count: 1 });
      expect(db.prepare("SELECT COUNT(*) AS count FROM observation_cluster_assignments WHERE status = 'USER_CONFIRMED'").get()).toEqual({ count: 0 });
    } finally { db.close(); }
  });

  it("documents the existing unresolved-cluster fallback for a safely empty capture", async () => {
    const db = createDatabase(":memory:");
    try {
      const result = await createCaptureProcessingRuntime(db).captureAndProcessBrowserVacancy(payload(page("")));
      expect(result.processing.status).toBe("PROCESSED");
      expect(db.prepare("SELECT status, display_label FROM employer_clusters").all()).toEqual([{ status: "UNRESOLVED", display_label: "Unknown employer" }]);
      expect(db.prepare("SELECT status, algorithm FROM observation_cluster_assignments").all()).toEqual([{ status: "ACCEPTED", algorithm: "new-employer-cluster" }]);
    } finally { db.close(); }
  });
});
