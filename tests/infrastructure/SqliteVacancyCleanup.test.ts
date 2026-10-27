import { SqliteSourceObservationRepository } from "../../src/infrastructure/persistence/SqliteSourceObservationRepository.js";
import { createBrowserCaptureServer } from "../../src/infrastructure/http/createBrowserCaptureServer.js";
import type { AddressInfo } from "node:net";
import { versionEightDatabase } from "./legacyDatabaseFixture.js";
import { migration009 } from "../../src/infrastructure/database/migrations/009_create_confirmed_organization_roles.js";
import { migration010 } from "../../src/infrastructure/database/migrations/010_create_vacancy_organization_role_decisions.js";
import { migrateDatabase } from "../../src/infrastructure/database/migrateDatabase.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { createDatabase } from "../../src/infrastructure/database/createDatabase.js";
import { createCaptureProcessingRuntime } from "../../src/infrastructure/runtime/createCaptureProcessingRuntime.js";
import { SqliteVacancyCleanup } from "../../src/infrastructure/persistence/SqliteVacancyCleanup.js";
import { SqliteCanonicalVacancyRepository } from "../../src/infrastructure/persistence/SqliteCanonicalVacancyRepository.js";
const html = readFileSync("tests/fixtures/greenhouseSelectedVacancy.html", "utf8");
const payload = { pageUrl: "https://job-boards.eu.greenhouse.io/agilerobotsse/jobs/4964827101", pageTitle: "Job Application", html, visibleText: "Selected job", capturedAt: "2026-10-27T12:00:00Z" };
const databases: ReturnType<typeof createDatabase>[] = [];
afterEach(() => { for (const db of databases.splice(0)) db.close(); });
async function setup() {
  const db = createDatabase(":memory:"); databases.push(db);
  const runtime = createCaptureProcessingRuntime(db);
  const capture = async (page = html) => {
    const r = await runtime.captureAndProcessBrowserVacancy({ ...payload, html: page });
    if (r.processing.status !== "PROCESSED") throw Error("Capture failed");
    return { id: r.processing.canonicalVacancyId, source: r.capture.observationId };
  };
  const first = await capture();
  const service = new SqliteVacancyCleanup(db);
  const repo = new SqliteCanonicalVacancyRepository(db);
  const archive = () => service.setArchived(first.id, true, service.state(first.id).token);
  const remove = (observationId?: string, ack = false) => service.delete({ canonicalVacancyId: first.id, ...(observationId ? { observationId } : {}), token: service.preview(first.id, observationId).token, confirmation: "DELETE", acknowledgeApplicationHistory: ack });
  const event = (type: string) => db.prepare("INSERT INTO user_vacancy_interaction_events VALUES (?,?,?,?,?,NULL)").run(type,first.id,type,"2026-10-27","2026-10-27");
  return { db, capture, first, service, repo, archive, remove, event };
}
describe("user controlled vacancy cleanup (in memory)", () => {
  it("archives, excludes from active candidates, retains recapture state, restores", async () => {
    const x = await setup(); x.archive();
    expect(await x.repo.findAll()).toEqual([]);
    expect((await x.repo.findAll({ archived: true })).map(v => v.id)).toEqual([x.first.id]);
    expect(await x.capture()).toEqual(x.first);
    expect(x.service.state(x.first.id).archived).toBe(true);
    x.service.setArchived(x.first.id,false,x.service.state(x.first.id).token);
    expect((await x.repo.findAll()).map(v => v.id)).toEqual([x.first.id]);
  });
  it("guards active, last-capture, confirmation and stale deletion requests", async () => {
    const x = await setup();
    expect(() => x.service.preview(x.first.id)).toThrow(/Archive/);
    x.archive();
    expect(() => x.service.preview(x.first.id,x.first.source)).toThrow(/last capture/);
    const token = x.service.preview(x.first.id).token;
    await expect(x.service.delete({ canonicalVacancyId:x.first.id,token,confirmation:"yes",acknowledgeApplicationHistory:false })).rejects.toThrow(/confirmation/);
    x.event("REVIEWED");
    await expect(x.service.delete({ canonicalVacancyId:x.first.id,token,confirmation:"DELETE",acknowledgeApplicationHistory:false })).rejects.toThrow(/changed/);
    expect(await x.repo.findById(x.first.id)).not.toBeNull();
  });
  it.each(["APPLIED","INTERVIEW"])("requires acknowledgement of %s history and removes whole vacancy atomically", async type => {
    const x = await setup(); x.event(type); x.archive();
    const old = (await x.repo.findById(x.first.id))!;
    expect(x.service.preview(x.first.id).requiresHistoryAcknowledgement).toBe(true);
    await expect(x.remove()).rejects.toThrow(/Acknowledge/);
    expect(() => x.db.prepare("DELETE FROM user_vacancy_interaction_events").run()).toThrow(/append-only/);
    await x.remove(undefined,true);
    expect(await x.repo.findById(x.first.id)).toBeNull();
    for (const table of ["source_observations","capture_occurrences","canonical_vacancy_observation_claims","canonical_vacancy_exact_identity_claims","user_vacancy_interaction_events","observation_cluster_assignments","vacancy_cleanup_guard","vacancy_cleanup_source_guard"]) expect(x.db.prepare(`SELECT count(*) n FROM ${table}`).get()).toEqual({ n:0 });
    expect(x.db.pragma("foreign_key_check")).toEqual([]);
    await expect(x.repo.save(old)).rejects.toThrow();
    expect(() => x.service.state(x.first.id)).toThrow(/no longer/);
  });
  it("recomputes from remaining captures with original canonical and preserved decisions", async () => {
    const x = await setup();
    const second = await x.capture(html.replaceAll("Manufacturing Engineer (m/f/d)","Updated Engineer (m/f/d)"));
    expect(second.id).toBe(x.first.id); expect(second.source).not.toBe(x.first.source);
    x.db.prepare("INSERT INTO vacancy_organization_role_decisions VALUES ('choice',?,'name:agency','Agency','agency','CLIENT',NULL,'{}',0,'2026-10-27')").run(x.first.id);
    const decisions = x.db.prepare("SELECT * FROM vacancy_organization_role_decisions").all();
    x.event("APPLIED"); x.archive();
    await x.remove(second.source,true);
    const canonical = (await x.repo.findById(x.first.id))!;
    expect(canonical.role.value?.title).toBe("Manufacturing Engineer (m/f/d)");
    expect(canonical.sourceObservationIds).toEqual([x.first.source]);
    expect(x.db.prepare("SELECT * FROM vacancy_organization_role_decisions").all()).toEqual(decisions);
    expect(canonical.organizationRelationships).toContainEqual(expect.objectContaining({role:"CLIENT",rawName:"Agency"}));
    expect(x.db.prepare("SELECT event_type FROM user_vacancy_interaction_events").all()).toEqual([{event_type:"APPLIED"}]);
    expect(x.service.state(x.first.id).archived).toBe(true);
    expect(await x.capture()).toEqual(x.first);
    expect(x.db.pragma("foreign_key_check")).toEqual([]);
  });
  it("rolls back all deletions on a failure", async () => {
    const x = await setup(); x.event("REVIEWED"); x.archive();
    const before = x.service.preview(x.first.id);
    x.db.exec("CREATE TRIGGER simulate_failure BEFORE DELETE ON source_observations BEGIN SELECT RAISE(ABORT,'failure'); END;");
    await expect(x.remove()).rejects.toThrow("failure");
    expect(x.service.preview(x.first.id)).toEqual(before);
    expect(x.db.prepare("SELECT * FROM vacancy_cleanup_guard").all()).toEqual([]);
    expect(x.db.prepare("SELECT * FROM deleted_vacancy_records").all()).toEqual([]);
  });
  it("preserves shared agency memory and its evidence but retires its deleted capture", async () => {
    const x = await setup();
    const evidence = x.db.prepare("SELECT evidence_ref_id FROM canonical_vacancy_evidence_references WHERE canonical_vacancy_id=? LIMIT 1").get(x.first.id) as {evidence_ref_id:string};
    x.db.prepare("INSERT INTO confirmed_organization_roles VALUES ('memory','name:agency',NULL,'Agency','agency','RECRUITER','USER_CONFIRMED',?,?,?,'2026-10-27')").run(x.first.id,x.first.source,JSON.stringify([evidence.evidence_ref_id]));
    const clusters = x.db.prepare("SELECT * FROM employer_clusters").all();
    x.archive(); expect(x.service.preview(x.first.id).retainedSourceIds).toEqual([x.first.source]);
    await x.remove();
    expect(x.db.prepare("SELECT * FROM employer_clusters").all()).toEqual(clusters);
    expect(x.db.prepare("SELECT id FROM confirmed_organization_roles").all()).toEqual([{id:"memory"}]);
    expect(x.db.prepare("SELECT evidence_ref_id FROM shared_employer_source_evidence").all()).toEqual([evidence]);
    expect(x.db.prepare("SELECT retired_at FROM source_observations WHERE id=?").get(x.first.source)).toMatchObject({retired_at:expect.any(String)});
    expect(x.db.pragma("foreign_key_check")).toEqual([]);
    const newCapture = await x.capture();
    expect(newCapture.id).not.toBe(x.first.id); expect(newCapture.source).not.toBe(x.first.source);
  });
});

it("preserves aliases used by another vacancy and deletes role decision chains", async () => {
  const x = await setup();
  const assignment=x.db.prepare("SELECT id,employer_cluster_id FROM observation_cluster_assignments WHERE source_observation_id=? LIMIT 1").get(x.first.source) as {id:string,employer_cluster_id:string};
  x.db.prepare("INSERT INTO employer_alias_evidence VALUES ('alias','Shared','shared',?,'USER_CONFIRMED_ALIAS',?,'2026-10-27','Confirmed alias')").run(assignment.employer_cluster_id,assignment.id);
  x.db.prepare("INSERT INTO vacancy_organization_role_decisions VALUES ('older',?,'name:agency','Agency','agency','CLIENT',NULL,'{}',0,'2026-10-27')").run(x.first.id);
  x.db.prepare("INSERT INTO vacancy_organization_role_decisions VALUES ('newer',?,'name:agency','Agency','agency','RECRUITER','older','{}',0,'2026-10-28')").run(x.first.id);
  const other=await createCaptureProcessingRuntime(x.db).captureAndProcessBrowserVacancy({...payload,pageUrl:payload.pageUrl.replace("4964827101","4964827102"),html:html.replaceAll("4964827101","4964827102")});
  if(other.processing.status!=="PROCESSED") throw Error("Capture failed");
  const otherId=other.processing.canonicalVacancyId;
  x.db.prepare("UPDATE observation_cluster_assignments SET employer_cluster_id=? WHERE source_observation_id=?").run(assignment.employer_cluster_id,other.capture.observationId);
  x.db.prepare("UPDATE canonical_vacancy_organization_relationships SET employer_cluster_id=? WHERE canonical_vacancy_id=? AND role='EMPLOYER'").run(assignment.employer_cluster_id,otherId);
  const otherBefore=await x.repo.findById(otherId);
  const alias=x.db.prepare("SELECT * FROM employer_alias_evidence").all();
  x.archive(); await x.remove();
  expect(x.db.prepare("SELECT * FROM employer_alias_evidence").all()).toEqual(alias);
  expect(x.db.prepare("SELECT id FROM observation_cluster_assignments WHERE source_observation_id=?").all(x.first.source)).toEqual([{id:assignment.id}]);
  expect(await x.repo.findById(otherId)).toEqual(otherBefore);
  expect(x.db.prepare("SELECT * FROM vacancy_organization_role_decisions").all()).toEqual([]);
  expect(x.db.pragma("foreign_key_check")).toEqual([]);
});
it("upgrades populated version 10 in memory without changing history or shared memory", async () => {
  const x=await setup();
  const old=versionEightDatabase(); databases.push(old);
  for (const m of [migration009,migration010]) {m.up(old); old.prepare("INSERT INTO schema_migrations VALUES (?,?,?)").run(m.version,m.name,"2026-10-27");}
  for(const table of ["source_observations","canonical_vacancies"]) {
    const columns=(old.pragma("table_info("+table+")") as {name:string}[]).map(c=>c.name);
    for(const row of x.db.prepare("SELECT "+columns.join(",")+" FROM "+table).all() as Record<string,unknown>[]) old.prepare("INSERT INTO "+table+" ("+columns.join(",")+") VALUES ("+columns.map(()=>"?").join(",")+")").run(...columns.map(c=>row[c]));
  }
  old.prepare("INSERT INTO confirmed_organization_roles VALUES ('memory','name:agency',NULL,'Agency','agency','RECRUITER','USER_CONFIRMED',?,?, '[\"evidence\"]','2026-10-27')").run(x.first.id,x.first.source);
  old.prepare("INSERT INTO user_vacancy_interaction_events VALUES ('event',?,'APPLIED','2026-10-27','2026-10-27',NULL)").run(x.first.id);
  const before=old.prepare("SELECT * FROM confirmed_organization_roles").all();
  migrateDatabase(old); migrateDatabase(old);
  expect(old.prepare("SELECT * FROM confirmed_organization_roles").all()).toEqual(before);
  expect(old.prepare("SELECT event_type FROM user_vacancy_interaction_events").all()).toEqual([{event_type:"APPLIED"}]);
  expect(()=>old.prepare("DELETE FROM confirmed_organization_roles").run()).toThrow(/append-only/);
  expect(()=>old.prepare("DELETE FROM user_vacancy_interaction_events").run()).toThrow(/append-only/);
  expect(old.pragma("foreign_key_check")).toEqual([]);
});
it("HTTP validates cleanup requests, rejects stale previews and returns 404 after deletion", async () => {
  const x=await setup();
  const server=createBrowserCaptureServer({vacancyCleanup:x.service,captureAndProcessBrowserVacancy:async()=>{throw Error("unused");}});
  await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));
  try {
    const base="http://127.0.0.1:"+(server.address() as AddressInfo).port+"/vacancies/"+x.first.id;
    const post=(path:string,body:unknown)=>fetch(base+path,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
    expect((await fetch(base+"/deletion-preview")).status).toBe(409);
    expect((await post("/archive",{archived:true})).status).toBe(400);
    const state=x.service.state(x.first.id);
    expect((await post("/archive",{archived:true,token:state.token})).status).toBe(200);
    expect((await post("/archive",{archived:false,token:state.token})).status).toBe(409);
    const {preview}=await (await fetch(base+"/deletion-preview")).json() as {preview:{token:string}};
    expect((await post("/deletion",{token:preview.token,confirmation:"DELETE",acknowledgeApplicationHistory:false,unexpected:true})).status).toBe(400);
    expect((await post("/deletion",{token:preview.token,confirmation:"DELETE",acknowledgeApplicationHistory:false})).status).toBe(200);
    expect((await fetch(base+"/cleanup")).status).toBe(404);
  } finally {server.closeAllConnections(); await new Promise<void>(resolve=>server.close(()=>resolve()));}
});

it("rechecks the preview after asynchronous extraction and cancels concurrent changes", async () => {
 const x=await setup(); const second=await x.capture(html.replaceAll("Manufacturing Engineer (m/f/d)","Updated Engineer")); x.archive();
 const original=SqliteSourceObservationRepository.prototype.findById;
 const spy=vi.spyOn(SqliteSourceObservationRepository.prototype,"findById").mockImplementationOnce(async function(this: SqliteSourceObservationRepository, id) { x.event("INTERVIEW"); return original.call(this,id); });
 try { await expect(x.remove(second.source)).rejects.toThrow(/changed/); }
 finally {spy.mockRestore();}
 expect(x.service.state(x.first.id).captures).toHaveLength(2);
 expect(x.db.prepare("SELECT * FROM vacancy_cleanup_guard").all()).toEqual([]);
});
it("removes only the selected source's family and campaign memberships", async () => {
 const x=await setup(); const second=await x.capture(html.replaceAll("Manufacturing Engineer (m/f/d)","Updated Engineer"));
 const cluster=x.db.prepare("SELECT employer_cluster_id id FROM observation_cluster_assignments LIMIT 1").get() as {id:string};
 x.db.exec("INSERT INTO publication_families VALUES ('family','2026-10-27','2026-10-27',NULL)");
 x.db.prepare("INSERT INTO recruitment_campaigns VALUES ('campaign',?,'ACTIVE','2026-10-27','2026-10-27','2026-10-27','2026-10-27',NULL,NULL,NULL)").run(cluster.id);
 for(const source of [x.first.source,second.source]) {
  x.db.prepare("INSERT INTO publication_family_memberships VALUES (?,'family',?,1,'ACCEPTED','test','1','2026-10-27','2026-10-27','TEST_FIXTURE',NULL,'2026-10-27',?)").run('family-'+source,source,'family-'+source);
  x.db.prepare("INSERT INTO recruitment_campaign_memberships VALUES (?,'campaign',NULL,?,1,'ACCEPTED','test','1','2026-10-27','2026-10-27','TEST_FIXTURE',NULL,NULL,?)").run('campaign-'+source,source,'campaign-'+source);
 }
 x.archive(); await x.remove(second.source);
 for(const table of ['publication_family_memberships','recruitment_campaign_memberships']) expect(x.db.prepare('SELECT source_observation_id FROM '+table).all()).toEqual([{source_observation_id:x.first.source}]);
 expect(x.db.pragma('foreign_key_check')).toEqual([]);
});
