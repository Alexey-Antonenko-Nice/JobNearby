import { describe, expect, it } from "vitest";
import { BrowserCaptureAcquisitionAdapter } from "../../src/application/acquisition/BrowserCaptureAcquisitionAdapter.js";
import { DeterministicAcquisitionCaptureMapper } from "../../src/application/acquisition/DeterministicAcquisitionCaptureMapper.js";
import { createVacancyEvidenceExtractor } from "../../src/application/evidence/createVacancyEvidenceExtractor.js";
import { scopeIndeedVacancyEvidence } from "../../src/application/evidence/scopeIndeedVacancyEvidence.js";
import { createDatabase } from "../../src/infrastructure/database/createDatabase.js";
import { createCaptureProcessingRuntime } from "../../src/infrastructure/runtime/createCaptureProcessingRuntime.js";
import { SqliteCanonicalVacancyRepository } from "../../src/infrastructure/persistence/SqliteCanonicalVacancyRepository.js";
import { SqliteSourceObservationRepository } from "../../src/infrastructure/persistence/SqliteSourceObservationRepository.js";
import { ExistingPipelineCanonicalVacancyAdapter } from "../../src/application/vacancies/ExistingPipelineCanonicalVacancyAdapter.js";
import { DeterministicCanonicalVacancyCanonicalizer } from "../../src/application/vacancies/DeterministicCanonicalVacancyCanonicalizer.js";

const id = "30ccaeae1804d228";
const root = "https://fr.indeed.com/";
const salary = "De 2 500 € à 2 700 € par mois";
// Minimized from the native pane in the captured live regression.
function panel(link = `/viewjob?jk=${id}`, extra = "") {
  return `<div id="jobsearch-ViewjobPaneWrapper"><div id="rnvjContainerDesktop">
    <div data-testid="viewjob-main-content">
      <div data-testid="desktop-job-header">
        <h5 data-testid="vj-job-title">Technicien polyvalent H/F</h5>
        <div data-testid="company-info-metadata"><div data-testid="vj-company-name">Help Confort Strasbourg</div><div>Strasbourg (67)</div></div>
        <div>${salary}</div><div>CDI</div><a href="${link}">Postuler maintenant</a>
      </div>
      <div data-testid="viewjob-job-content"><h4>Description du poste</h4><p>Service et dépannage chez les clients. ${extra}</p></div>
    </div>
  </div></div>`;
}
function page(detail = panel(), selectedId = id) {
  return `<nav>Search location: Paris</nav><aside>Vos préférences : 30 k € / an</aside>
    <div class="result job_other"><a data-jk="other">Autre emploi H/F</a><div>Other Company</div><p>80k - 90k € / an</p></div>
    <div class="result vjs-highlight job_${selectedId}"><a data-jk="${selectedId}">Selected card</a></div>
    ${detail}<footer>Footer Company</footer>`;
}
function capture(html = page(), pageUrl = root) {
  const acquisition = new BrowserCaptureAcquisitionAdapter().toAcquisitionPackage({ pageUrl, pageTitle: "Indeed results", visibleText: "ACCOUNT 30 k € / an\nOTHER CARD 80k - 90k € / an\nSELECTED VACANCY", html, capturedAt: "2026-10-20T10:00:00Z" }, "acquisition");
  const observation = new DeterministicAcquisitionCaptureMapper().toSourceObservation(acquisition, "observation");
  return { acquisition, observation };
}
function canonicalize(observation: ReturnType<typeof capture>["observation"], extractedEvidence: Awaited<ReturnType<ReturnType<typeof createVacancyEvidenceExtractor>["extract"]>>) {
  return new ExistingPipelineCanonicalVacancyAdapter(new DeterministicCanonicalVacancyCanonicalizer()).canonicalize({
    canonicalVacancyId: "canonical", observations: [observation], extractedEvidence: [extractedEvidence],
    derivation: { algorithm: "test", algorithmVersion: "1", derivedAt: new Date("2026-10-20") },
  });
}

describe("Indeed native selected-vacancy isolation", () => {
  it.each([
    `/viewjob?jk=${id}`, `https://fr.indeed.com/viewjob?vjk=${id}`, `/cmp/Help-Confort?fromjk=${id}`,
    `https://smartapply.indeed.com/beta/indeedapply/applybyapplyablejobid?pingbackUrl=${encodeURIComponent(`https://gdc.indeed.com/conv/orgIndApp?jk=${id}`)}`,
  ])("obtains SPA identity only from the selected provider link %s", async (link) => {
    const { acquisition, observation } = capture(page(panel(link)));
    expect(acquisition.externalId).toBe(id);
    expect(acquisition.contexts).toHaveLength(1);
    expect(acquisition.contexts![0]!.providerExternalId).toBe(id);
    expect(acquisition.contexts![0]!.text).not.toMatch(/30 k|80k|Other Company|Autre emploi|Paris|Footer Company/u);
    const evidence = await createVacancyEvidenceExtractor().extract(observation);
    const canonical = canonicalize(observation, evidence);
    expect(canonical.role).toMatchObject({ status: "RESOLVED", value: { title: "Technicien polyvalent H/F" } });
    expect(canonical.location).toMatchObject({ status: "RESOLVED", value: { rawText: "Strasbourg (67)" } });
    expect(canonical.compensation).toMatchObject({ status: "RESOLVED", value: { rawText: salary, currency: "EUR", minimum: 2500, maximum: 2700, period: "MONTH" } });
    expect(canonical.engagement).toMatchObject({ status: "RESOLVED", value: { normalizedTerms: ["INDEFINITE"] } });
    expect(canonical.organizationRelationships).toContainEqual(expect.objectContaining({ role: "DISPLAYED_COMPANY", rawName: "Help Confort Strasbourg" }));
    expect(canonical.organizationRelationships.some((r) => r.role === "EMPLOYER")).toBe(false);
    expect(evidence.locations[0]?.provenance.contentOrigin).toBe("SELECTED_VACANCY_CONTEXT");
    expect(evidence.compensations[0]?.provenance.contentOrigin).toBe("SELECTED_VACANCY_CONTEXT");
    expect(JSON.stringify(evidence)).not.toMatch(/30 k|80k|Other Company|Autre emploi|Paris/u);
  });

  it("retains full-time only when explicit in the selected context", async () => {
    const { observation } = capture(page(panel(`/viewjob?jk=${id}`, "CDI à temps plein.")));
    const evidence = await createVacancyEvidenceExtractor().extract(observation);
    expect(canonicalize(observation, evidence).engagement.value?.normalizedTerms).toEqual(expect.arrayContaining(["INDEFINITE", "FULL_TIME"]));
  });

  it.each(["2\u202f500", "2\u00a0500", "2 500", "2500,00"])("normalizes selected salary separators %s", async (amount) => {
    const { observation } = capture(page(panel().replace("2 500", amount)));
    const evidence = await createVacancyEvidenceExtractor().extract(observation);
    expect(evidence.compensations[0]).toMatchObject({ minimum: 2500, maximum: 2700, period: "MONTH" });
  });

  it.each([
    ["missing pane", ""],
    ["unbounded pane", panel().slice(0, -12)],
    ["duplicate panes", panel() + panel()],
    ["foreign identity link", panel(`https://evil.example/viewjob?jk=${id}`)],
    ["foreign nested identity", panel(`https://smartapply.indeed.com/beta/indeedapply/applybyapplyablejobid?pingbackUrl=${encodeURIComponent(`https://evil.example/?jk=${id}`)}`)],
    ["two explicit keys", panel().replace("Postuler maintenant</a>", 'Postuler maintenant</a><a href="/viewjob?jk=other">Other</a>')],
  ])("fails closed for %s without extracting preferences or page-level JSON-LD", async (_label, detail) => {
    const full = page(detail) + `<script type="application/ld+json">${JSON.stringify({ "@type": "JobPosting", title: "Poisoned title H/F", hiringOrganization: { name: "Poisoned Company" }, baseSalary: { currency: "EUR", value: { minValue: 30000, maxValue: 30000, unitText: "YEAR" } } })}</script>`;
    const { acquisition, observation } = capture(full);
    expect(acquisition.contexts).toBeUndefined();
    expect(observation.rawContent).toContain("ACCOUNT 30 k");
    expect(observation.title).toBeUndefined();
    const evidence = await createVacancyEvidenceExtractor().extract(observation);
    expect(evidence.vacancyTitles).toEqual([]);
    expect(evidence.organizations).toEqual([]);
    expect(evidence.locations).toEqual([]);
    expect(evidence.engagements).toEqual([]);
    expect(evidence.compensations).toEqual([]);
    const canonical = canonicalize(observation, evidence);
    expect(canonical.role.status).toBe("UNKNOWN");
    expect(canonical.compensation.status).toBe("UNKNOWN");
  });

  it("rejects URL/card/detail identity disagreements", () => {
    expect(capture(page(), `${root}?vjk=another`).acquisition.contexts).toBeUndefined();
    expect(capture(page(), `${root}?vjk=${id}&vjk=another`).acquisition.contexts).toBeUndefined();
    expect(capture(page(panel(), "another")).acquisition.contexts).toBeUndefined();
    expect(capture(page(panel()) + `<div class="result vjs-highlight job_${id}"><a data-jk="${id}">duplicate</a></div>`).acquisition.contexts).toBeUndefined();
  });

  it("does not treat script markup as a real selection or detail region", () => {
    expect(capture(`<script>${JSON.stringify(page())}</script>`).acquisition.contexts).toBeUndefined();
  });

  it("blocks unsafe historical source fields during extraction and canonical projection", async () => {
    const { observation } = capture(page(""));
    const poisoned = { ...observation, title: "Other role H/F", displayedCompanyName: "Other Company", locationText: "Paris", salaryText: "30000 - 30000 EUR / YEAR", contractText: "FULL_TIME" };
    const original = structuredClone(poisoned);
    const evidence = await createVacancyEvidenceExtractor().extract(poisoned);
    const projected = canonicalize(poisoned, evidence);
    expect(projected.role.status).toBe("UNKNOWN");
    expect(projected.compensation.status).toBe("UNKNOWN");
    expect(projected.location.status).toBe("UNKNOWN");
    expect(projected.engagement.status).toBe("UNKNOWN");
    expect(projected.organizationRelationships).toEqual([]);
    expect(poisoned).toEqual(original);
  });

  it("scopes persisted successful contexts for direct composite callers without mutating source", async () => {
    const { observation } = capture();
    const poisoned = { ...observation, displayedCompanyName: "Other Company", title: "Other role H/F", salaryText: "30000 - 30000 EUR / YEAR" };
    const scoped = scopeIndeedVacancyEvidence(poisoned);
    expect(scoped.displayedCompanyName).toBeUndefined();
    const evidence = await createVacancyEvidenceExtractor().extract(poisoned);
    expect(evidence.organizations.map((o) => o.value)).toEqual(["Help Confort Strasbourg"]);
    expect(canonicalize(poisoned, evidence).role.value?.title).toBe("Technicien polyvalent H/F");
    expect(canonicalize(poisoned, evidence).compensation).toMatchObject({ status: "RESOLVED", value: { minimum: 2500, maximum: 2700, period: "MONTH" } });
    expect(poisoned.displayedCompanyName).toBe("Other Company");
  });

  it("preserves the generic direct-job path and extracts jk identity", async () => {
    const { acquisition, observation } = capture(`<script type="application/ld+json">${JSON.stringify({ "@type": "JobPosting", title: "Direct title H/F", hiringOrganization: { name: "Direct Company" }, jobLocation: { address: { addressLocality: "Lyon" } } })}</script>`, `https://fr.indeed.com/viewjob?jk=${id}`);
    expect(acquisition.externalId).toBe(id);
    expect(observation.title).toBe("Direct title H/F");
    expect((await createVacancyEvidenceExtractor().extract(observation)).vacancyTitles).toContainEqual(expect.objectContaining({ value: "Direct title H/F" }));
  });

  it("isolates a native direct-job pane without claiming a selected-card association", () => {
    const { acquisition } = capture(panel(), `https://fr.indeed.com/viewjob?jk=${id}`);
    expect(acquisition.contexts).toHaveLength(1);
    expect(acquisition.contexts![0]!.associationEvidence).not.toContain("MATCHING_SELECTED_RESULT");
  });

  it("reuses exact captures, keeps changed snapshots in one canonical history, and preserves employer safety", async () => {
    const db = createDatabase(":memory:");
    try {
      const runtime = createCaptureProcessingRuntime(db);
      const payload = { pageUrl: root, pageTitle: "Indeed", visibleText: "30 k € / an outside selected context", html: page(), capturedAt: "2026-10-20T10:00:00Z" };
      const first = await runtime.captureAndProcessBrowserVacancy(payload);
      if (first.processing.status !== "PROCESSED") throw new Error("Processing failed");
      const canonicalId = first.processing.canonicalVacancyId;
      const sources = new SqliteSourceObservationRepository(db);
      const original = await sources.findById(first.capture.observationId);
      const second = await runtime.captureAndProcessBrowserVacancy({ ...payload, capturedAt: "2026-10-20T11:00:00Z" });
      expect(second.capture.observationId).toBe(first.capture.observationId);
      expect(second.processing).toMatchObject({ status: "PROCESSED", canonicalVacancyId: canonicalId, observationAdded: false });
      expect(await sources.countCaptureOccurrences([first.capture.observationId])).toBe(2);
      const changed = await runtime.captureAndProcessBrowserVacancy({ ...payload, html: page(panel(`/viewjob?jk=${id}`, "Updated selected description.")), capturedAt: "2026-10-20T12:00:00Z" });
      expect(changed.capture.observationId).not.toBe(first.capture.observationId);
      expect(changed.processing).toMatchObject({ status: "PROCESSED", canonicalVacancyId: canonicalId, observationAdded: true });
      const canonical = (await new SqliteCanonicalVacancyRepository(db).findById(canonicalId))!;
      expect(canonical.compensation).toMatchObject({ status: "RESOLVED", value: { minimum: 2500, maximum: 2700, period: "MONTH" } });
      expect(canonical.sourceObservationIds).toHaveLength(2);
      expect(await sources.findById(first.capture.observationId)).toEqual(original);
      expect(db.prepare("SELECT COUNT(*) AS count FROM source_observations").get()).toEqual({ count: 2 });
      expect(db.prepare("SELECT COUNT(*) AS count FROM employer_clusters").get()).toEqual({ count: 1 });
      expect(db.prepare("SELECT COUNT(*) AS count FROM observation_cluster_assignments WHERE status = 'USER_CONFIRMED'").get()).toEqual({ count: 0 });
      expect(canonical.organizationRelationships).toContainEqual(expect.objectContaining({ role: "EMPLOYER", employerClusterId: expect.any(String) }));
      expect(canonical.organizationRelationships.find((r) => r.role === "EMPLOYER")?.rawName).toBeUndefined();
    } finally { db.close(); }
  });
});
