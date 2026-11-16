import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { createDatabase } from "../../src/infrastructure/database/createDatabase.js";
import { createCaptureProcessingRuntime } from "../../src/infrastructure/runtime/createCaptureProcessingRuntime.js";
import { createVacancyReviewWorkflow } from "../../src/application/user/createVacancyReviewWorkflow.js";
import { SqliteCanonicalVacancyRepository } from "../../src/infrastructure/persistence/SqliteCanonicalVacancyRepository.js";
import { SqliteSourceObservationRepository } from "../../src/infrastructure/persistence/SqliteSourceObservationRepository.js";
import { SqliteEmployerClusterRepository } from "../../src/infrastructure/persistence/SqliteEmployerClusterRepository.js";
import { SqliteObservationClusterAssignmentRepository } from "../../src/infrastructure/persistence/SqliteObservationClusterAssignmentRepository.js";
import { SqliteEmployerMemoryPublicDataSource } from "../../src/infrastructure/persistence/SqliteEmployerMemoryPublicDataSource.js";
import { SqliteUserVacancyInteractionRepository } from "../../src/infrastructure/persistence/SqliteUserVacancyInteractionRepository.js";
import { SqliteConfirmedOrganizationRoleRepository } from "../../src/infrastructure/persistence/SqliteConfirmedOrganizationRoleRepository.js";
import { SqliteVacancyOrganizationRoleDecisionRepository } from "../../src/infrastructure/persistence/SqliteVacancyOrganizationRoleDecisionRepository.js";
import type { HumanOrganizationRole } from "../../src/domain/organizations/VacancyOrganizationRoleDecision.js";
import { SqliteEmployerAliasEvidenceRepository } from "../../src/infrastructure/persistence/SqliteEmployerAliasEvidenceRepository.js";
import { SqliteEmployerIdentityDecisionStore } from "../../src/infrastructure/persistence/SqliteEmployerIdentityDecisionStore.js";
import { normalizeOrganizationEvidenceName } from "../../src/domain/evidence/OrganizationEvidence.js";
const { JSDOM } = require("jsdom");
const INDIA = "Airbus India Private Limited", TIANJIN = "Airbus (Tianjin) Final Assembly Company Limited", DEFENCE = "Airbus Defence and Space GmbH";
const host = "ag.wd3.myworkdayjobs.com";
const template = readFileSync("tests/fixtures/airbusSelectedPainter.html", "utf8");
const databases: ReturnType<typeof createDatabase>[] = [];
afterEach(() => { for (const db of databases.splice(0)) db.close(); });
function fixture() {
  const db = createDatabase(":memory:");
  databases.push(db);
  const deps = {
    employerIdentityDecisionStore: new SqliteEmployerIdentityDecisionStore(db),
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
  async function capture(jr: string, company: string, revision = "Initial description") {
    const dom = new JSDOM(template.replaceAll("JR10439155", jr));
    dom.window.document.querySelector('[data-automation-id="jobPostingDescription"]').innerHTML =
      `<p>Job Description:</p><p>Prepare and inspect aircraft components. ${revision}</p><p><b>Company:</b></p>${company}<p><b>Employment Type:</b></p>Fixed term`;
    const html = dom.serialize();
    dom.window.close();
    const pageUrl = `https://${host}/en-US/Airbus/details/Aircraft-painter_${jr}-1`;
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
  async function choose(id: string, role: HumanOrganizationRole, requestId: string = crypto.randomUUID(), ack = true, name = INDIA) {
    const card = (await workflow.getVacancyReview(id)).organizationRoleReview!.find(card => card.name === name)!;
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

async function trio(f: ReturnType<typeof fixture>) {
  return [await f.capture("JR10439155", TIANJIN), await f.capture("JR10456440", INDIA), await f.capture("JR10437897", DEFENCE)];
}
async function assignment(f: ReturnType<typeof fixture>, observationId: string) {
  return f.deps.assignmentRepository.findEffectiveByObservationId(observationId);
}
describe("Airbus employer role isolation", () => {
  it("confirms India only while Tianjin and Defence remain displayed-only", async () => {
    const f = fixture(), vacancies = await trio(f);
    for (const v of vacancies) {
      const view = await f.workflow.getVacancyReview(v.id);
      expect(view.employer.status).toBe("UNRESOLVED");
      expect(view.organizationRoleReview![0]!.confirmedRole).toBeNull();
      // The anonymous unresolved cluster has an EMPLOYER relationship without a raw organization name.
      expect((await f.deps.canonicalVacancyRepository.findById(v.id))!.organizationRelationships.filter(r => r.rawName !== undefined).map(r => r.role)).toEqual(["DISPLAYED_COMPANY"]);
    }
    await f.choose(vacancies[1]!.id, "EMPLOYER");
    expect(await assignment(f, vacancies[1]!.capture.observationId)).toMatchObject({status:"USER_CONFIRMED"});
    expect((await f.workflow.getVacancyReview(vacancies[1]!.id)).organizationRoleReview![0]).toMatchObject({name:INDIA,confirmedRole:"EMPLOYER"});
    for (const v of [vacancies[0]!, vacancies[2]!]) {
      expect((await f.workflow.getVacancyReview(v.id)).organizationRoleReview![0]!.confirmedRole).toBeNull();
      expect((await assignment(f,v.capture.observationId))!.status).not.toBe("USER_CONFIRMED");
      expect((await f.deps.canonicalVacancyRepository.findById(v.id))!.organizationRelationships.filter(r=>r.rawName !== undefined).map(r=>r.role)).toEqual(["DISPLAYED_COMPANY"]);
    }
    expect(f.rows("vacancy_organization_role_decisions")).toHaveLength(1);
    expect(f.rows("employer_alias_evidence")).toEqual([]);
  });
  it("does not merge identities or employer clusters through the same tenant", async () => {
    const f=fixture(), vacancies=await trio(f);
    const clusters = [];
    for(const v of vacancies) {
      expect((await f.deps.sourceObservationRepository.findById(v.capture.observationId))!.source.sourceName).toBe(host);
      clusters.push((await assignment(f,v.capture.observationId))!.employerClusterId);
    }
    expect(new Set(clusters).size).toBe(3);
    expect(f.rows("vacancy_organization_role_decisions")).toEqual([]);
    expect(f.rows("employer_alias_evidence")).toEqual([]);
  });
  it("keeps shared Airbus tokens distinct without automatic equivalence", async () => {
    const names=["Airbus","Airbus Commercial Aircraft",INDIA,DEFENCE,TIANJIN];
    expect(new Set(names.map(normalizeOrganizationEvidenceName)).size).toBe(5);
    const f=fixture(), clusters=[];
    for (const [i,name] of names.entries()) {
      const v=await f.capture(`JR1046000${i}`,name);
      await f.choose(v.id,"EMPLOYER",crypto.randomUUID(),true,name);
      clusters.push((await assignment(f,v.capture.observationId))!.employerClusterId);
      const before=f.rows("observation_cluster_assignments");
      await f.workflow.getVacancyReview(v.id); // Identity suggestions must be read-only.
      expect(f.rows("observation_cluster_assignments")).toEqual(before);
    }
    expect(new Set(clusters).size).toBe(5);
    expect(f.rows("employer_alias_evidence")).toEqual([]);
  });
  it("reuses exact-name employer memory without fabricating human role confirmation",async()=>{
    const f=fixture(), a=await f.capture("JR10456440",INDIA);
    await f.choose(a.id,"EMPLOYER");
    const decisions=f.rows("vacancy_organization_role_decisions");
    const b=await f.capture("JR10456441",INDIA);
    expect(b.id).not.toBe(a.id);
    expect(await assignment(f,b.capture.observationId)).toMatchObject({status:"ACCEPTED",algorithm:"confirmed-employer-memory",employerClusterId:(await assignment(f,a.capture.observationId))!.employerClusterId});
    expect((await f.workflow.getVacancyReview(b.id)).organizationRoleReview![0]!.confirmedRole).toBeNull();
    expect(f.rows("vacancy_organization_role_decisions")).toEqual(decisions);
  });
  it("keeps different roles for the same organization vacancy-specific",async()=>{
    const f=fixture(),a=await f.capture("JR10456440",INDIA);
    await f.choose(a.id,"EMPLOYER");
    const b=await f.capture("JR10456441",INDIA);
    await f.choose(b.id,"STAFFING_AGENCY");
    expect((await f.workflow.getVacancyReview(a.id)).organizationRoleReview![0]!.confirmedRole).toBe("EMPLOYER");
    expect((await f.workflow.getVacancyReview(b.id)).organizationRoleReview![0]!.confirmedRole).toBe("STAFFING_AGENCY");
    expect(f.rows("vacancy_organization_role_decisions")).toHaveLength(2);
  });
  it("preserves human employer through conflicting recapture without aliases or merges",async()=>{
    const f=fixture(),a=await f.capture("JR10456440",INDIA);
    await f.choose(a.id,"EMPLOYER");
    const decisions=f.rows("vacancy_organization_role_decisions"), old=await assignment(f,a.capture.observationId), clusters=f.rows("employer_clusters");
    const b=await f.capture("JR10456440",DEFENCE,"Changed company");
    expect(b.id).toBe(a.id);
    expect(b.capture.observationId).not.toBe(a.capture.observationId);
    const view=await f.workflow.getVacancyReview(a.id);
    expect(view.organizationRoleReview!.find(c=>c.name===INDIA)!.confirmedRole).toBe("EMPLOYER");
    expect(view.organizationRoleReview!.find(c=>c.name===DEFENCE)!.confirmedRole).toBeNull();
    expect(view.organizationRoleReview!.find(c=>c.name===DEFENCE)!.actions.find(a=>a.role==="EMPLOYER")!.warning).toContain("replaces the currently confirmed employer");
    expect((await f.deps.canonicalVacancyRepository.findById(a.id))!.organizationRelationships).toEqual(expect.arrayContaining([expect.objectContaining({rawName:DEFENCE,role:"DISPLAYED_COMPANY"}),expect.objectContaining({rawName:INDIA,role:"EMPLOYER"})]));
    expect(view.employer.employerClusterId).toBe(old!.employerClusterId);
    expect(await assignment(f,a.capture.observationId)).toEqual(old);
    expect(f.rows("vacancy_organization_role_decisions")).toEqual(decisions);
    expect(f.rows("employer_clusters")).toEqual(clusters);
    expect(f.rows("employer_alias_evidence")).toEqual([]);
  });
  it("preserves same-company recapture role and canonical employer without duplicate decisions",async()=>{
    const f=fixture(),a=await f.capture("JR10456440",INDIA);
    const confirmed=await f.choose(a.id,"EMPLOYER"), decisions=f.rows("vacancy_organization_role_decisions");
    const b=await f.capture("JR10456440",INDIA,"Updated duties");
    expect(b.id).toBe(a.id); expect(b.capture.observationId).not.toBe(a.capture.observationId);
    const view=await f.workflow.getVacancyReview(a.id);
    expect(view.employer.employerClusterId).toBe(confirmed.employer.employerClusterId);
    expect(view.organizationRoleReview![0]!.confirmedRole).toBe("EMPLOYER");
    expect(f.rows("vacancy_organization_role_decisions")).toEqual(decisions);
    expect(f.rows("employer_alias_evidence")).toEqual([]);
  });
  it("creates no alias or provider identity as a side effect of role confirmation",async()=>{
    const f=fixture(),v=await f.capture("JR10456440",INDIA);
    await f.choose(v.id,"EMPLOYER");
    expect(f.rows("employer_alias_evidence")).toEqual([]);
    const cluster=await f.deps.employerClusterRepository.findById((await assignment(f,v.capture.observationId))!.employerClusterId);
    expect(cluster!.displayLabel).toBe(INDIA);
    expect(JSON.stringify(f.rows("employer_clusters"))).not.toContain(host);
  });
  it("requires an explicit identity action to link independently confirmed clusters",async()=>{
    const f=fixture(),a=await f.capture("JR10456440",INDIA),b=await f.capture("JR10456441",INDIA);
    await f.choose(a.id,"EMPLOYER"); await f.choose(b.id,"EMPLOYER");
    const first=(await assignment(f,a.capture.observationId))!, second=(await assignment(f,b.capture.observationId))!;
    expect(first.employerClusterId).not.toBe(second.employerClusterId);
    const decisions=f.rows("vacancy_organization_role_decisions");
    const candidate=(await f.workflow.getVacancyReview(b.id)).employerIdentityReview!.candidates.find(c=>c.employerClusterId===first.employerClusterId)!;
    expect(candidate).toBeDefined();
    await f.workflow.decideEmployerIdentity({canonicalVacancyId:b.id,requestId:crypto.randomUUID(),employerClusterId:candidate.employerClusterId,candidateToken:candidate.candidateToken,decision:"USE_EXISTING"});
    expect((await assignment(f,b.capture.observationId))!.employerClusterId).toBe(first.employerClusterId);
    expect(await assignment(f,a.capture.observationId)).toEqual(first);
    expect(f.rows("vacancy_organization_role_decisions")).toEqual(decisions);
    expect(f.rows("employer_alias_evidence")).toEqual([]);
  });
  it("suppresses memory for contradictory client evidence without creating a role decision",async()=>{
    const f=fixture(),a=await f.capture("JR10456440",INDIA);
    await f.choose(a.id,"EMPLOYER");
    const decisions=f.rows("vacancy_organization_role_decisions");
    const b=await f.capture("JR10456441",INDIA,`Recruitment pour notre client ${INDIA}.`);
    const member=(await assignment(f,b.capture.observationId))!;
    expect(member.algorithm).not.toBe("confirmed-employer-memory");
    expect(member.status).not.toBe("USER_CONFIRMED");
    expect(member.employerClusterId).not.toBe((await assignment(f,a.capture.observationId))!.employerClusterId);
    const view=await f.workflow.getVacancyReview(b.id);
    expect(view.employer.status).toBe("UNRESOLVED");
    expect(view.organizationRoleReview!.find(c=>c.name===INDIA)!.confirmedRole).toBeNull();
    expect((await f.deps.canonicalVacancyRepository.findById(b.id))!.organizationRelationships).toEqual(expect.arrayContaining([expect.objectContaining({rawName:INDIA,role:"CLIENT"})]));
    expect(f.rows("vacancy_organization_role_decisions")).toEqual(decisions);
    expect(f.rows("employer_alias_evidence")).toEqual([]);
  });

});
