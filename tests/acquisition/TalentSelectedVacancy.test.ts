import { describe, expect, it } from "vitest";
import { BrowserCaptureAcquisitionAdapter } from "../../src/application/acquisition/BrowserCaptureAcquisitionAdapter.js";
import { DeterministicAcquisitionCaptureMapper } from "../../src/application/acquisition/DeterministicAcquisitionCaptureMapper.js";
import { createVacancyEvidenceExtractor } from "../../src/application/evidence/createVacancyEvidenceExtractor.js";
import { ExistingPipelineCanonicalVacancyAdapter } from "../../src/application/vacancies/ExistingPipelineCanonicalVacancyAdapter.js";
import { DeterministicCanonicalVacancyCanonicalizer } from "../../src/application/vacancies/DeterministicCanonicalVacancyCanonicalizer.js";
import { createDatabase } from "../../src/infrastructure/database/createDatabase.js";
import { createCaptureProcessingRuntime } from "../../src/infrastructure/runtime/createCaptureProcessingRuntime.js";
import { SqliteCanonicalVacancyRepository } from "../../src/infrastructure/persistence/SqliteCanonicalVacancyRepository.js";
import { SqliteSourceObservationRepository } from "../../src/infrastructure/persistence/SqliteSourceObservationRepository.js";

const id = "642440967493256520";
const url = `https://fr.talent.com/jobs?l=Marseille&id=${id}`;
const title = "Conducteur de ligne (H/F)";
const company = "ACTUAL MARSEILLE";
const location = "Allauch, 13 - Bouches-du-Rhône, France";
// Live component shape, with generated classes omitted. The selected pane's
// header and description share a two-child container, outside the result cards.
const header = `<header><div data-customstyle="mobile-topsection"><header><div data-hook="job-card-container">
  <h2>${title}</h2><span>${company}</span><span>${location}</span><div><nav><a href="/redirect?id=${id}&amp;action=quickapply">Quick Apply</a></nav></div>
  </div></header></div><div><span>Type de contrat</span><ul><li>Temporaire</li></ul></div></header>`;
const description = `<div><div tabindex="0"><div><span>Description de poste</span><div>
  <p>Acteur de l'industrie pharmaceutique formes liquides et solides.</p>
  <p>ACTUAL RECRUTE ! Conducteur de ligne de conditionnement pharmaceutique (H/F). Contrat d'intérim 39 h/semaine.</p>
  <p>Actual recrute des Conducteurs de ligne. Débutant accepté. Salaire selon profil.</p>
  </div></div></div></div>`;
const pane = (head = header, body = description) => `<div>${head}${body}</div>`;
const unrelated = `<div data-job-id="unrelated-legacy-key" data-new-id="603602935722547640"><article>
  <h2>Mécanicien automobile</h2><span>Olacar</span><p>Marseille</p><p>au moins 5 ans d'expérience</p>
  <p>80 000 - 90 000 € / an</p><p>Temps plein</p><p>maîtrise de l'allemand</p><p>déplacements réguliers</p></article></div>`;
const page = (detail = pane()) => `<nav>Homepage</nav><div><input value="Marseille"><p>Télétravail</p></div>
  <main><div><div>${unrelated}</div><div>${detail}</div></div></main><footer>Footer Company</footer>`;
const adapter = new BrowserCaptureAcquisitionAdapter();
const extractor = createVacancyEvidenceExtractor();
function capture(html = page(), pageUrl = url) {
  const acquisition = adapter.toAcquisitionPackage({ pageUrl, html, pageTitle: "Talent", capturedAt: "2026-10-22T07:00:00Z",
    visibleText: `Marseille\nTélétravail\nMécanicien automobile\nau moins 5 ans d'expérience\n${title}\n${company}\n${location}` }, "capture");
  return { acquisition, observation: new DeterministicAcquisitionCaptureMapper().toSourceObservation(acquisition, "observation") };
}
async function project(html = page()) {
  const { observation } = capture(html);
  const evidence = await extractor.extract(observation);
  const canonical = new ExistingPipelineCanonicalVacancyAdapter(new DeterministicCanonicalVacancyCanonicalizer()).canonicalize({
    canonicalVacancyId: "canonical", observations: [observation], extractedEvidence: [evidence],
    derivation: { algorithm: "test", algorithmVersion: "1", derivedAt: new Date("2026-10-22") },
  });
  return { evidence, canonical };
}

describe("Talent.com selected vacancy isolation", () => {
  it.each([url, `https://fr.talent.com/jobs?id=${id}&l=Paris&utm_source=test`, `https://www.talent.com/view?id=${id}`])("recognizes the provider and URL identity independently of search/tracking: %s", (pageUrl) => {
    const { acquisition, observation } = capture(page(), pageUrl);
    expect(observation.source).toMatchObject({ sourceName: "talent.com", externalId: id });
    expect(acquisition.contexts).toHaveLength(1);
    expect(acquisition.contexts![0]).toMatchObject({ providerKey: "TALENT", providerExternalId: id });
    expect(acquisition.contexts![0]!.text).toContain("Débutant accepté");
    expect(acquisition.contexts![0]!.text).not.toMatch(/Télétravail|Mécanicien|Olacar|5 ans|80 000|Footer Company/);
  });
  it("projects selected title, displayed company, and Allauch rather than search Marseille", async () => {
    const { canonical, evidence } = await project();
    expect(canonical.role).toMatchObject({ status: "RESOLVED", value: { title } });
    expect(canonical.location).toMatchObject({ status: "RESOLVED", value: { rawText: location } });
    expect(evidence.locations.every((item) => item.value === location)).toBe(true);
    expect(canonical.organizationRelationships).toContainEqual(expect.objectContaining({ role: "DISPLAYED_COMPANY", rawName: company }));
    expect(JSON.stringify(evidence)).not.toMatch(/Mécanicien|Olacar|5 ans|80 000|allemand|Footer Company/);
  });
  it("extracts explicit interim without inferring full-time from working hours", async () => {
    const { canonical } = await project();
    expect(canonical.engagement.value?.normalizedTerms).toEqual(["INTERIM"]);
  });
  it("keeps filter work mode, unrelated experience and salary out of the projection", async () => {
    const { canonical, evidence } = await project();
    expect(canonical.workMode.status).toBe("UNKNOWN");
    expect(canonical.experienceRequirements.status).toBe("UNKNOWN");
    expect(canonical.compensation.status).toBe("UNKNOWN");
    expect(evidence.languageRequirements).toEqual([]);
    expect(evidence.travelRequirements).toEqual([]);
  });
  it("retains existing recruiter semantics without inventing an employer", async () => {
    const { canonical } = await project();
    expect(canonical.organizationRelationships).toContainEqual(expect.objectContaining({ role: "RECRUITER", rawName: "Actual" }));
    expect(canonical.organizationRelationships.some((item) => item.role === "EMPLOYER")).toBe(false);
  });
  it("allows explicit work mode and salary when genuinely inside the selected pane", async () => {
    const { canonical } = await project(page(pane(header, description.replace("Salaire selon profil.", "</p><p>Hybride</p><p>13 € / heure</p><p>"))));
    expect(canonical.workMode).toMatchObject({ status: "RESOLVED", value: "HYBRID" });
    expect(canonical.compensation).toMatchObject({ status: "RESOLVED", value: { minimum: 13, period: "HOUR" } });
  });
  it.each([
    pane(header.replace(id, "603602935722547640")),
    pane(header.replace('<div data-hook="job-card-container">', '<div data-hook="job-card-container" data-new-id="603602935722547640">')),
    pane(header.replace('<div data-hook="job-card-container">', '<div data-hook="job-card-container" data-job-id="unknown-legacy-key">')),
    pane(header.replace(`id=${id}`, `id=${id}&amp;id=603602935722547640`)),
  ])("rejects inconsistent or unverified explicit pane identifiers", async (detail) => {
    const { acquisition, observation } = capture(page(detail));
    expect(acquisition.externalId).toBe(id);
    expect(acquisition.contexts).toBeUndefined();
    expect((await extractor.extract(observation)).vacancyTitles).toEqual([]);
  });
  it.each([
    "", pane() + pane(), pane(header, ""),
    pane(header.replace('data-hook="job-card-container"', 'data-hook="unknown-header"')),
    pane(header.replace(`/redirect?id=${id}&amp;action=quickapply`, "https://evil.example/redirect?id=" + id)),
    pane(header.replace(`/redirect?id=${id}&amp;action=quickapply`, "#")),
    pane(header, description.replace("Débutant accepté", `${unrelated}Débutant accepté`)),
    pane(header, description.replace("Description de poste", "Unknown layout")),
  ])("fails closed without a supported, independently identified selected pane", async (detail) => {
    const { acquisition, observation } = capture(page(detail));
    expect(acquisition.externalId).toBe(id);
    expect(acquisition.contexts).toBeUndefined();
    const evidence = await extractor.extract({ ...observation, title: "Other title H/F", displayedCompanyName: "Olacar", locationText: "Marseille", salaryText: "80000 EUR / YEAR", contractText: "FULL_TIME" });
    expect(evidence.vacancyTitles).toEqual([]);
    expect(evidence.organizations).toEqual([]);
    expect(evidence.locations).toEqual([]);
    expect(evidence.workModes).toEqual([]);
    expect(evidence.experienceRequirements).toEqual([]);
    expect(evidence.compensations).toEqual([]);
    expect(evidence.engagements).toEqual([]);
  });
  it.each([`https://fr.talent.com/jobs?l=Marseille`, `${url}&id=other`, `${url}&id=603602935722547640`])("does not invent identity from title/company/location: %s", (pageUrl) => {
    expect(capture(page(), pageUrl).acquisition.externalId).toBeUndefined();
    expect(capture(page(), pageUrl).acquisition.contexts).toBeUndefined();
  });
  it.each([page(), page("")])("does not use multiple/unassociated page-level JobPostings", async (html) => {
    const postings = [{ "@type": "JobPosting", url: `https://fr.talent.com/view?id=603602935722547640`, title: "Poisoned H/F", hiringOrganization: { name: "Other Company" } }];
    const { acquisition, observation } = capture(`${html}<script type="application/ld+json">${JSON.stringify(postings)}</script>`);
    expect(acquisition.content.structuredPayload).toBeUndefined();
    expect(JSON.stringify(await extractor.extract(observation))).not.toContain("Poisoned");
  });
  it("re-extracts an old ID-less capture safely without rewriting its immutable content", async () => {
    const { observation } = capture();
    const { externalId: _, ...source } = observation.source;
    const old = { ...observation, source, metadata: { acquisition: { html: page() } } };
    const before = structuredClone(old);
    const evidence = await extractor.extract(old);
    expect(evidence.vacancyTitles).toContainEqual(expect.objectContaining({ value: title }));
    expect(evidence.workModes).toEqual([]);
    expect(evidence.experienceRequirements).toEqual([]);
    expect(old).toEqual(before);
  });
  it("reuses identical captures, preserves changed-snapshot continuity and unresolved employer semantics", async () => {
    const db = createDatabase(":memory:");
    try {
      const runtime = createCaptureProcessingRuntime(db);
      const sources = new SqliteSourceObservationRepository(db);
      const canonicals = new SqliteCanonicalVacancyRepository(db);
      const payload = { pageUrl: url, pageTitle: "Talent", html: page(), visibleText: "Marseille\nTélétravail\nau moins 5 ans d'expérience\n" + title, capturedAt: "2026-10-22T07:00:00Z" };
      const first = await runtime.captureAndProcessBrowserVacancy(payload);
      if (first.processing.status !== "PROCESSED") throw Error("Processing failed");
      const canonicalId = first.processing.canonicalVacancyId;
      const original = await sources.findById(first.capture.observationId);
      const assignments = db.prepare("SELECT * FROM observation_cluster_assignments ORDER BY id").all();
      for (const capturedAt of ["2026-10-22T07:01:00Z", "2026-10-22T07:02:00Z"]) {
        const repeat = await runtime.captureAndProcessBrowserVacancy({ ...payload, pageUrl: `https://fr.talent.com/jobs?id=${id}&l=Paris&utm_source=repeat`, capturedAt });
        expect(repeat.capture.observationId).toBe(first.capture.observationId);
        expect(repeat.processing).toMatchObject({ canonicalVacancyId: canonicalId, observationAdded: false });
      }
      expect(await sources.countCaptureOccurrences([first.capture.observationId])).toBe(3);
      expect(db.prepare("SELECT * FROM observation_cluster_assignments ORDER BY id").all()).toEqual(assignments);
      const changed = await runtime.captureAndProcessBrowserVacancy({ ...payload, html: page(pane(header, description.replace("Débutant accepté", "Débutant accepté et formé"))), capturedAt: "2026-10-22T07:03:00Z" });
      expect(changed.capture.observationId).not.toBe(first.capture.observationId);
      expect(changed.processing).toMatchObject({ canonicalVacancyId: canonicalId, observationAdded: true });
      expect(db.prepare("SELECT COUNT(*) AS count FROM source_observations").get()).toEqual({ count: 2 });
      expect(db.prepare("SELECT COUNT(*) AS count FROM employer_clusters WHERE status='UNRESOLVED'").get()).toEqual({ count: 1 });
      expect(db.prepare("SELECT COUNT(DISTINCT employer_cluster_id) AS count FROM observation_cluster_assignments").get()).toEqual({ count: 1 });
      expect(await sources.findById(first.capture.observationId)).toEqual(original);
      const current = (await canonicals.findById(canonicalId))!;
      expect(current.workMode.status).toBe("UNKNOWN");
      expect(current.compensation.status).toBe("UNKNOWN");
      expect(current.experienceRequirements.status).toBe("UNKNOWN");
      expect(current.organizationRelationships).toContainEqual(expect.objectContaining({ role: "EMPLOYER", employerClusterId: expect.any(String) }));
      expect(current.organizationRelationships.find((item) => item.role === "EMPLOYER")?.rawName).toBeUndefined();
    } finally { db.close(); }
  });
});
