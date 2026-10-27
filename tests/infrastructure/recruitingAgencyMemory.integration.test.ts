import { versionEightDatabase } from "./legacyDatabaseFixture.js";
import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import { createDatabase } from "../../src/infrastructure/database/createDatabase.js";
import { migrateDatabase } from "../../src/infrastructure/database/migrateDatabase.js";
import { createVacancyReviewWorkflow } from "../../src/application/user/createVacancyReviewWorkflow.js";
import { getRecruitingAgencyProjection } from "../../src/application/user/recruitingAgencyReview.js";
import { processObservation } from "../../src/application/recognition/processObservation.js";
import { DeterministicCanonicalVacancyCanonicalizer } from "../../src/application/vacancies/DeterministicCanonicalVacancyCanonicalizer.js";
import { SqliteCanonicalVacancyRepository } from "../../src/infrastructure/persistence/SqliteCanonicalVacancyRepository.js";
import { SqliteSourceObservationRepository } from "../../src/infrastructure/persistence/SqliteSourceObservationRepository.js";
import { SqliteEmployerClusterRepository } from "../../src/infrastructure/persistence/SqliteEmployerClusterRepository.js";
import { SqliteObservationClusterAssignmentRepository } from "../../src/infrastructure/persistence/SqliteObservationClusterAssignmentRepository.js";
import { SqliteEmployerRecognitionPersistence } from "../../src/infrastructure/persistence/SqliteEmployerRecognitionPersistence.js";
import { SqliteEmployerMemoryPublicDataSource } from "../../src/infrastructure/persistence/SqliteEmployerMemoryPublicDataSource.js";
import { SqliteUserVacancyInteractionRepository } from "../../src/infrastructure/persistence/SqliteUserVacancyInteractionRepository.js";
import { SqliteConfirmedOrganizationRoleRepository } from "../../src/infrastructure/persistence/SqliteConfirmedOrganizationRoleRepository.js";
import { createBrowserCaptureServer } from "../../src/infrastructure/http/createBrowserCaptureServer.js";
import type { VacancyOrganizationRole } from "../../src/domain/vacancies/CanonicalVacancy.js";
import { createCaptureProcessingRuntime } from "../../src/infrastructure/runtime/createCaptureProcessingRuntime.js";
import { AgencyMemoryVacancyEvidenceExtractor } from "../../src/application/evidence/AgencyMemoryVacancyEvidenceExtractor.js";
import { createExtractedVacancyEvidence } from "../../src/domain/evidence/ExtractedVacancyEvidence.js";

const date = new Date("2026-10-22T08:00:00Z");
function fixture(db = createDatabase(":memory:")) {
  const clusters = new SqliteEmployerClusterRepository(db);
  const assignments = new SqliteObservationClusterAssignmentRepository(db);
  const deps = {
    canonicalVacancyRepository: new SqliteCanonicalVacancyRepository(db), sourceObservationRepository: new SqliteSourceObservationRepository(db),
    interactionRepository: new SqliteUserVacancyInteractionRepository(db), employerClusterRepository: clusters, employerClusterWriter: clusters,
    assignmentRepository: assignments, employerMemoryPublicDataSource: new SqliteEmployerMemoryPublicDataSource(db),
    recognitionPersistence: new SqliteEmployerRecognitionPersistence(db), agencyMemoryRepository: new SqliteConfirmedOrganizationRoleRepository(db), now: () => date,
  };
  const workflow = createVacancyReviewWorkflow(deps);
  const snapshot = (includeMemory = true) => JSON.stringify((db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as { name: string }[])
    .filter(({ name }) => includeMemory || name !== "confirmed_organization_roles").map(({ name }) => [name, db.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all()]));
  async function add(id: string, name = "Crit", role: VacancyOrganizationRole | null = "STAFFING_AGENCY", options: { organizationId?: string; client?: string } = {}) {
    const observation = { id, source: { sourceType: "JOB_BOARD" as const, sourceName: "test" }, displayedCompanyName: name, observedAt: date, metadata: {} };
    await deps.sourceObservationRepository.save(observation);
    const recognition = await processObservation(observation, { clusterRepository: clusters, assignmentRepository: assignments,
      recognitionPersistence: deps.recognitionPersistence, policy: { automaticAssignmentThreshold: 0.9, reviewThreshold: 0.65 },
      algorithm: "test", algorithmVersion: "1", matcher: { findBestMatch: async () => null } });
    if (recognition.outcome === "REVIEW_REQUIRED") throw Error("Unexpected review");
    const derivation = { algorithm: "test", algorithmVersion: "1", derivedAt: date };
    const named = { rawName: name, ...(options.organizationId ? { organizationId: options.organizationId } : {}), supportingEvidenceIds: [`org-${id}`], confidence: 1, derivation };
    const vacancy = new DeterministicCanonicalVacancyCanonicalizer().canonicalize({ id, sourceObservationIds: [id],
      evidenceReferences: [{ id: `org-${id}`, sourceObservationId: id, kind: "ORGANIZATION_EVIDENCE" }],
      organizationRelationships: [{ ...named, role: "DISPLAYED_COMPANY" }, ...(role ? [{ ...named, role }] : []),
        ...(options.client ? [{ ...named, rawName: options.client, role: "CLIENT" as const }] : []),
        { role: "EMPLOYER", employerClusterId: recognition.employerCluster.id, supportingEvidenceIds: [`org-${id}`], derivation }], derivation });
    await deps.canonicalVacancyRepository.save(vacancy);
    return vacancy;
  }
  async function confirm(id: string) {
    const review = await workflow.getVacancyReview(id);
    const candidate = review.agencyContext?.candidates[0];
    if (!candidate) throw Error("Missing agency candidate");
    return workflow.confirmVacancyRecruitingAgency({ canonicalVacancyId: id, candidateId: candidate.candidateId });
  }
  return { db, deps, workflow, snapshot, add, confirm };
}

describe("human-confirmed agency memory", () => {
  it("keeps a Kelly corporate vacancy unresolved and eligible as direct employer despite confirmed Kelly agency memory", async () => {
    const f = fixture();
    try {
      await f.add("kelly-agency", "Kelly", "STAFFING_AGENCY"); await f.confirm("kelly-agency");
      const before = f.db.prepare("SELECT * FROM confirmed_organization_roles ORDER BY id").all();
      const result = await createCaptureProcessingRuntime(f.db).captureAndProcessBrowserVacancy({
        pageUrl: "https://kellyservices.wd503.myworkdayjobs.com/en-US/corporatecareers-kellyservices-com/details/Supervisor-Site_JR100451",
        pageTitle: "Corporate Careers", html: readFileSync("tests/fixtures/kellyWorkdaySelectedVacancy.html", "utf8"), visibleText: "Corporate Remote JR100451", capturedAt: date,
      });
      if (result.processing.status !== "PROCESSED") throw Error("Processing failed");
      const view = await f.workflow.getVacancyReview(result.processing.canonicalVacancyId);
      expect(view.employer.status).toBe("UNRESOLVED"); expect(view.employer.confirmationCandidate).toBe("Kelly");
      expect(view.agencyContext?.known).toEqual([]); expect(view.agencyContext?.candidates).toEqual([]);
      const vacancy = await f.deps.canonicalVacancyRepository.findById(result.processing.canonicalVacancyId);
      expect(vacancy?.organizationRelationships.some(item => item.role === "STAFFING_AGENCY" || item.role === "RECRUITER")).toBe(false);
      expect((await f.deps.assignmentRepository.findEffectiveByObservationId(result.capture.observationId))?.status).toBe("ACCEPTED");
      expect(f.db.prepare("SELECT * FROM confirmed_organization_roles ORDER BY id").all()).toEqual(before);
    } finally { f.db.close(); }
  });
  it("classifies the Gi Group legal identity without fuzzy-matching parent or other branch memories", async () => {
    const f = fixture();
    try {
      await f.add("gi-parent", "Gi Group"); await f.confirm("gi-parent");
      await f.add("gi-holding", "Gi Group Holding"); await f.confirm("gi-holding");
      const runtime = createCaptureProcessingRuntime(f.db);
      const result = await runtime.captureAndProcessBrowserVacancy({ pageUrl: "https://fr.gigroup.com/detail-offre-emploi/strasbourg-bas-rhin-technicien-de-maintenance-h-f/85929/",
        pageTitle: "Gi Group vacancy", html: readFileSync("tests/fixtures/giGroupDirectVacancy.html", "utf8"), visibleText: "Gi Group current vacancy", capturedAt: date });
      if (result.processing.status !== "PROCESSED") throw Error("Processing failed");
      const view = await f.workflow.getVacancyReview(result.processing.canonicalVacancyId);
      expect(view.agencyContext?.known).toEqual([]);
      expect(view.agencyContext?.candidates).toEqual([expect.objectContaining({ name: "Gi Group SpA", role: "STAFFING_AGENCY" })]);
      expect(view.employer.status).toBe("UNRESOLVED"); expect(view.employer.confirmationCandidate).toBeNull();
      expect(f.db.prepare("SELECT COUNT(*) AS count FROM confirmed_organization_roles").get()).toEqual({ count: 2 });
    } finally { f.db.close(); }
  });

  it("classifies the PROMAN selected branch without fuzzy-matching parent or other branch memories", async () => {
    const f = fixture();
    try {
      await f.add("proman-parent", "PROMAN"); await f.confirm("proman-parent");
      await f.add("proman-paris", "PROMAN PARIS"); await f.confirm("proman-paris");
      const runtime = createCaptureProcessingRuntime(f.db);
      const result = await runtime.captureAndProcessBrowserVacancy({ pageUrl: "https://mon-espace.proman-emploi.fr/dashboard?offre_id=1197787",
        pageTitle: "PROMAN vacancy", html: readFileSync("tests/fixtures/promanSelectedVacancy.html", "utf8"), visibleText: "PROMAN current vacancy", capturedAt: date });
      if (result.processing.status !== "PROCESSED") throw Error("Processing failed");
      const view = await f.workflow.getVacancyReview(result.processing.canonicalVacancyId);
      expect(view.agencyContext?.known).toEqual([]);
      expect(view.agencyContext?.candidates).toEqual([expect.objectContaining({ name: "PROMAN AIX EXPERTISE 2", role: "STAFFING_AGENCY" })]);
      expect(view.employer.status).toBe("UNRESOLVED"); expect(view.employer.confirmationCandidate).toBeNull();
      expect(f.db.prepare("SELECT COUNT(*) AS count FROM confirmed_organization_roles").get()).toEqual({ count: 2 });
    } finally { f.db.close(); }
  });

  it("classifies the Start People agency card without fuzzy-matching parent or other branch memories", async () => {
    const f = fixture();
    try {
      await f.add("start-parent", "Start People"); await f.confirm("start-parent");
      await f.add("start-paris", "Start People PARIS"); await f.confirm("start-paris");
      const runtime = createCaptureProcessingRuntime(f.db);
      const result = await runtime.captureAndProcessBrowserVacancy({ pageUrl: "https://www.startpeople.fr/offre-emploi/strasbourg/coordinateur-technique-referent-atelier-h-f/9481983",
        pageTitle: "Start People vacancy", html: readFileSync("tests/fixtures/startPeopleDirectVacancy.html", "utf8"), visibleText: "Start People current vacancy", capturedAt: date });
      if (result.processing.status !== "PROCESSED") throw Error("Processing failed");
      const view = await f.workflow.getVacancyReview(result.processing.canonicalVacancyId);
      expect(view.agencyContext?.known).toEqual([]);
      expect(view.agencyContext?.candidates).toEqual([expect.objectContaining({ name: "Start People STRASBOURG BTP", role: "STAFFING_AGENCY" })]);
      expect(view.employer.status).toBe("UNRESOLVED"); expect(view.employer.confirmationCandidate).toBeNull();
      expect(f.db.prepare("SELECT COUNT(*) AS count FROM confirmed_organization_roles").get()).toEqual({ count: 2 });
    } finally { f.db.close(); }
  });

  it("classifies the Actual agency card without fuzzy-matching parent or other branch memories", async () => {
    const f = fixture();
    try {
      await f.add("actual-parent", "Actual"); await f.confirm("actual-parent");
      await f.add("actual-marseille", "ACTUAL MARSEILLE"); await f.confirm("actual-marseille");
      const runtime = createCaptureProcessingRuntime(f.db);
      const result = await runtime.captureAndProcessBrowserVacancy({ pageUrl: "https://www.actualgroup.com/offres-emploi/teleconseiller-h-f-lu-re1254192a397912",
        pageTitle: "Actual vacancy", html: readFileSync("tests/fixtures/actualDirectVacancy.html", "utf8"), visibleText: "Actual current vacancy", capturedAt: date });
      if (result.processing.status !== "PROCESSED") throw Error("Processing failed");
      const view = await f.workflow.getVacancyReview(result.processing.canonicalVacancyId);
      expect(view.agencyContext?.known).toEqual([]);
      expect(view.agencyContext?.candidates).toEqual([expect.objectContaining({ name: "Actual emploi Schiltigheim", role: "STAFFING_AGENCY" })]);
      expect(view.employer.status).toBe("UNRESOLVED"); expect(view.employer.confirmationCandidate).toBeNull();
      expect(f.db.prepare("SELECT COUNT(*) AS count FROM confirmed_organization_roles").get()).toEqual({ count: 2 });
    } finally { f.db.close(); }
  });
  it("classifies a Crit branch from explicit client evidence without borrowing confirmed parent memory", async () => {
    const f = fixture();
    try {
      await f.add("parent-crit", "Crit"); await f.confirm("parent-crit");
      const runtime = createCaptureProcessingRuntime(f.db);
      const result = await runtime.captureAndProcessBrowserVacancy({
        pageUrl: "https://www.crit-job.com/offres/1e5128d8-42dd-4d6a-9f04-37cdb5922cf8", pageTitle: "Crit vacancy",
        html: readFileSync("tests/fixtures/critDirectVacancy.html", "utf8"), visibleText: "Crit current vacancy", capturedAt: date,
      });
      if (result.processing.status !== "PROCESSED") throw Error("Processing failed");
      const view = await f.workflow.getVacancyReview(result.processing.canonicalVacancyId);
      expect(view.agencyContext?.known).toEqual([]);
      expect(view.agencyContext?.candidates).toEqual([expect.objectContaining({ name: "CRIT ILLKIRCH-GRAFFENSTADEN Industrie", role: "STAFFING_AGENCY" })]);
      expect(view.employer.confirmationCandidate).toBeNull();
      expect(view.employer.status).toBe("UNRESOLVED");
      expect(f.db.prepare("SELECT organization_name FROM confirmed_organization_roles").all()).toEqual([{ organization_name: "Crit" }]);
    } finally { f.db.close(); }
  });
  it.each(["ACTUAL MARSEILLE", "Crit", "Jubil Intérim", "Randstad", "LHH", "Manpower"])("offers and confirms explicit staffing evidence for %s without changing employer/source history", async (name) => {
    const f = fixture();
    try {
      await f.add("first", name);
      const before = f.snapshot(false);
      const view = await f.workflow.getVacancyReview("first");
      expect(view.agencyContext?.candidates).toEqual([expect.objectContaining({ name, role: "STAFFING_AGENCY" })]);
      const result = await f.confirm("first");
      expect(result.agencyContext?.candidates).toEqual([]);
      expect(result.agencyContext?.known).toEqual([expect.objectContaining({ name, role: "STAFFING_AGENCY", source: "USER_CONFIRMED" })]);
      expect(result.employer.status).toBe("UNRESOLVED");
      expect(f.snapshot(false)).toBe(before);
      expect(f.db.prepare("SELECT source_type,role,source_vacancy_id,source_observation_id FROM confirmed_organization_roles").all())
        .toEqual([{ source_type: "USER_CONFIRMED", role: "STAFFING_AGENCY", source_vacancy_id: "first", source_observation_id: "first" }]);
    } finally { f.db.close(); }
  });
  it("reuses exact normalized names on later displayed-only vacancies, without forging human decisions", async () => {
    const f = fixture();
    try {
      await f.add("first", "Crit", "RECRUITER"); await f.confirm("first");
      const current = await f.add("later", "  CRIT  ", null);
      const before = f.snapshot();
      const review = await f.workflow.getVacancyReview("later");
      expect(review.agencyContext?.known).toEqual([expect.objectContaining({ name: "CRIT", role: "RECRUITER", source: "AGENCY_MEMORY" })]);
      expect(review.agencyContext?.candidates).toEqual([]);
      expect(review.organizations.recruiters).toContainEqual(expect.objectContaining({ rawName: "CRIT", role: "RECRUITER" }));
      expect(review.employer.confirmationCandidate).toBeNull();
      expect(review.employer.status).toBe("UNRESOLVED");
      await expect(f.workflow.confirmVacancyEmployer({ canonicalVacancyId: "later", candidateName: "CRIT" })).rejects.toThrow("no longer eligible");
      expect(await f.deps.canonicalVacancyRepository.findById("later")).toEqual(current);
      expect(f.snapshot()).toBe(before);
      expect(f.db.prepare("SELECT COUNT(*) AS count FROM confirmed_organization_roles").get()).toEqual({ count: 1 });
      expect((await f.deps.assignmentRepository.findEffectiveByObservationId("later"))?.status).toBe("ACCEPTED");
    } finally { f.db.close(); }
  });
  it("does not infer brand/branch aliases between Actual and ACTUAL MARSEILLE", async () => {
    const f = fixture();
    try {
      await f.add("first", "Actual", "RECRUITER"); await f.confirm("first");
      await f.add("later", "ACTUAL MARSEILLE", "STAFFING_AGENCY");
      const view = await f.workflow.getVacancyReview("later");
      expect(view.agencyContext?.known).toEqual([]);
      expect(view.agencyContext?.candidates).toHaveLength(1);
    } finally { f.db.close(); }
  });
  it("does not propose a direct company with no intermediary evidence", async () => {
    const f = fixture();
    try {
      await f.add("direct", "Internal Company", null);
      expect((await f.workflow.getVacancyReview("direct")).agencyContext?.candidates).toEqual([]);
    } finally { f.db.close(); }
  });
  it("keeps Talent.com's Actual recruiter separate from displayed ACTUAL MARSEILLE", async () => {
    const f = fixture();
    try {
      const vacancy = await f.add("actual", "ACTUAL MARSEILLE", null);
      await f.deps.canonicalVacancyRepository.save({ ...vacancy, organizationRelationships: [...vacancy.organizationRelationships,
        { role: "RECRUITER", rawName: "Actual", supportingEvidenceIds: ["org-actual"], confidence: 1, derivation: vacancy.derivation }] });
      const review = await f.workflow.getVacancyReview("actual");
      expect(review.agencyContext?.candidates.map((c) => c.name)).toEqual(["Actual"]);
      expect((await f.confirm("actual")).employer.status).toBe("UNRESOLVED");
      expect((await f.deps.agencyMemoryRepository.findByNormalizedName("actual marseille"))).toEqual([]);
    } finally { f.db.close(); }
  });
  it("adds auditable derived evidence without mutating original extraction or creating new USER_CONFIRMED evidence", async () => {
    const f = fixture();
    try {
      await f.add("first", "Agency", "RECRUITER"); await f.confirm("first");
      const original = createExtractedVacancyEvidence({ sourceObservationId: "later", organizations: [{ value: "Agency", role: "UNKNOWN",
        provenance: { sourceObservationId: "later", extractionMethod: "DIRECT_FIELD", confidence: 1 } }] });
      const before = structuredClone(original);
      const extractor = new AgencyMemoryVacancyEvidenceExtractor({ extract: async () => original }, f.deps.agencyMemoryRepository);
      const evidence = await extractor.extract({ id: "later", source: { sourceType: "JOB_BOARD", sourceName: "test" }, observedAt: date, metadata: {} });
      expect(evidence.organizations).toContainEqual(expect.objectContaining({ role: "RECRUITER", provenance: expect.objectContaining({
        sourceObservationId: "later", extractionMethod: "EXTERNAL_SOURCE", organizationRoleMemoryId: expect.any(String),
      }) }));
      expect(evidence.organizations.some((o) => o.provenance.extractionMethod === "USER_CONFIRMED")).toBe(false);
      expect(original).toEqual(before);
    } finally { f.db.close(); }
  });
  it("keeps historical agency roles as review support without forcing a future capture role", async () => {
    const f = fixture();
    try {
      await f.add("first", "Agency", "RECRUITER"); await f.confirm("first");
      const runtime = createCaptureProcessingRuntime(f.db);
      const captured = await runtime.captureAndProcessBrowserVacancy({ pageUrl: "https://example.test/jobs/later", pageTitle: "Technicien H/F",
        visibleText: "Technicien H/F\nAgency\n67 - Strasbourg\nCDI", capturedAt: date,
        html: '<script type="application/ld+json">{"@type":"JobPosting","title":"Technicien H/F","hiringOrganization":{"name":"Agency"}}</script>' });
      if (captured.processing.status !== "PROCESSED") throw Error("Processing failed");
      const current = (await f.deps.canonicalVacancyRepository.findById(captured.processing.canonicalVacancyId))!;
      expect(current.organizationRelationships.some(r => r.role === "RECRUITER" && r.rawName === "Agency")).toBe(false);
      const review = await f.workflow.getVacancyReview(current.id);
      expect(review.agencyContext?.known[0]?.source).toBe("AGENCY_MEMORY");
      expect(review.agencyContext?.candidates).toEqual([]);
      expect(review.employer.status).toBe("UNRESOLVED");
      expect(f.db.prepare("SELECT COUNT(*) AS count FROM confirmed_organization_roles").get()).toEqual({ count: 1 });
    } finally { f.db.close(); }
  });
  it("preserves explicit direct-employer evidence during capture even for a known agency", async () => {
    const f = fixture();
    try {
      await f.add("first", "Agency", "RECRUITER"); await f.confirm("first");
      const runtime = createCaptureProcessingRuntime(f.db);
      const result = await runtime.captureAndProcessBrowserVacancy({ pageUrl: "https://example.test/internal", pageTitle: "Technicien H/F",
        visibleText: "Technicien H/F\nAgency\nEmployeur: Agency\n67 - Strasbourg\nCDI", capturedAt: date,
        html: '<script type="application/ld+json">{"@type":"JobPosting","title":"Technicien H/F","hiringOrganization":{"name":"Agency"}}</script>' });
      if (result.processing.status !== "PROCESSED") throw Error("Processing failed");
      const vacancy = (await f.deps.canonicalVacancyRepository.findById(result.processing.canonicalVacancyId))!;
      expect(vacancy.organizationRelationships).toContainEqual(expect.objectContaining({ role: "EMPLOYER", rawName: "Agency" }));
      expect(vacancy.organizationRelationships.some((r) => r.role === "RECRUITER")).toBe(false);
      expect((await f.workflow.getVacancyReview(vacancy.id)).agencyContext?.known).toEqual([]);
    } finally { f.db.close(); }
  });
  it("preserves the employer confirmation path for a known agency's explicit internal role", async () => {
    const f = fixture();
    try {
      await f.add("first", "Agency"); await f.confirm("first");
      await f.add("internal", "Agency", "EMPLOYER");
      const review = await f.workflow.getVacancyReview("internal");
      expect(review.agencyContext?.known).toEqual([]);
      expect(review.agencyContext?.candidates).toEqual([]);
      expect(review.employer.confirmationCandidate).toBe("Agency");
      await f.workflow.confirmVacancyEmployer({ canonicalVacancyId: "internal", candidateName: "Agency" });
      expect((await f.deps.assignmentRepository.findEffectiveByObservationId("internal"))?.status).toBe("USER_CONFIRMED");
      expect(f.db.prepare("SELECT COUNT(*) AS count FROM confirmed_organization_roles").get()).toEqual({ count: 1 });
    } finally { f.db.close(); }
  });
  it("keeps independent HEUFT named-client review available when recruiter role comes from agency memory", async () => {
    const f = fixture();
    try {
      await f.add("first", "Randstad"); await f.confirm("first");
      await f.add("later", "Randstad", null, { client: "HEUFT" });
      const review = await f.workflow.getVacancyReview("later");
      const client = review.employerReview?.candidates.find((c) => c.type === "NAMED_CLIENT");
      expect(client).toMatchObject({ name: "HEUFT" });
      if (!client || client.type !== "NAMED_CLIENT") throw Error("No client");
      await f.workflow.decideEmployerReview({ canonicalVacancyId: "later", type: "NAMED_CLIENT", candidateId: client.candidateId, decision: "CONFIRM" });
      const employer = (await f.deps.assignmentRepository.findEffectiveByObservationId("later"))!;
      expect((await f.deps.employerClusterRepository.findById(employer.employerClusterId))?.displayLabel).toBe("HEUFT");
      expect((await f.workflow.getVacancyReview("later")).agencyContext?.known).toHaveLength(1);
    } finally { f.db.close(); }
  });
  it("keeps distinct explicit identities ambiguous when only their shared name is observed", async () => {
    const f = fixture();
    try {
      await f.add("one", "Agency", "RECRUITER", { organizationId: "identity-one" }); await f.confirm("one");
      await f.add("two", "Agency", "RECRUITER", { organizationId: "identity-two" }); await f.confirm("two");
      await f.add("later", "Agency", "RECRUITER");
      const view = await f.workflow.getVacancyReview("later");
      expect(view.agencyContext?.known).toEqual([]);
      expect(view.agencyContext?.ambiguousNames).toEqual(["Agency"]);
      expect(view.agencyContext?.candidates).toEqual([]);
    } finally { f.db.close(); }
  });
  it("rejects contradictory employer/client evidence and missing organization provenance", async () => {
    const f = fixture();
    try {
      const vacancy = await f.add("first", "Agency", "RECRUITER", { client: "Agency" });
      expect((await f.workflow.getVacancyReview("first")).agencyContext?.candidates).toEqual([]);
      const broken = { ...vacancy, organizationRelationships: vacancy.organizationRelationships.filter((r) => r.role !== "CLIENT").map((r) => ({ ...r, supportingEvidenceIds: [] })) };
      expect((await getRecruitingAgencyProjection(broken, f.deps.agencyMemoryRepository)).context.candidates).toEqual([]);
    } finally { f.db.close(); }
  });
  it("rejects changed/stale candidates without mutation", async () => {
    const f = fixture();
    try {
      const vacancy = await f.add("first");
      const candidate = (await f.workflow.getVacancyReview("first")).agencyContext!.candidates[0]!;
      await f.deps.canonicalVacancyRepository.save({ ...vacancy, organizationRelationships: vacancy.organizationRelationships.filter((r) => r.role !== "STAFFING_AGENCY") });
      const before = f.snapshot();
      await expect(f.workflow.confirmVacancyRecruitingAgency({ canonicalVacancyId: "first", candidateId: candidate.candidateId })).rejects.toThrow("no longer eligible");
      expect(f.snapshot()).toBe(before);
    } finally { f.db.close(); }
  });
  it("handles concurrent/repeated confirmations with exactly one durable human record", async () => {
    const f = fixture();
    try {
      await f.add("first");
      const input = { canonicalVacancyId: "first", candidateId: (await f.workflow.getVacancyReview("first")).agencyContext!.candidates[0]!.candidateId };
      const results = await Promise.allSettled([f.workflow.confirmVacancyRecruitingAgency(input), f.workflow.confirmVacancyRecruitingAgency(input)]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
      const before = f.snapshot();
      await expect(f.workflow.confirmVacancyRecruitingAgency(input)).rejects.toThrow("no longer eligible");
      expect(f.snapshot()).toBe(before);
    } finally { f.db.close(); }
  });
  it("keeps all GETs mutation-free before and after confirmation", async () => {
    const f = fixture();
    try {
      await f.add("first");
      for (const confirmed of [false, true]) {
        if (confirmed) await f.confirm("first");
        const before = f.snapshot();
        await f.workflow.getVacancyReview("first"); await f.workflow.getVacancyReview("first");
        expect(f.snapshot()).toBe(before);
      }
    } finally { f.db.close(); }
  });
  it("persists across connection restart and protects memory from update/delete", async () => {
    const f = fixture();
    let reopened: ReturnType<typeof fixture> | undefined;
    try {
      await f.add("first"); await f.confirm("first");
      const copy = new Database(f.db.serialize());
      copy.pragma("foreign_keys=ON"); migrateDatabase(copy);
      reopened = fixture(copy);
      expect((await reopened.workflow.getVacancyReview("first")).agencyContext?.known[0]?.source).toBe("USER_CONFIRMED");
      expect(() => copy.prepare("UPDATE confirmed_organization_roles SET role='RECRUITER'").run()).toThrow("append-only");
      expect(() => copy.prepare("DELETE FROM confirmed_organization_roles").run()).toThrow("append-only");
      expect(copy.prepare("SELECT MAX(version) AS version FROM schema_migrations").get()).toEqual({ version: 11 });
    } finally { reopened?.db.close(); f.db.close(); }
  });
  it("upgrades a populated version 8 database additively and idempotently", async () => {
    const f = fixture(versionEightDatabase());
    try {
      await f.add("existing");
      const tables = (f.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name <> 'schema_migrations' ORDER BY name").all() as { name: string }[]).map((row) => row.name);
      const columns = tables.map(table => (f.db.pragma(`table_info(${table})`) as {name:string}[]).map(c => c.name).join(","));
      const snapshot = () => JSON.stringify(tables.map((table,i) => [table, f.db.prepare(`SELECT ${columns[i]} FROM "${table}" ORDER BY rowid`).all()]));
      const before = snapshot();
      migrateDatabase(f.db); migrateDatabase(f.db);
      expect(snapshot()).toBe(before);
      expect(f.db.prepare("SELECT MAX(version) AS version FROM schema_migrations").get()).toEqual({ version: 11 });
      expect(f.db.prepare("SELECT COUNT(*) AS count FROM confirmed_organization_roles").get()).toEqual({ count: 0 });
    } finally { f.db.close(); }
  });
  it("validates HTTP payloads and returns 409 for stale human confirmation", async () => {
    const f = fixture();
    const server = createBrowserCaptureServer({ ...f.workflow, captureAndProcessBrowserVacancy: async () => { throw Error("unused"); } });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      await f.add("first");
      const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/vacancies/first/recruiting-agency-confirmation`;
      const post = (body: unknown) => fetch(base, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const candidateId = (await f.workflow.getVacancyReview("first")).agencyContext!.candidates[0]!.candidateId;
      expect((await post({ candidateId, role: "EMPLOYER" })).status).toBe(400);
      expect((await post({})).status).toBe(400);
      expect((await post({ candidateId })).status).toBe(201);
      const before = f.snapshot();
      expect((await post({ candidateId })).status).toBe(409);
      expect(f.snapshot()).toBe(before);
    } finally { server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close((e) => e ? reject(e) : resolve())); f.db.close(); }
  });
});
