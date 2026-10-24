import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import Database from "better-sqlite3";
import { BrowserCaptureAcquisitionAdapter } from "../../src/application/acquisition/BrowserCaptureAcquisitionAdapter.js";
import { DeterministicAcquisitionCaptureMapper } from "../../src/application/acquisition/DeterministicAcquisitionCaptureMapper.js";
import { evidenceExtractionInputFor } from "../../src/application/vacancies/processVacancyObservation.js";
import { LinkedInSelectedVacancyEvidenceExtractor } from "../../src/application/evidence/LinkedInSelectedVacancyEvidenceExtractor.js";
import { fromSelectedVacancyContext } from "../../src/domain/evidence/VacancyEvidenceInput.js";
import { createVacancyEvidenceExtractor } from "../../src/application/evidence/createVacancyEvidenceExtractor.js";
import { ExistingPipelineCanonicalVacancyAdapter } from "../../src/application/vacancies/ExistingPipelineCanonicalVacancyAdapter.js";
import { DeterministicCanonicalVacancyCanonicalizer } from "../../src/application/vacancies/DeterministicCanonicalVacancyCanonicalizer.js";
import { createCaptureProcessingRuntime } from "../../src/infrastructure/runtime/createCaptureProcessingRuntime.js";
import { SqliteCanonicalVacancyRepository } from "../../src/infrastructure/persistence/SqliteCanonicalVacancyRepository.js";
import { SqliteSourceObservationRepository } from "../../src/infrastructure/persistence/SqliteSourceObservationRepository.js";

// Actual saved /jobs/search-results/ page (observation da522925-321d-46b6-bb0e-a595c090b7d5).
const html = readFileSync("tests/fixtures/linkedinSearchResultsWestinghouse.html", "utf8");
const visibleText = readFileSync("tests/fixtures/linkedinSearchResultsWestinghouse.visible.txt", "utf8");
const meta = JSON.parse(readFileSync("tests/fixtures/linkedinSearchResultsWestinghouse.meta.json", "utf8")) as { pageUrl: string; pageTitle: string };
const payload = { ...meta, html, visibleText, capturedAt: "2026-10-24T23:27:18.851Z" };

function capture(page = html, url = meta.pageUrl) {
  const acquisition = new BrowserCaptureAcquisitionAdapter().toAcquisitionPackage({ ...payload, html: page, pageUrl: url }, "acquisition");
  return { acquisition, observation: new DeterministicAcquisitionCaptureMapper().toSourceObservation(acquisition, "observation") };
}

const otherCards = `<div data-testid="job-card-contamination">
  <a href="https://www.linkedin.com/jobs/view/1111111111/">Senior Quality Manager</a><p>Lyon, Auvergne-Rhône-Alpes, France</p>
  <p>Acme Staffing</p><p>Sur site</p><p>Temps partiel</p><p>Premium : essayez gratuitement</p>
  <p>Vous correspondez à ce profil</p><p>412 candidats</p><p>Salaire 99 000 € par an</p></div>`;

describe("LinkedIn /jobs/search-results/ selected pane", () => {
  it("captures the validated selected pane and extracts its header facts", async () => {
    const { acquisition, observation } = capture();
    expect(acquisition.externalId).toBe("4446930208");
    const context = acquisition.contexts?.[0];
    expect(context?.providerKey).toBe("LINKEDIN");
    const evidence = await createVacancyEvidenceExtractor().extract(evidenceExtractionInputFor(observation));
    expect(evidence.vacancyTitles.map(v => v.value)).toEqual(["Supplier Manufacturing Engineer Lead"]);
    expect(evidence.locations.map(l => l.value)).toEqual(["Cracovie, Petite Pologne, Pologne"]);
    expect(evidence.organizations).toEqual([expect.objectContaining({ value: "Westinghouse Electric Company", role: "DISPLAYED_COMPANY" })]);
    expect(evidence.workModes.map(w => w.value)).toEqual(["REMOTE"]);
    expect(evidence.engagements[0]?.normalizedTerms).toEqual(["FULL_TIME"]);
    expect(evidence.travelRequirements[0]).toMatchObject({ percentage: 50 });
  });

  it("keeps the complete description and excludes cards, promotions and statistics from the context", () => {
    const text = capture().acquisition.contexts![0]!.text!;
    expect(text).toContain("Responsibilities");
    expect(text).toContain("up to 50% travel");
    expect(text).not.toMatch(/Premium|Plus de 99 résultats|Comment sont classées|correspond|Vous pourriez/iu);
  });

  it("does not infer worldwide eligibility or employer confirmation", async () => {
    const { observation } = capture();
    const evidence = await createVacancyEvidenceExtractor().extract(evidenceExtractionInputFor(observation));
    const canonical = new ExistingPipelineCanonicalVacancyAdapter(new DeterministicCanonicalVacancyCanonicalizer()).canonicalize({
      canonicalVacancyId: "canonical", observations: [observation], extractedEvidence: [evidence],
      derivation: { algorithm: "test", algorithmVersion: "1", derivedAt: new Date("2026-10-25") },
    });
    expect(canonical.workMode.value).toBe("REMOTE");
    expect(canonical.remoteEligibleCountries.value ?? []).toEqual([]);
    expect(canonical.remoteEligibleCountries.status).not.toBe("RESOLVED");
    expect(canonical.organizationRelationships.filter(r => r.role === "EMPLOYER" && r.rawName === "Westinghouse Electric Company")).toEqual([]);
    expect(evidence.organizations.some(o => o.role === "EMPLOYER")).toBe(false);
    expect(canonical.location.value?.rawText).toBe("Cracovie, Petite Pologne, Pologne");
  });

  it("ignores other-card contamination outside the selected pane", async () => {
    const clean = await createVacancyEvidenceExtractor().extract(evidenceExtractionInputFor(capture().observation));
    const polluted = capture(html.replace(/<body[^>]*>/iu, match => `${match}${otherCards}`));
    expect(polluted.acquisition.contexts?.[0]?.text).toEqual(capture().acquisition.contexts![0]!.text);
    const evidence = await createVacancyEvidenceExtractor().extract(evidenceExtractionInputFor(polluted.observation));
    expect(evidence).toEqual(clean);
    expect(JSON.stringify(evidence)).not.toMatch(/Quality Manager|Lyon|Acme|Temps partiel|99 000/u);
  });

  it("never takes facts from a competing card inside the pane", async () => {
    const column = /<div\b[^>]*data-testid="lazy-column"[^>]*>/u.exec(html)![0];
    const page = html.replace(column, `${column}${otherCards}`);
    const evidence = await createVacancyEvidenceExtractor().extract(evidenceExtractionInputFor(capture(page).observation));
    expect(JSON.stringify(evidence)).not.toMatch(/Quality Manager|Lyon|Acme|Temps partiel|99 000/u);
  });

  it("requires the title to be the unique link to the selected job", async () => {
    const { acquisition, observation } = capture();
    const context = acquisition.contexts![0]!;
    const extract = (contextHtml: string) => new LinkedInSelectedVacancyEvidenceExtractor().extract(
      fromSelectedVacancyContext(observation, { ...context, html: contextHtml }));
    const ambiguous = await extract(context.html!.replace(`<section data-linkedin-selected-vacancy-context="direct-view">`, `<section data-linkedin-selected-vacancy-context="direct-view"><a href="https://www.linkedin.com/jobs/view/4446930208/">Different Title</a>`));
    expect(ambiguous.vacancyTitles).toEqual([]);
    expect(ambiguous.locations).toEqual([]);
    const other = await extract(context.html!.replaceAll("/jobs/view/4446930208/", "/jobs/view/1111111111/"));
    expect(other.vacancyTitles).toEqual([]);
    expect(other.locations).toEqual([]);
  });
});

// Opt-in: reads the saved database once; everything runs on a private in-memory copy.
it.skipIf(!process.env.LINKEDIN_STORED_REPLAY || !existsSync("job-nearby.sqlite"))("replays the stored LinkedIn capture into the same canonical and preserves human state", async () => {
  const disk = new Database("job-nearby.sqlite", { readonly: true, fileMustExist: true });
  const db = new Database(disk.serialize()); disk.close();
  try {
    const observationId = "da522925-321d-46b6-bb0e-a595c090b7d5", canonicalId = "a2743543-0b68-49cd-8cc9-485d2e947fad";
    const observations = new SqliteSourceObservationRepository(db);
    const original = (await observations.findById(observationId))!;
    const stored = original.metadata.acquisition as { html: string; pageTitle: string };
    expect(stored.html).toBe(html);
    db.prepare(`INSERT INTO user_vacancy_interaction_events (id,canonical_vacancy_id,event_type,occurred_at,recorded_at,metadata_json)
      VALUES ('human-interest',?,'INTERESTED','2026-10-25T00:00:00Z','2026-10-25T00:00:00Z',NULL)`).run(canonicalId);
    const stateTables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND (name LIKE '%decision%' OR name LIKE '%interaction%' OR name = 'confirmed_organization_roles')").all() as { name: string }[];
    const state = () => stateTables.map(({ name }) => [name, db.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all()]);
    const before = state();
    const clusterBefore = db.prepare("SELECT a.id, a.status, a.algorithm, c.status AS cluster_status FROM observation_cluster_assignments a JOIN employer_clusters c ON c.id = a.employer_cluster_id WHERE source_observation_id = ?").all(observationId);
    const rowBefore = db.prepare("SELECT * FROM source_observations WHERE id = ?").get(observationId);
    const canonicalCount = db.prepare("SELECT COUNT(*) AS n FROM canonical_vacancies").get();
    const runtime = createCaptureProcessingRuntime(db);
    const first = await runtime.captureAndProcessBrowserVacancy({ ...payload, capturedAt: "2026-10-25T08:00:00Z" });
    expect(first.capture.observationId).toBe(observationId);
    expect(first.processing).toMatchObject({ status: "PROCESSED", canonicalVacancyId: canonicalId });
    const repaired = (await new SqliteCanonicalVacancyRepository(db).findById(canonicalId))!;
    expect(repaired.role.value?.title).toBe("Supplier Manufacturing Engineer Lead");
    expect(repaired.location.value?.rawText).toBe("Cracovie, Petite Pologne, Pologne");
    expect(repaired.workMode.value).toBe("REMOTE");
    expect(repaired.remoteEligibleCountries.status).not.toBe("RESOLVED");
    expect(repaired.engagement.value?.normalizedTerms).toEqual(["FULL_TIME"]);
    expect(repaired.travel.value).toMatchObject({ percentage: 50 });
    expect(db.prepare("SELECT COUNT(*) AS n FROM canonical_vacancies").get()).toEqual(canonicalCount);
    expect(db.prepare("SELECT * FROM source_observations WHERE id = ?").get(observationId)).toEqual(rowBefore);
    expect(db.prepare("SELECT a.id, a.status, a.algorithm, c.status AS cluster_status FROM observation_cluster_assignments a JOIN employer_clusters c ON c.id = a.employer_cluster_id WHERE source_observation_id = ?").all(observationId)).toEqual(clusterBefore);
    expect(state()).toEqual(before);
    const again = await runtime.captureAndProcessBrowserVacancy({ ...payload, capturedAt: "2026-10-25T08:01:00Z" });
    expect(again.capture.observationId).toBe(observationId);
    expect(again.processing).toMatchObject({ canonicalVacancyId: canonicalId, observationAdded: false });
    expect(state()).toEqual(before);
  } finally { db.close(); }
});
