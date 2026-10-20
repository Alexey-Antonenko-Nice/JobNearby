import { describe, expect, it } from "vitest";
import { BrowserCaptureAcquisitionAdapter } from "../../src/application/acquisition/BrowserCaptureAcquisitionAdapter.js";
import { ConservativeProviderVacancyIdExtractor } from "../../src/application/acquisition/ConservativeProviderVacancyIdExtractor.js";
import { ProviderCaptureRegistry } from "../../src/application/acquisition/ProviderCaptureRegistry.js";
import { DeterministicAcquisitionCaptureMapper } from "../../src/application/acquisition/DeterministicAcquisitionCaptureMapper.js";
import { createVacancyEvidenceExtractor } from "../../src/application/evidence/createVacancyEvidenceExtractor.js";
import { PersonioVacancyEvidenceExtractor } from "../../src/application/evidence/PersonioVacancyEvidenceExtractor.js";
import { createDatabase } from "../../src/infrastructure/database/createDatabase.js";
import { createCaptureProcessingRuntime } from "../../src/infrastructure/runtime/createCaptureProcessingRuntime.js";
import { createVacancyReviewWorkflow } from "../../src/application/user/createVacancyReviewWorkflow.js";
import { SqliteCanonicalVacancyRepository } from "../../src/infrastructure/persistence/SqliteCanonicalVacancyRepository.js";
import { SqliteSourceObservationRepository } from "../../src/infrastructure/persistence/SqliteSourceObservationRepository.js";
import { SqliteEmployerClusterRepository } from "../../src/infrastructure/persistence/SqliteEmployerClusterRepository.js";
import { SqliteObservationClusterAssignmentRepository } from "../../src/infrastructure/persistence/SqliteObservationClusterAssignmentRepository.js";
import { SqliteEmployerMemoryPublicDataSource } from "../../src/infrastructure/persistence/SqliteEmployerMemoryPublicDataSource.js";
import { SqliteUserVacancyInteractionRepository } from "../../src/infrastructure/persistence/SqliteUserVacancyInteractionRepository.js";

const sourceName = "vectacore.jobs.personio.de";
const url = `https://${sourceName}/job/2441986?language=en`;
const title = "UAS Pilot – Flight Operations (All Genders)";
// Minimized from the captured Personio header; omit SVGs, styles, and tracking.
function html(salary = "55,356 € per year", workTime = "Full-time") {
  return `<script type="application/ld+json">${JSON.stringify({
    "@type": "JobPosting", title, hiringOrganization: { "@type": "Organization", name: "VectaCore GmbH" },
    jobLocation: { "@type": "Place", address: { addressLocality: "Wels", addressRegion: "Oberösterreich", addressCountry: "AT" } },
    employmentType: ["FULL_TIME"],
  })}</script>
  <div class="page_jobHeader__b_ebM job-header">
    <h1 class="page_jobTitle__ydmA2 detail-title job-position-title">${title}</h1>
    <div class="detail-subtitle"><div class="JobAttributes_jobAttributes__mJS3k jb-attribute">
      <div class="JobAttributes_jobMetaItem__UZjYL"><span class="JobAttributes_jobMetaText__klBli"><span class="TruncatedLocations_locationText__QIi7j">Wels | DC1</span></span></div>
      <div class="JobAttributes_jobMetaItem__UZjYL"><span class="JobAttributes_jobMetaText__klBli">${workTime}</span></div>
      <div class="JobAttributes_jobMetaItem__UZjYL"><span class="JobAttributes_jobMetaText__klBli">Permanent employee</span></div>
      <div class="JobAttributes_jobMetaItem__UZjYL JobAttributes_jobMetaItemSalary__BRuw_"><span class="JobAttributes_jobMetaText__klBli">${salary}</span></div>
    </div></div>
  </div><div class="page_jobDescription__1wA05 detail-content">What you can expect: Flight operations.</div>`;
}
function payload(pageUrl = url, markup = html(), visibleText = `${title}\nWels | DC1\nFull-time\nPermanent employee\n55,356 € per year`) {
  return { pageUrl, pageTitle: title, visibleText, html: markup, capturedAt: "2026-10-20T10:00:00Z" };
}
function observation(pageUrl = url, markup = html()) {
  return new DeterministicAcquisitionCaptureMapper().toSourceObservation(new BrowserCaptureAcquisitionAdapter().toAcquisitionPackage(payload(pageUrl, markup), "acquisition"), "observation");
}

describe("Personio acquisition", () => {
  it.each(["", "?language=en", "?language=de", "/?language=en&utm_source=test"])("extracts path ID independently of %s", (suffix) => {
    const pageUrl = `https://${sourceName}/job/2441986${suffix}`;
    expect(new ConservativeProviderVacancyIdExtractor().extract({ sourceName, sourceUrl: pageUrl })).toBe("2441986");
    expect(new ProviderCaptureRegistry().capture({ sourceName, sourceUrl: pageUrl }).providerKey).toBe("PERSONIO");
    expect(observation(pageUrl).source.externalId).toBe("2441986");
  });

  it("supports other tenants and distinct IDs, including two-letter tenant names", () => {
    expect(observation(url.replace("2441986", "2441987")).source.externalId).toBe("2441987");
    for (const tenant of ["example-company", "de"]) {
      expect(observation(`https://${tenant}.jobs.personio.de/job/2441986`).source).toMatchObject({ sourceName: `${tenant}.jobs.personio.de`, externalId: "2441986" });
    }
  });

  it.each([
    `https://${sourceName}/`, `https://${sourceName}/job/not-numeric`,
    `https://${sourceName}/job/2441986/apply`, "https://jobs.personio.de/job/2441986",
    "https://vectacore.jobs.personio.de.evil.example/job/2441986", "https://example.com/job/2441986",
  ])("rejects unrelated routes or hosts: %s", (pageUrl) => {
    expect(observation(pageUrl).source.externalId).toBeUndefined();
  });

  it("rejects a mismatched tenant source hint", () => {
    expect(new ConservativeProviderVacancyIdExtractor().extract({ sourceName: "other.jobs.personio.de", sourceUrl: url })).toBeUndefined();
  });

  it.each(["55,356 € per year", "55.356 € per year", "55 356 € per year", "€55,356 per year", "55&nbsp;356 € per year"])("normalizes the bounded salary %s", async (salary) => {
    const evidence = await new PersonioVacancyEvidenceExtractor().extract(observation(url, html(salary)));
    expect(evidence.compensations).toEqual([expect.objectContaining({ rawText: salary.replace("&nbsp;", " "), currency: "EUR", minimum: 55356, maximum: 55356, period: "YEAR" })]);
  });

  it.each(["55,35,6 € per year", "55.356,000 € per year", "55,356 USD per year", "55,356 € per month", "from 55,356 € per year"])("declines ambiguous or unsupported salary %s", async (salary) => {
    expect((await new PersonioVacancyEvidenceExtractor().extract(observation(url, html(salary)))).compensations).toEqual([]);
  });

  it("uses existing FULL_TIME and INDEFINITE engagement terms while retaining structured geography", async () => {
    const captured = observation();
    const evidence = await createVacancyEvidenceExtractor().extract(captured);
    expect(evidence.engagements).toContainEqual(expect.objectContaining({ rawTerms: ["Full-time", "Permanent employee"], normalizedTerms: ["FULL_TIME", "INDEFINITE"] }));
    expect(captured.locationText).toBe("Wels, Oberösterreich, AT");
    expect(evidence.locations.some((location) => location.value.includes("DC1"))).toBe(false);
  });

  it("does not infer an employer from the tenant or read body salary/engagement as header evidence", async () => {
    const markup = `<div class="job-header"><h1 class="job-position-title">Pilot</h1></div><div class="detail-content"><span class="JobAttributes_jobMetaText__hash">Full-time</span><span class="JobAttributes_jobMetaText__hash">55,356 € per year</span></div>`;
    const captured = observation(url, markup);
    expect(captured.displayedCompanyName).toBeUndefined();
    const evidence = await new PersonioVacancyEvidenceExtractor().extract(captured);
    expect(evidence.engagements).toEqual([]);
    expect(evidence.compensations).toEqual([]);
    expect(evidence.organizations).toEqual([]);
  });

  it("leaves generic pages unchanged even with matching header classes", async () => {
    const captured = observation("https://employer.example/job/2441986");
    expect(captured.source.externalId).toBeUndefined();
    const evidence = await new PersonioVacancyEvidenceExtractor().extract(captured);
    expect(evidence.engagements).toEqual([]);
    expect(evidence.compensations).toEqual([]);
  });

  it("reuses identical snapshots, attaches changed and translated snapshots, and preserves confirmed employer memory", async () => {
    const db = createDatabase(":memory:");
    try {
      const runtime = createCaptureProcessingRuntime(db);
      const deps = {
        canonicalVacancyRepository: new SqliteCanonicalVacancyRepository(db), sourceObservationRepository: new SqliteSourceObservationRepository(db),
        employerClusterRepository: new SqliteEmployerClusterRepository(db), employerClusterWriter: new SqliteEmployerClusterRepository(db),
        assignmentRepository: new SqliteObservationClusterAssignmentRepository(db), employerMemoryPublicDataSource: new SqliteEmployerMemoryPublicDataSource(db),
        interactionRepository: new SqliteUserVacancyInteractionRepository(db),
      };
      const workflow = createVacancyReviewWorkflow(deps);
      // A different prior vacancy receives the only human confirmation.
      const prior = await runtime.captureAndProcessBrowserVacancy(payload(url.replace("2441986", "2441000")));
      if (prior.processing.status !== "PROCESSED") throw new Error("Prior processing failed");
      await workflow.confirmVacancyEmployer({ canonicalVacancyId: prior.processing.canonicalVacancyId, candidateName: "VectaCore GmbH" });
      const confirmed = (await deps.assignmentRepository.findEffectiveByObservationId(prior.capture.observationId))!;
      const first = await runtime.captureAndProcessBrowserVacancy(payload());
      if (first.processing.status !== "PROCESSED") throw new Error("Capture processing failed");
      const canonicalId = first.processing.canonicalVacancyId;
      const sourceBefore = await deps.sourceObservationRepository.findById(first.capture.observationId);
      expect(sourceBefore?.source.externalId).toBe("2441986");
      expect((await workflow.getVacancyReview(canonicalId)).vacancyContext.seenBefore).toBe(false);
      const second = await runtime.captureAndProcessBrowserVacancy({ ...payload(url.split("?")[0]!), capturedAt: "2026-10-20T11:00:00Z" });
      expect(second.capture.observationId).toBe(first.capture.observationId);
      expect(second.processing).toMatchObject({ status: "PROCESSED", canonicalVacancyId: canonicalId, observationAdded: false });
      expect(db.prepare("SELECT COUNT(*) AS count FROM capture_occurrences WHERE source_observation_id = ?").get(first.capture.observationId)).toEqual({ count: 2 });
      expect((await workflow.getVacancyReview(canonicalId)).vacancyContext).toMatchObject({ seenBefore: true, observationCount: 1 });
      const changed = await runtime.captureAndProcessBrowserVacancy({ ...payload(url, html(), `${title}\nChanged description`), capturedAt: "2026-10-20T12:00:00Z" });
      expect(changed.capture.observationId).not.toBe(first.capture.observationId);
      expect(changed.processing).toMatchObject({ status: "PROCESSED", canonicalVacancyId: canonicalId, observationAdded: true });
      const translated = await runtime.captureAndProcessBrowserVacancy({ ...payload(url.replace("language=en", "language=de"), html(), "Deutsche Beschreibung"), capturedAt: "2026-10-20T13:00:00Z" });
      expect(translated.capture.observationId).not.toBe(first.capture.observationId);
      expect(translated.processing).toMatchObject({ status: "PROCESSED", canonicalVacancyId: canonicalId, observationAdded: true });
      expect(await deps.sourceObservationRepository.findById(first.capture.observationId)).toEqual(sourceBefore);
      const canonical = (await deps.canonicalVacancyRepository.findById(canonicalId))!;
      expect(canonical.sourceObservationIds).toHaveLength(3);
      expect(canonical.engagement).toMatchObject({ status: "RESOLVED", value: { normalizedTerms: expect.arrayContaining(["FULL_TIME", "INDEFINITE"]) } });
      expect(canonical.compensation).toMatchObject({ status: "RESOLVED", value: { rawText: "55,356 € per year", currency: "EUR", minimum: 55356, maximum: 55356, period: "YEAR" } });
      expect(canonical.location).toMatchObject({ status: "RESOLVED", value: { rawText: "Wels, Oberösterreich, AT" } });
      expect(await deps.assignmentRepository.findEffectiveByObservationId(first.capture.observationId)).toMatchObject({ employerClusterId: confirmed.employerClusterId, status: "ACCEPTED", algorithm: "confirmed-employer-memory" });
      expect(await deps.assignmentRepository.findByObservationId(first.capture.observationId)).toHaveLength(1);
      const review = await workflow.getVacancyReview(canonicalId);
      expect(review.vacancyContext.seenBefore).toBe(true);
      expect(review.employer.confirmationCandidate).toBeNull();
      expect(review.employer.employerClusterId).toBe(confirmed.employerClusterId);
      expect(db.prepare("SELECT COUNT(*) AS count FROM canonical_vacancies").get()).toEqual({ count: 2 });
    } finally { db.close(); }
  });

  it("keeps identical job numbers on different tenants in separate canonical vacancies", async () => {
    const db = createDatabase(":memory:");
    try {
      const runtime = createCaptureProcessingRuntime(db);
      const first = await runtime.captureAndProcessBrowserVacancy(payload());
      const other = await runtime.captureAndProcessBrowserVacancy(payload(url.replace("vectacore", "another-company")));
      if (first.processing.status !== "PROCESSED" || other.processing.status !== "PROCESSED") throw new Error("Processing failed");
      expect(first.processing.canonicalVacancyId).not.toBe(other.processing.canonicalVacancyId);
      expect(first.capture.observationId).not.toBe(other.capture.observationId);
    } finally { db.close(); }
  });
});
