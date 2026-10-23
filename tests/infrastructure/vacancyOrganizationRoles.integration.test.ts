import { readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import { createDatabase } from "../../src/infrastructure/database/createDatabase.js";
import { migrateDatabase } from "../../src/infrastructure/database/migrateDatabase.js";
import { createCaptureProcessingRuntime } from "../../src/infrastructure/runtime/createCaptureProcessingRuntime.js";
import { createVacancyReviewWorkflow } from "../../src/application/user/createVacancyReviewWorkflow.js";
import { createBrowserCaptureServer } from "../../src/infrastructure/http/createBrowserCaptureServer.js";
import { SqliteCanonicalVacancyRepository } from "../../src/infrastructure/persistence/SqliteCanonicalVacancyRepository.js";
import { SqliteSourceObservationRepository } from "../../src/infrastructure/persistence/SqliteSourceObservationRepository.js";
import { SqliteEmployerClusterRepository } from "../../src/infrastructure/persistence/SqliteEmployerClusterRepository.js";
import { SqliteObservationClusterAssignmentRepository } from "../../src/infrastructure/persistence/SqliteObservationClusterAssignmentRepository.js";
import { SqliteEmployerMemoryPublicDataSource } from "../../src/infrastructure/persistence/SqliteEmployerMemoryPublicDataSource.js";
import { SqliteUserVacancyInteractionRepository } from "../../src/infrastructure/persistence/SqliteUserVacancyInteractionRepository.js";
import { SqliteConfirmedOrganizationRoleRepository } from "../../src/infrastructure/persistence/SqliteConfirmedOrganizationRoleRepository.js";
import { SqliteVacancyOrganizationRoleDecisionRepository } from "../../src/infrastructure/persistence/SqliteVacancyOrganizationRoleDecisionRepository.js";
import type { HumanOrganizationRole } from "../../src/domain/organizations/VacancyOrganizationRoleDecision.js";
import { buildOrganizationRoleReview } from "../../src/application/user/vacancyOrganizationRoles.js";
import { SqliteEmployerAliasEvidenceRepository } from "../../src/infrastructure/persistence/SqliteEmployerAliasEvidenceRepository.js";
const kellyUrl = "https://kellyservices.wd503.myworkdayjobs.com/en-US/corporatecareers-kellyservices-com/details/Supervisor-Site_JR100451";
const kelly = readFileSync("tests/fixtures/kellyWorkdaySelectedVacancy.html", "utf8");
function fixture() {
  const db = createDatabase(":memory:");
  const deps = {
    aliasRepository: new SqliteEmployerAliasEvidenceRepository(db),
    canonicalVacancyRepository: new SqliteCanonicalVacancyRepository(db),
    sourceObservationRepository: new SqliteSourceObservationRepository(db),
    interactionRepository: new SqliteUserVacancyInteractionRepository(db),
    employerClusterRepository: new SqliteEmployerClusterRepository(db),
    assignmentRepository: new SqliteObservationClusterAssignmentRepository(db),
    employerMemoryPublicDataSource: new SqliteEmployerMemoryPublicDataSource(db),
    agencyMemoryRepository: new SqliteConfirmedOrganizationRoleRepository(db),
    organizationRoleDecisionRepository: new SqliteVacancyOrganizationRoleDecisionRepository(db)
  };
  const workflow = createVacancyReviewWorkflow(deps),
    runtime = createCaptureProcessingRuntime(db);
  const rows = (table: string) => db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all();
  async function capture(html = kelly, pageUrl = kellyUrl) {
    const result = await runtime.captureAndProcessBrowserVacancy({
      html,
      pageUrl,
      pageTitle: "Selected vacancy",
      visibleText: "Selected vacancy",
      capturedAt: new Date("2026-10-23T10:00:00Z")
    });
    if (result.processing.status !== "PROCESSED") throw Error(JSON.stringify(result.processing));
    return {
      ...result,
      id: result.processing.canonicalVacancyId
    };
  }
  async function choose(id: string, role: HumanOrganizationRole, requestId: string = crypto.randomUUID(), ack = true) {
    const card = (await workflow.getVacancyReview(id)).organizationRoleReview![0]!;
    return workflow.decideVacancyOrganizationRole({
      canonicalVacancyId: id,
      requestId,
      identityKey: card.identityKey,
      role,
      candidateToken: card.candidateToken,
      acknowledgeContradiction: ack
    });
  }
  return {
    db,
    deps,
    workflow,
    runtime,
    rows,
    capture,
    choose
  };
}
describe("vacancy-specific human organization roles", () => {
  it("keeps numeric Kelly recommendations independent of coexisting histories and preserves human decisions across exact/changed captures", async () => {
    const f = fixture();
    try {
      const employer = await f.capture();
      await f.choose(employer.id, "EMPLOYER");
      const agency = await f.capture(kelly.replaceAll("JR100451", "JR100452"), kellyUrl.replaceAll("JR100451", "JR100452"));
      await f.choose(agency.id, "STAFFING_AGENCY");
      const html = readFileSync("tests/fixtures/kellyWorkdayNumericSelectedVacancy.html", "utf8");
      const url = "https://kellyservices.wd503.myworkdayjobs.com/en-US/corporatecareers-kellyservices-com/details/Talent-Supply-Chain-Consultant_14860?jobFamilyGroup=2d970158a7eb1000bfa197af03f80000";
      const first = await f.capture(html, url);
      const original = await f.deps.sourceObservationRepository.findById(first.capture.observationId);
      expect(original?.source.externalId).toBe("14860");
      expect(original?.publishedAt).toBeUndefined();
      const initial = await f.workflow.getVacancyReview(first.id);
      const card = initial.organizationRoleReview![0]!;
      expect(initial.vacancy).toMatchObject({title:"Talent Supply Chain Consultant",location:{rawText:"United States-Texas-Remote"},workMode:"REMOTE",engagement:{normalizedTerms:["FULL_TIME"]}});
      expect(card).toMatchObject({name:"Kelly",recommendedRole:"EMPLOYER",confirmedRole:null,evidenceStrength:"CONTEXTUAL"});
      expect(new Set(card.history.map(h=>h.role))).toEqual(new Set(["EMPLOYER","STAFFING_AGENCY"]));
      expect(card.actions.map(a=>a.role)).toEqual(["EMPLOYER","STAFFING_AGENCY","RECRUITER","CLIENT","CONSULTANCY"]);
      expect(card.reasons).toEqual(["Corporate-careers tenant","First-person Kelly employer wording","No recruiting-for-client or staffing-assignment evidence"]);
      const confirmed = await f.choose(first.id, "EMPLOYER");
      const assignments = f.rows("observation_cluster_assignments"), decisions = f.rows("vacancy_organization_role_decisions"), clusters = f.rows("employer_clusters");
      for (let i=0;i<2;i++) {
        const repeated = await f.capture(html, url);
        expect(repeated.capture.observationId).toBe(first.capture.observationId);
        expect(repeated.id).toBe(first.id);
      }
      expect(await f.deps.sourceObservationRepository.countCaptureOccurrences([first.capture.observationId])).toBe(3);
      expect(f.rows("observation_cluster_assignments")).toEqual(assignments);
      expect(f.rows("vacancy_organization_role_decisions")).toEqual(decisions);
      expect(f.rows("employer_clusters")).toEqual(clusters);
      const changed = await f.capture(html.replace("Together we change lives.","Together we change lives. Updated selected vacancy description."), url);
      expect(changed.capture.observationId).not.toBe(first.capture.observationId);
      expect(changed.id).toBe(first.id);
      const view = await f.workflow.getVacancyReview(first.id);
      expect(view.vacancy.sourceObservationCount).toBe(2);
      expect(view.organizationRoleReview![0]).toMatchObject({recommendedRole:"EMPLOYER",confirmedRole:"EMPLOYER"});
      expect(view.employer.employerClusterId).toBe(confirmed.employer.employerClusterId);
      expect(f.rows("vacancy_organization_role_decisions")).toEqual(decisions);
      expect(await f.deps.sourceObservationRepository.findById(first.capture.observationId)).toEqual(original);
      expect((await f.deps.canonicalVacancyRepository.findById(first.id))!.organizationRelationships.some(r=>r.rawName==="Kelly" && ["STAFFING_AGENCY","RECRUITER"].includes(r.role))).toBe(false);
    } finally { f.db.close(); }
  });
  it("preserves a confirmed employer alias when repeating a role and detaches it only on an explicit role change", async () => {
    const f = fixture();
    try {
      const { id, capture } = await f.capture();
      const employer = await f.choose(id, "EMPLOYER");
      const cluster = employer.employer.employerClusterId!;
      const assignment = (await f.deps.assignmentRepository.findEffectiveByObservationId(capture.observationId))!;
      f.db.prepare("UPDATE employer_clusters SET display_label='Kelly Services' WHERE id=?").run(cluster);
      await f.deps.aliasRepository.save({id:"kelly-alias",aliasName:"Kelly",normalizedAliasName:"kelly",employerClusterId:cluster,sourceType:"USER_CONFIRMED_ALIAS",sourceAssignmentId:assignment.id,createdAt:new Date(),explanation:"Previously confirmed identity alias."});
      const count = f.rows("employer_clusters").length;
      expect((await f.choose(id, "EMPLOYER")).employer.employerClusterId).toBe(cluster);
      expect(f.rows("employer_clusters")).toHaveLength(count);
      const agency = await f.choose(id, "STAFFING_AGENCY");
      expect(agency.employer.employerClusterId).not.toBe(cluster);
      expect(agency.employer.status).toBe("UNRESOLVED");
      expect(f.rows("employer_alias_evidence")).toHaveLength(1);
    } finally { f.db.close(); }
  });
  it("does not reinterpret a stale canonical role as fresh source evidence", async () => {
    const f = fixture();
    try {
      const { id } = await f.capture();
      const vacancy = (await f.deps.canonicalVacancyRepository.findById(id))!;
      const cards = await buildOrganizationRoleReview(vacancy, [{ id: "no-role-evidence", source: { sourceType: "JOB_BOARD", sourceName: "example.test" }, observedAt: new Date(), metadata: {} }], f.deps);
      expect(cards).toEqual([expect.objectContaining({ name: "Kelly", recommendedRole: "UNKNOWN", evidenceStrength: "UNKNOWN", confirmedRole: null })]);
    } finally { f.db.close(); }
  });
  it("maps selected LinkedIn recruitment evidence to recruiter without reading outside-page content", async () => {
    const f = fixture();
    try {
      const {
          id
        } = await f.capture(),
        vacancy = (await f.deps.canonicalVacancyRepository.findById(id))!;
      const cards = await buildOrganizationRoleReview(vacancy, [{
        id: "selected",
        source: {
          sourceType: "JOB_BOARD",
          sourceName: "linkedin.com",
          sourceUrl: "https://www.linkedin.com/jobs/view/1234567890",
          externalId: "1234567890"
        },
        observedAt: new Date(),
        rawContent: "Outside is an employment agency.",
        metadata: {
          acquisition: {
            contexts: [{
              kind: "SELECTED_VACANCY",
              associationMethod: "PROVIDER_LOCATOR",
              providerKey: "LINKEDIN",
              text: "Alpha\nIngénieur Mécanique\nÀ propos de l’offre d’emploi\nAlpha is a recruitment agency.",
              html: '<section data-linkedin-selected-vacancy-context="direct-view">Alpha</section>'
            }]
          }
        }
      }], f.deps);
      expect(cards).toEqual([expect.objectContaining({
        name: "Alpha",
        recommendedRole: "RECRUITER",
        evidenceStrength: "EXPLICIT"
      })]);
    } finally {
      f.db.close();
    }
  });
  it("uses history only when current evidence is unknown and allows conflicting histories to coexist", async () => {
    const f = fixture();
    try {
      const first = await f.capture();
      await f.choose(first.id, "STAFFING_AGENCY");
      const plain = await f.capture('<script type="application/ld+json">{"@type":"JobPosting","title":"Engineer","hiringOrganization":{"name":"Kelly"}}</script>', "https://example.test/jobs/unknown");
      const card = (await f.workflow.getVacancyReview(plain.id)).organizationRoleReview![0]!;
      expect(card).toMatchObject({
        recommendedRole: "STAFFING_AGENCY",
        evidenceStrength: "HISTORY",
        confirmedRole: null
      });
      expect((await f.deps.canonicalVacancyRepository.findById(plain.id))!.organizationRelationships.some(r => r.role === "STAFFING_AGENCY")).toBe(false);
      const second = await f.capture(kelly.replaceAll("JR100451", "JR100452"), kellyUrl.replaceAll("JR100451", "JR100452"));
      expect((await f.workflow.getVacancyReview(second.id)).organizationRoleReview![0]).toMatchObject({
        recommendedRole: "EMPLOYER",
        evidenceStrength: "CONTEXTUAL"
      });
      await f.choose(second.id, "EMPLOYER");
      expect((await f.workflow.getVacancyReview(plain.id)).organizationRoleReview![0]).toMatchObject({
        recommendedRole: "UNKNOWN",
        confirmedRole: null
      });
    } finally {
      f.db.close();
    }
  });
  it("rejects a token issued before another observation was captured", async () => {
    const f = fixture();
    try {
      const {
          id
        } = await f.capture(),
        card = (await f.workflow.getVacancyReview(id)).organizationRoleReview![0]!;
      await f.capture(kelly.replaceAll("Supervisor Site", "Supervisor Site updated"));
      await expect(f.workflow.decideVacancyOrganizationRole({
        canonicalVacancyId: id,
        requestId: "old-source",
        identityKey: card.identityKey,
        role: "EMPLOYER",
        candidateToken: card.candidateToken,
        acknowledgeContradiction: false
      })).rejects.toThrow("stale");
      expect(f.rows("vacancy_organization_role_decisions")).toHaveLength(0);
      await f.choose(id, "EMPLOYER");
      const effective = await Promise.all((await f.deps.canonicalVacancyRepository.findById(id))!.sourceObservationIds.map(o => f.deps.assignmentRepository.findEffectiveByObservationId(o)));
      expect(new Set(effective.map(a => a?.employerClusterId)).size).toBe(1);
      expect(effective.every(a => a?.status === "USER_CONFIRMED")).toBe(true);
    } finally {
      f.db.close();
    }
  });
  it("recommends Kelly as employer with explicit reasons and every alternative, without automatically confirming", async () => {
    const f = fixture();
    try {
      const {
        id
      } = await f.capture();
      const view = await f.workflow.getVacancyReview(id);
      expect(view.organizationRoleReview).toEqual([expect.objectContaining({
        name: "Kelly",
        recommendedRole: "EMPLOYER",
        evidenceStrength: "CONTEXTUAL",
        confirmedRole: null,
        reasons: ["Corporate-careers tenant", "First-person Kelly employer wording", "No recruiting-for-client or staffing-assignment evidence"]
      })]);
      expect(view.organizationRoleReview![0]!.actions.map(a => a.role)).toEqual(["EMPLOYER", "STAFFING_AGENCY", "RECRUITER", "CLIENT", "CONSULTANCY"]);
      expect(view.employer.status).toBe("UNRESOLVED");
      expect(f.rows("vacancy_organization_role_decisions")).toHaveLength(0);
    } finally {
      f.db.close();
    }
  });
  it("recommends Crit as staffing agency while allowing a warned employer override", async () => {
    const f = fixture();
    try {
      const {
        id
      } = await f.capture(readFileSync("tests/fixtures/critDirectVacancy.html", "utf8"), "https://www.crit-job.com/offres/1e5128d8-42dd-4d6a-9f04-37cdb5922cf8");
      const view = await f.workflow.getVacancyReview(id),
        card = view.organizationRoleReview!.find(c => c.recommendedRole === "STAFFING_AGENCY")!;
      expect(card).toBeDefined();
      expect(card.actions.find(a => a.role === "EMPLOYER")?.warning).toBeTruthy();
      const input = {
        canonicalVacancyId: id,
        requestId: "crit-override",
        identityKey: card.identityKey,
        role: "EMPLOYER" as const,
        candidateToken: card.candidateToken,
        acknowledgeContradiction: false
      };
      await expect(f.workflow.decideVacancyOrganizationRole(input)).rejects.toThrow("requires confirmation");
      const confirmed = await f.workflow.decideVacancyOrganizationRole({
        ...input,
        acknowledgeContradiction: true
      });
      expect(confirmed.organizationRoleReview!.find(c => c.identityKey === card.identityKey)).toMatchObject({
        recommendedRole: "STAFFING_AGENCY",
        confirmedRole: "EMPLOYER"
      });
      expect(confirmed.employer.status).toBe("PROBABLY_RESOLVED");
    } finally {
      f.db.close();
    }
  });
  it("keeps decisions append-only, requests idempotent and source observations immutable", async () => {
    const f = fixture();
    try {
      const {
          id
        } = await f.capture(),
        before = f.rows("source_observations");
      const view = await f.choose(id, "EMPLOYER", "request-1");
      const cluster = view.employer.employerClusterId;
      await f.choose(id, "EMPLOYER", "request-1");
      await f.choose(id, "EMPLOYER", "request-2");
      expect(f.rows("vacancy_organization_role_decisions")).toHaveLength(1);
      expect(f.rows("observation_cluster_assignments").filter((a: any) => a.status === "USER_CONFIRMED")).toHaveLength(1);
      expect((await f.workflow.getVacancyReview(id)).employer.employerClusterId).toBe(cluster);
      expect(f.rows("source_observations")).toEqual(before);
      expect(() => f.db.exec("UPDATE vacancy_organization_role_decisions SET role='CLIENT'")).toThrow("append-only");
      expect(() => f.db.exec("DELETE FROM vacancy_organization_role_decisions")).toThrow("append-only");
      await expect(f.choose(id, "STAFFING_AGENCY", "request-1")).rejects.toThrow("already used");
    } finally {
      f.db.close();
    }
  });
  it("allows coexisting employer and agency history without forcing roles in another vacancy", async () => {
    const f = fixture();
    try {
      const first = await f.capture();
      const employer = await f.choose(first.id, "EMPLOYER");
      const second = await f.capture(kelly.replaceAll("JR100451", "JR100452"), kellyUrl.replaceAll("JR100451", "JR100452"));
      const secondReview = await f.choose(second.id, "STAFFING_AGENCY");
      expect(secondReview.organizationRoleReview![0]).toMatchObject({
        recommendedRole: "EMPLOYER",
        confirmedRole: "STAFFING_AGENCY"
      });
      expect((await f.workflow.getVacancyReview(first.id)).employer.employerClusterId).toBe(employer.employer.employerClusterId);
      expect((await f.workflow.getVacancyReview(first.id)).organizationRoleReview![0]).toMatchObject({
        recommendedRole: "EMPLOYER",
        confirmedRole: "EMPLOYER"
      });
      expect(f.rows("confirmed_organization_roles")).toHaveLength(1);
      const third = await f.capture(kelly.replaceAll("JR100451", "JR100453"), kellyUrl.replaceAll("JR100451", "JR100453"));
      const card = (await f.workflow.getVacancyReview(third.id)).organizationRoleReview![0]!;
      expect(card.recommendedRole).toBe("EMPLOYER");
      expect(new Set(card.history.map(h => h.role))).toEqual(new Set(["EMPLOYER", "STAFFING_AGENCY"]));
      expect((await f.deps.canonicalVacancyRepository.findById(third.id))!.organizationRelationships.some(r => r.role === "STAFFING_AGENCY")).toBe(false);
    } finally {
      f.db.close();
    }
  });
  it("detaches only this vacancy when changing its employer to agency and keeps recaptures stable", async () => {
    const f = fixture();
    try {
      const first = await f.capture();
      await f.choose(first.id, "EMPLOYER");
      const sourceBefore = f.rows("source_observations");
      const agency = await f.choose(first.id, "STAFFING_AGENCY");
      const cluster = agency.employer.employerClusterId;
      expect(agency.employer.status).toBe("UNRESOLVED");
      expect(agency.organizations.employerRelationships?.some(r => r.rawName === "Kelly")).toBe(false);
      const assignmentCount = f.rows("observation_cluster_assignments").length,
        clusterCount = f.rows("employer_clusters").length;
      for (let i = 0; i < 2; i++) {
        const recap = await f.capture();
        expect(recap.id).toBe(first.id);
      }
      expect(f.rows("source_observations")).toEqual(sourceBefore);
      expect(f.rows("vacancy_organization_role_decisions")).toHaveLength(2);
      expect(f.rows("observation_cluster_assignments")).toHaveLength(assignmentCount);
      expect(f.rows("employer_clusters")).toHaveLength(clusterCount);
      const changed = await f.capture(kelly.replaceAll("Supervisor Site", "Supervisor Site updated"));
      expect(changed.id).toBe(first.id);
      expect(changed.capture.observationId).not.toBe(first.capture.observationId);
      const review = await f.workflow.getVacancyReview(first.id);
      expect(review.employer.employerClusterId).toBe(cluster);
      expect(review.organizationRoleReview![0]).toMatchObject({
        recommendedRole: "EMPLOYER",
        confirmedRole: "STAFFING_AGENCY"
      });
      const canonical = await f.deps.canonicalVacancyRepository.findById(first.id);
      expect(canonical!.organizationRelationships.filter(r => r.rawName === "Kelly" && r.role === "STAFFING_AGENCY")).toHaveLength(1);
      expect(canonical!.organizationRelationships.some(r => r.rawName === "Kelly" && r.role === "EMPLOYER")).toBe(false);
    } finally {
      f.db.close();
    }
  });
  it("rejects stale and concurrent decisions without partial assignment changes", async () => {
    const f = fixture();
    try {
      const {
        id
      } = await f.capture();
      const card = (await f.workflow.getVacancyReview(id)).organizationRoleReview![0]!;
      const input = {
        canonicalVacancyId: id,
        identityKey: card.identityKey,
        role: "EMPLOYER" as const,
        candidateToken: card.candidateToken,
        acknowledgeContradiction: true
      };
      const results = await Promise.allSettled([f.workflow.decideVacancyOrganizationRole({
        ...input,
        requestId: "one"
      }), f.workflow.decideVacancyOrganizationRole({
        ...input,
        requestId: "two",
        role: "STAFFING_AGENCY"
      })]);
      expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
      expect(f.rows("vacancy_organization_role_decisions")).toHaveLength(1);
      const before = f.rows("observation_cluster_assignments");
      await expect(f.workflow.decideVacancyOrganizationRole({
        ...input,
        requestId: "three"
      })).rejects.toThrow("stale");
      expect(f.rows("observation_cluster_assignments")).toEqual(before);
    } finally {
      f.db.close();
    }
  });
  it("rolls back cluster and assignment changes if appending the decision fails", async () => {
    const f = fixture();
    try {
      const {
        id
      } = await f.capture();
      const before = [f.rows("observation_cluster_assignments"), f.rows("employer_clusters")];
      f.db.exec("CREATE TRIGGER reject_role BEFORE INSERT ON vacancy_organization_role_decisions BEGIN SELECT RAISE(ABORT,'injected failure'); END");
      await expect(f.choose(id, "EMPLOYER")).rejects.toThrow("injected failure");
      expect([f.rows("observation_cluster_assignments"), f.rows("employer_clusters")]).toEqual(before);
    } finally {
      f.db.close();
    }
  });
  it("upgrades a populated v9 database without rewriting existing data", async () => {
    const f = fixture();
    try {
      await f.capture();
      f.db.exec("DROP TABLE vacancy_organization_role_decisions; DELETE FROM schema_migrations WHERE version=10");
      const tables = (f.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name<>'schema_migrations' ORDER BY name").all() as {
        name: string;
      }[]).map(r => r.name);
      const snapshot = () => tables.map(t => [t, f.rows(t)]);
      const before = snapshot();
      migrateDatabase(f.db);
      migrateDatabase(f.db);
      expect(snapshot()).toEqual(before);
      expect(f.rows("vacancy_organization_role_decisions")).toEqual([]);
    } finally {
      f.db.close();
    }
  });
  it("validates the HTTP role action and requires explicit override acknowledgment", async () => {
    const f = fixture();
    const server = createBrowserCaptureServer({
      ...f.workflow,
      ...f.runtime
    });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    try {
      const {
          id
        } = await f.capture(),
        card = (await f.workflow.getVacancyReview(id)).organizationRoleReview![0]!;
      const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/vacancies/${id}/organization-role-decisions`;
      const post = (body: unknown) => fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(body)
      });
      const input = {
        requestId: "http",
        identityKey: card.identityKey,
        role: "STAFFING_AGENCY",
        candidateToken: card.candidateToken,
        acknowledgeContradiction: false
      };
      expect((await post({
        ...input,
        extra: true
      })).status).toBe(400);
      expect((await post({
        ...input,
        role: "DISPLAYED_COMPANY"
      })).status).toBe(400);
      expect((await post(input)).status).toBe(409);
      expect((await post({
        ...input,
        acknowledgeContradiction: true
      })).status).toBe(201);
      expect((await post({
        ...input,
        requestId: "stale",
        acknowledgeContradiction: true
      })).status).toBe(409);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve()));
      f.db.close();
    }
  });
});
