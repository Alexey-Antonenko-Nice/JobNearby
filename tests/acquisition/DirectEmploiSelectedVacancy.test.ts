import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { BrowserCaptureAcquisitionAdapter } from "../../src/application/acquisition/BrowserCaptureAcquisitionAdapter.js";
import { DeterministicAcquisitionCaptureMapper } from "../../src/application/acquisition/DeterministicAcquisitionCaptureMapper.js";
import { DirectEmploiSelectedVacancyContextLocator, directEmploiIdentity, directEmploiPostingId } from "../../src/application/acquisition/DirectEmploiVacancy.js";
import { createVacancyEvidenceExtractor } from "../../src/application/evidence/createVacancyEvidenceExtractor.js";
import { ExistingPipelineCanonicalVacancyAdapter } from "../../src/application/vacancies/ExistingPipelineCanonicalVacancyAdapter.js";
import { DeterministicCanonicalVacancyCanonicalizer } from "../../src/application/vacancies/DeterministicCanonicalVacancyCanonicalizer.js";
import { createDatabase } from "../../src/infrastructure/database/createDatabase.js";
import { createCaptureProcessingRuntime } from "../../src/infrastructure/runtime/createCaptureProcessingRuntime.js";
import { SqliteCanonicalVacancyRepository } from "../../src/infrastructure/persistence/SqliteCanonicalVacancyRepository.js";
import { SqliteSourceObservationRepository } from "../../src/infrastructure/persistence/SqliteSourceObservationRepository.js";

const postingId = "56666163";
const displayedReference = "31223894";
const url = `https://www.directemploi.com/candidatOffre/${postingId}?utm_source=chatgpt.com`;
const fixture = readFileSync("tests/fixtures/directEmploiSelectedVacancy.html", "utf8");
const extractor = createVacancyEvidenceExtractor();
const payload = { pageUrl: url, pageTitle: "Direct Emploi", html: fixture, visibleText: "Assembleur charpente métallique H/F", capturedAt: "2026-10-23T21:38:20Z" };

function capture(html = fixture, pageUrl = url) {
  const acquisition = new BrowserCaptureAcquisitionAdapter().toAcquisitionPackage({ ...payload, html, pageUrl }, "acquisition");
  return { acquisition, observation: new DeterministicAcquisitionCaptureMapper().toSourceObservation(acquisition, "observation") };
}
async function project(html = fixture) {
  const { acquisition, observation } = capture(html);
  const evidence = await extractor.extract(observation);
  const canonical = new ExistingPipelineCanonicalVacancyAdapter(new DeterministicCanonicalVacancyCanonicalizer()).canonicalize({
    canonicalVacancyId: "canonical", observations: [observation], extractedEvidence: [evidence], derivation: { algorithm: "test", algorithmVersion: "1", derivedAt: new Date("2026-10-23") },
  });
  return { acquisition, observation, evidence, canonical };
}
const locate = (html: string, pageUrl = url) => new DirectEmploiSelectedVacancyContextLocator().locate({ providerKey: "DIRECT_EMPLOI", sourceUrl: pageUrl, html });
const edit = (from: string | RegExp, to: string) => { const html = fixture.replace(from, to); expect(html).not.toBe(fixture); return html; };
const count = (db: ReturnType<typeof createDatabase>, table: string) => (db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count;

describe("Direct Emploi identity", () => {
  it("reads the posting ID from the offer route and ignores tracking parameters", () => {
    expect(directEmploiPostingId(url)).toBe(postingId);
    expect(directEmploiPostingId(`https://www.directemploi.com/candidatOffre/${postingId}/`)).toBe(postingId);
    expect(directEmploiPostingId(`https://www.directemploi.com/entreprise/${postingId}`)).toBeUndefined();
    expect(directEmploiPostingId(`https://example.com/candidatOffre/${postingId}`)).toBeUndefined();
  });
  it("keeps the displayed reference as a separate identifier that need not match the posting ID", async () => {
    expect(directEmploiIdentity({ sourceUrl: url, html: fixture, externalId: postingId })).toEqual({ status: "VALID", id: postingId, reference: displayedReference });
    const { acquisition, observation, evidence } = await project();
    expect(acquisition.externalId).toBe(postingId);
    expect(observation.source.externalId).toBe(postingId);
    const identifiers = new Map(evidence.externalIdentifiers.filter(item => item.identifierType.startsWith("DIRECT_EMPLOI_")).map(item => [item.identifierType, item.value]));
    expect(identifiers.get("DIRECT_EMPLOI_POSTING_ID")).toBe(postingId);
    expect(identifiers.get("DIRECT_EMPLOI_REFERENCE")).toBe(displayedReference);
    expect(identifiers.size).toBe(2);
    expect(evidence.externalIdentifiers.filter(item => item.value === displayedReference).map(item => item.identifierType)).toEqual(["DIRECT_EMPLOI_REFERENCE"]);
  });
  it.each([
    ["the JSON-LD URL", () => edit('"url":"https://www.directemploi.com/candidatOffre/56666163"', '"url":"https://www.directemploi.com/candidatOffre/56666164"')],
    ["the copy-link URL", () => edit('data-url="https://www.directemploi.com/candidatOffre/56666163"', 'data-url="https://www.directemploi.com/candidatOffre/56666164"')],
    ["the hidden application form ID", () => edit('value="56666163"><input type="email"', 'value="56666164"><input type="email"')],
    ["the canonical link", () => edit('<link rel="canonical" href="https://www.directemploi.com/candidatOffre/56666163">', '<link rel="canonical" href="https://www.directemploi.com/candidatOffre/56666164">')],
  ])("detects a posting ID conflict in %s and publishes no identity", async (_name, build) => {
    const html = build();
    expect(directEmploiIdentity({ sourceUrl: url, html, externalId: postingId })).toMatchObject({ status: "CONFLICT", identifiers: expect.arrayContaining([postingId, "56666164"]) });
    expect(locate(html)).toBeUndefined();
    const { acquisition } = capture(html);
    expect(acquisition.externalId).toBeUndefined();
    expect(acquisition.contexts ?? []).toEqual([]);
  });
  it("detects two disagreeing displayed references without comparing them to the posting ID", () => {
    const html = edit('"value":"31223894"', '"value":"99999999"');
    expect(directEmploiIdentity({ sourceUrl: url, html, externalId: postingId }).status).toBe("CONFLICT");
    expect(directEmploiIdentity({ sourceUrl: url, html: fixture.replaceAll(displayedReference, "70000001"), externalId: postingId })).toMatchObject({ status: "VALID", reference: "70000001" });
  });
});

describe("Direct Emploi selected vacancy boundary", () => {
  it("keeps the heading, header facts and sections and drops breadcrumb, share, form, modal and similar offers", () => {
    const context = capture().acquisition.contexts?.[0];
    expect(capture().acquisition.contexts).toHaveLength(1);
    for (const value of [context?.html ?? "", context?.text ?? ""]) {
      expect(value).toContain("Assembleur charpente métallique H/F");
      expect(value).toContain("Description de l'offre");
      expect(value).toContain("Profil recherché");
      expect(value).not.toMatch(/Accueil|Offres similaires|Chaudronnier|Soudeur|56807735|56816442|Postuler maintenant|Partager|formulaire|alerteOffreModal|Espace recruteur|<form|<nav|<button/u);
    }
  });
  it("resolves the title from the heading only; the breadcrumb is not role evidence", async () => {
    const { evidence, canonical } = await project();
    expect(evidence.vacancyTitles.map(item => item.value)).toEqual(["Assembleur charpente métallique H/F"]);
    expect(JSON.stringify(evidence)).not.toContain("Accueil >");
    expect(canonical.role).toMatchObject({ status: "RESOLVED", value: { title: "Assembleur charpente métallique H/F" } });
    for (const item of [...evidence.vacancyTitles, ...evidence.locations, ...evidence.engagements, ...evidence.organizations]) expect(item.provenance.contentOrigin).toBe("SELECTED_VACANCY_CONTEXT");
  });
  it("normalizes the displayed location without the region link markup", async () => {
    const { evidence } = await project();
    expect(evidence.locations).toEqual([expect.objectContaining({ value: "Strasbourg, Grand-Est", role: "WORKPLACE" })]);
  });
  it.each([
    ["a second heading", () => edit("</main>", "<h1>Autre offre</h1></main>")],
    ["a missing details block", () => edit(/job-details/gu, "job-detail")],
    ["a duplicate header", () => edit('<div class="job-content-wrapper">', '<div class="job-header"><span>Autre</span></div><div class="job-content-wrapper">')],
    ["a JSON-LD posting for another title", () => edit('"title":"Assembleur charpente métallique H/F"', '"title":"Soudeur H/F"')],
    ["a missing description section", () => edit("Description de l'offre", "Informations")],
  ])("fails closed on an uncertain boundary (%s) rather than using page content", async (_name, build) => {
    const html = build();
    expect(locate(html)).toBeUndefined();
    const { acquisition, evidence } = await project(html);
    expect(acquisition.contexts ?? []).toEqual([]);
    expect(evidence.vacancyTitles).toEqual([]);
    expect(evidence.organizations).toEqual([]);
    expect(evidence.engagements).toEqual([]);
  });
});

describe("Direct Emploi contract and intermediary evidence", () => {
  it("keeps INTERIM and TEMPORARY as one compatible engagement with the original terms", async () => {
    const { evidence, canonical } = await project();
    expect(evidence.engagements).toEqual([expect.objectContaining({ rawTerms: ["Interim", "TEMPORARY"], normalizedTerms: ["INTERIM", "TEMPORARY"] })]);
    expect(canonical.engagement.status).toBe("RESOLVED");
    expect(canonical.engagement.value).toMatchObject({ rawTerms: ["Interim", "TEMPORARY"], normalizedTerms: ["INTERIM", "TEMPORARY"] });
  });
  it("does not treat TEMPORARY alone as agency work", async () => {
    const html = edit(/<span class="job-badge"><i class="bi bi-file-earmark-text"><\/i> Interim <\/span>/u, "").replaceAll("recherche pour son client", "recherche un monteur").replaceAll("agence Sup Interim", "équipe Sup Interim");
    const { evidence } = await project(html);
    expect(evidence.engagements).toEqual([expect.objectContaining({ rawTerms: ["TEMPORARY"], normalizedTerms: ["TEMPORARY"] })]);
    expect(evidence.organizations.map(item => item.role)).toEqual(["DISPLAYED_COMPANY"]);
  });
  it("keeps Sup Interim as an intermediary with no employer, no inferred client and no name merge", async () => {
    const { evidence, canonical } = await project();
    expect(evidence.organizations.map(item => [item.value, item.role])).toEqual([["sup interim", "DISPLAYED_COMPANY"], ["sup interim", "STAFFING_AGENCY"]]);
    const relationships = canonical.organizationRelationships;
    expect(relationships.some(item => item.role === "EMPLOYER" || item.role === "CLIENT")).toBe(false);
    expect(JSON.stringify(relationships)).not.toMatch(/montage levage|charpente métallique"/u);
    // The description's agency wording stays its own name variant rather than being unified with the displayed name.
    expect(relationships.filter(item => item.rawName === "sup interim").every(item => item.role !== "EMPLOYER")).toBe(true);
  });
});

describe("Direct Emploi recapture and continuity", () => {
  it("reuses the observation for an identical recapture and resolves no employer from the intermediary", async () => {
    const db = createDatabase(":memory:");
    try {
      const runtime = createCaptureProcessingRuntime(db);
      const repository = new SqliteSourceObservationRepository(db);
      const first = await runtime.captureAndProcessBrowserVacancy(payload);
      if (first.processing.status !== "PROCESSED") throw Error("Processing failed");
      expect((await repository.findById(first.capture.observationId))?.source.externalId).toBe(postingId);
      const again = await runtime.captureAndProcessBrowserVacancy({ ...payload, capturedAt: "2026-10-23T21:40:00Z" });
      expect(again.capture.observationId).toBe(first.capture.observationId);
      expect(again.processing).toMatchObject({ canonicalVacancyId: first.processing.canonicalVacancyId, observationAdded: false });
      expect(await repository.countCaptureOccurrences([first.capture.observationId])).toBe(2);
      expect(count(db, "source_observations")).toBe(1);
      expect(count(db, "canonical_vacancies")).toBe(1);
      expect(db.prepare("SELECT status, resolved_employer_id FROM employer_clusters").all()).toEqual([{ status: "UNRESOLVED", resolved_employer_id: null }]);
    } finally { db.close(); }
  });

  // A capture made before the posting ID was recognized has no external ID and no exact identity claim.
  async function legacyState(db: ReturnType<typeof createDatabase>) {
    const runtime = createCaptureProcessingRuntime(db);
    const first = await runtime.captureAndProcessBrowserVacancy(payload);
    if (first.processing.status !== "PROCESSED") throw Error("Processing failed");
    db.prepare("DELETE FROM canonical_vacancy_exact_identity_claims").run();
    db.prepare("UPDATE source_observations SET external_id = NULL").run();
    return { runtime, legacyId: first.capture.observationId, canonicalId: first.processing.canonicalVacancyId };
  }
  it("replays a legacy observation in memory with the bounded evidence", async () => {
    const db = createDatabase(":memory:");
    try {
      const { legacyId } = await legacyState(db);
      const legacy = await new SqliteSourceObservationRepository(db).findById(legacyId);
      expect(legacy?.source.externalId).toBeUndefined();
      const evidence = await extractor.extract(legacy!);
      expect(evidence.vacancyTitles.map(item => item.value)).toEqual(["Assembleur charpente métallique H/F"]);
      expect(evidence.engagements).toHaveLength(1);
    } finally { db.close(); }
  });
  it("attaches the identified recapture to the existing canonical vacancy and preserves its decisions", async () => {
    const db = createDatabase(":memory:");
    try {
      const { runtime, legacyId, canonicalId } = await legacyState(db);
      const canonicals = new SqliteCanonicalVacancyRepository(db);
      const recaptured = await runtime.captureAndProcessBrowserVacancy({ ...payload, capturedAt: "2026-10-24T08:00:00Z" });
      if (recaptured.processing.status !== "PROCESSED") throw Error("Processing failed");
      expect(recaptured.capture.observationId).not.toBe(legacyId);
      expect(recaptured.processing).toMatchObject({ canonicalVacancyId: canonicalId, observationAdded: true });
      expect(count(db, "canonical_vacancies")).toBe(1);
      expect((await canonicals.findByExactSourceIdentity("directemploi.com", postingId))?.id).toBe(canonicalId);
      const again = await runtime.captureAndProcessBrowserVacancy({ ...payload, capturedAt: "2026-10-24T09:00:00Z" });
      expect(again.capture.observationId).toBe(recaptured.capture.observationId);
      expect(count(db, "canonical_vacancies")).toBe(1);
    } finally { db.close(); }
  });
  it("does not merge when the earlier capture cannot be re-validated as the same vacancy", async () => {
    const db = createDatabase(":memory:");
    try {
      const { runtime, canonicalId, legacyId } = await legacyState(db);
      const stored = JSON.parse((db.prepare("SELECT metadata_json FROM source_observations WHERE id = ?").get(legacyId) as { metadata_json: string }).metadata_json);
      stored.acquisition.html = stored.acquisition.html.replace('value="56666163"><input type="email"', 'value="56666164"><input type="email"');
      db.prepare("UPDATE source_observations SET metadata_json = ? WHERE id = ?").run(JSON.stringify(stored), legacyId);
      const recaptured = await runtime.captureAndProcessBrowserVacancy({ ...payload, capturedAt: "2026-10-24T08:00:00Z" });
      if (recaptured.processing.status !== "PROCESSED") throw Error("Processing failed");
      expect(recaptured.processing.canonicalVacancyId).not.toBe(canonicalId);
      expect(count(db, "canonical_vacancies")).toBe(2);
    } finally { db.close(); }
  });
  it("does not merge when the earlier capture carries a different displayed reference", async () => {
    const db = createDatabase(":memory:");
    try {
      const { runtime, canonicalId } = await legacyState(db);
      const recaptured = await runtime.captureAndProcessBrowserVacancy({ ...payload, html: fixture.replaceAll(displayedReference, "70000001"), capturedAt: "2026-10-24T08:00:00Z" });
      if (recaptured.processing.status !== "PROCESSED") throw Error("Processing failed");
      expect(recaptured.processing.canonicalVacancyId).not.toBe(canonicalId);
    } finally { db.close(); }
  });
});

describe("Other providers are unchanged", () => {
  it("does not recognize look-alike hosts as Direct Emploi", () => {
    const { acquisition } = capture(fixture, `https://www.directemploi.example.com/candidatOffre/${postingId}`);
    expect(acquisition.externalId).toBeUndefined();
    expect(acquisition.contexts ?? []).toEqual([]);
  });
});
