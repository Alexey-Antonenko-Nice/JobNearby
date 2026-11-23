import { migration011 } from "../../src/infrastructure/database/migrations/011_vacancy_cleanup.js";
import { SqliteVacancyCrmRepository } from "../../src/infrastructure/persistence/SqliteVacancyCrmRepository.js";
import { createVacancyReviewWorkflow } from "../../src/application/user/createVacancyReviewWorkflow.js";
import { SqliteEmployerClusterRepository } from "../../src/infrastructure/persistence/SqliteEmployerClusterRepository.js";
import { SqliteEmployerMemoryPublicDataSource } from "../../src/infrastructure/persistence/SqliteEmployerMemoryPublicDataSource.js";
import { SqliteUserVacancyInteractionRepository } from "../../src/infrastructure/persistence/SqliteUserVacancyInteractionRepository.js";
import { SqliteSourceObservationRepository } from "../../src/infrastructure/persistence/SqliteSourceObservationRepository.js";
import { createTestCaptureServer as createBrowserCaptureServer } from "../support/httpAuthorization.js";
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
  const capture = async (page = html, pageUrl = payload.pageUrl) => {
    const r = await runtime.captureAndProcessBrowserVacancy({ ...payload, pageUrl, html: page });
    if (r.processing.status !== "PROCESSED") throw Error("Capture failed");
    return { id: r.processing.canonicalVacancyId, source: r.capture.observationId };
  };
  const first = await capture();
  const service = new SqliteVacancyCleanup(db);
  const repo = new SqliteCanonicalVacancyRepository(db);
  const archive = () => service.setArchived(first.id, true, service.state(first.id).token);
  const remove = (observationId?: string, ack = false) => service.delete({ canonicalVacancyId: first.id, ...(observationId ? { observationId } : {}), token: service.preview(first.id, observationId).token, confirmation: "DELETE", acknowledgeApplicationHistory: ack });
  const event = (type: string) => db.prepare("INSERT INTO user_vacancy_interaction_events VALUES (?,?,?,?,?,NULL)").run(type,first.id,type,"2026-10-27","2026-10-27");
  const crm = new SqliteVacancyCrmRepository(db);
  const workflow = createVacancyReviewWorkflow({
    crmRepository:crm, canonicalVacancyRepository:repo,
    sourceObservationRepository:new SqliteSourceObservationRepository(db),
    interactionRepository:new SqliteUserVacancyInteractionRepository(db),
    employerClusterRepository:new SqliteEmployerClusterRepository(db),
    employerMemoryPublicDataSource:new SqliteEmployerMemoryPublicDataSource(db),
    now:()=>new Date("2026-11-17T12:00:00Z")
  });
  return { db, capture, first, service, repo, archive, remove, event, crm, workflow };
}

describe("Private opportunity CRM",()=>{
  it("upgrades an existing version 11 database additively and repeatably",async()=>{
    const db=versionEightDatabase();databases.push(db);
    for(const m of [migration009,migration010,migration011]) {
      m.up(db);db.prepare("INSERT INTO schema_migrations VALUES (?,?,?)").run(m.version,m.name,"2026-11-16");
    }
    db.prepare("INSERT INTO canonical_vacancies VALUES (?,?,?,?,?,?,?)").run("legacy","PARTIAL","test","1","2026-11-16","2026-11-16","2026-11-16");
    db.prepare("INSERT INTO user_vacancy_interaction_events VALUES (?,?,?,?,?,NULL)").run("event","legacy","APPLIED","2026-11-16","2026-11-16");
    const canonical=db.prepare("SELECT * FROM canonical_vacancies").all();
    const history=db.prepare("SELECT * FROM user_vacancy_interaction_events").all();
    const old=db.prepare("SELECT * FROM schema_migrations").all();
    migrateDatabase(db);migrateDatabase(db);
    expect(db.prepare("SELECT * FROM schema_migrations WHERE version<=11").all()).toEqual(old);
    expect(db.prepare("SELECT count(*) n FROM schema_migrations WHERE version=12").get()).toEqual({n:1});
    expect(db.prepare("SELECT count(*) n FROM schema_migrations WHERE version=13").get()).toEqual({n:1});
    expect(db.prepare("SELECT * FROM vacancy_notes").all()).toEqual([]);
    expect(db.pragma("foreign_key_check")).toEqual([]);
    expect(db.prepare("SELECT * FROM canonical_vacancies").all()).toEqual(canonical);
    expect(db.prepare("SELECT * FROM user_vacancy_interaction_events").all()).toEqual(history);
    expect(await new SqliteVacancyCrmRepository(db).get("legacy")).toEqual({priority:"NONE",notes:[],processState:"DISCOVERED",processTransitions:[]});
  });
  it("serves explicit CRM commands and rejects invalid HTTP payloads",async()=>{
    const x=await setup();
    const server=createBrowserCaptureServer({
      captureAndProcessBrowserVacancy:vi.fn(),
      getVacancyReview:x.workflow.getVacancyReview,
      setVacancyPriority:x.workflow.setVacancyPriority,
      addVacancyNote:x.workflow.addVacancyNote,
      setVacancyProcessState:x.workflow.setVacancyProcessState
    });
    await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));
    const root="http://127.0.0.1:"+(server.address() as AddressInfo).port;
    const post=(path:string,body:unknown)=>fetch(root+path,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
    const path="/vacancies/"+x.first.id+"/crm/";
    try {
      expect((await post(path+"priority",{priority:"HIGH"})).status).toBe(200);
      const result=await post(path+"notes",{requestId:"http-note",text:"Private note"});
      expect(result.status).toBe(201);
      expect((await result.json()).review.crm).toMatchObject({priority:"HIGH",notes:[{text:"Private note",createdAt:"2026-11-17T12:00:00.000Z"}]});
      expect((await post(path+"notes",{requestId:"http-note",text:"Different"})).status).toBe(409);
      expect((await post(path+"notes",{requestId:"empty",text:" "})).status).toBe(400);
      expect((await post(path+"notes",{requestId:"extra",text:"No",createdAt:"forged"})).status).toBe(400);
      expect((await post(path+"priority",{priority:"URGENT"})).status).toBe(400);
      const stateBody={requestId:"http-process",state:"APPLIED"};
      const processResult=await post(path+"process-state",stateBody);
      expect(processResult.status).toBe(200);
      expect((await processResult.json()).review.crm).toMatchObject({
        processState:"APPLIED",
        processTransitions:[{id:"http-process",fromState:"DISCOVERED",toState:"APPLIED",createdAt:"2026-11-17T12:00:00.000Z"}],
      });
      expect((await post(path+"process-state",stateBody)).status).toBe(200);
      expect((await post(path+"process-state",{requestId:"http-process",state:"REJECTED"})).status).toBe(409);
      expect((await post(path+"process-state",{requestId:"bad-state",state:"UNKNOWN"})).status).toBe(400);
      expect((await post(path+"process-state",{requestId:"extra",state:"OFFER",fromState:"APPLIED"})).status).toBe(400);
      expect((await post("/vacancies/missing/crm/priority",{priority:"HIGH"})).status).toBe(404);
      const review=(await (await fetch(root+"/vacancies/"+x.first.id+"/review")).json()).review;
      expect(review.crm.notes).toHaveLength(1);
      expect(review.crm.processTransitions).toHaveLength(1);
      expect(review.user.currentState).toBe("NEW");
      expect(x.db.prepare("SELECT count(*) n FROM user_vacancy_interaction_events").get()).toEqual({n:0});
    } finally {await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}
  });

  it("defaults to neutral without creating records, validates commands and exposes Review state",async()=>{
    const x=await setup();
    expect(await x.crm.get(x.first.id)).toEqual({priority:"NONE",notes:[],processState:"DISCOVERED",processTransitions:[]});
    expect(x.db.prepare("SELECT count(*) n FROM vacancy_crm_priority").get()).toEqual({n:0});
    expect(x.db.prepare("SELECT count(*) n FROM vacancy_crm_process_state").get()).toEqual({n:0});
    for(const priority of ["LOW","NORMAL","HIGH","NONE"] as const)
      expect((await x.workflow.setVacancyPriority({canonicalVacancyId:x.first.id,priority})).crm?.priority).toBe(priority);
    await expect(x.crm.setPriority(x.first.id,"INVALID" as never)).rejects.toThrow();
    await expect(x.crm.setPriority("missing","HIGH")).rejects.toThrow();
    await expect(x.workflow.addVacancyNote({canonicalVacancyId:x.first.id,requestId:"blank",text:"  "})).rejects.toThrow();
  });
  it("records explicit process transitions separately with retry-safe request identities",async()=>{
    const x=await setup();
    x.event("APPLIED");
    const interactionView=await x.workflow.getVacancyReview(x.first.id);
    expect(interactionView.user.currentState).toBe("APPLIED");
    expect(interactionView.crm?.processState).toBe("DISCOVERED");
    const first={canonicalVacancyId:x.first.id,requestId:"process-one",state:"REVIEWING" as const,createdAt:new Date("2026-11-16T12:00:00Z")};
    await x.crm.setProcessState(first);
    await x.crm.setProcessState(first);
    await x.crm.setProcessState({...first,requestId:"process-noop",createdAt:new Date("2026-11-17T12:00:00Z")});
    await x.crm.setProcessState({...first,requestId:"process-two",state:"APPLIED",createdAt:new Date("2026-11-18T12:00:00Z")});
    const state=await x.crm.get(x.first.id);
    expect(state.processState).toBe("APPLIED");
    expect((await x.workflow.getVacancyReview(x.first.id)).user.currentState).toBe("APPLIED");
    expect(state.processTransitions.map(({fromState,toState})=>[fromState,toState])).toEqual([
      ["DISCOVERED","REVIEWING"],["REVIEWING","APPLIED"],
    ]);
    expect(state.processTransitions.map(t=>t.id)).toEqual(["process-one","process-two"]);
    await x.crm.setProcessState(first);
    expect((await x.crm.get(x.first.id)).processState).toBe("APPLIED");
    await expect(x.crm.setProcessState({...first,state:"OFFER"})).rejects.toThrow(/different change/);
    await expect(x.crm.setProcessState({...first,requestId:" ",state:"OFFER"})).rejects.toThrow();
    await expect(x.crm.setProcessState({...first,requestId:"bad-date",createdAt:new Date("invalid")})).rejects.toThrow();
    expect(()=>x.db.prepare("UPDATE vacancy_process_transitions SET to_state='OFFER'").run()).toThrow(/append-only/);
    expect(()=>x.db.prepare("DELETE FROM vacancy_process_transitions").run()).toThrow(/cleanup/);
    expect(()=>x.db.prepare("DELETE FROM vacancy_crm_process_state").run()).toThrow(/cleanup/);
  });
  it("keeps chronological append-only notes and makes retries idempotent",async()=>{
    const x=await setup();
    const note={id:"later",canonicalVacancyId:x.first.id,text:"Later",createdAt:new Date("2026-11-17")};
    await x.crm.addNote(note);
    await x.crm.addNote({...note,id:"earlier",text:"Earlier",createdAt:new Date("2026-11-16")});
    await x.crm.addNote({...note,createdAt:new Date("2026-11-18")});
    expect((await x.crm.get(x.first.id)).notes.map(n=>n.text)).toEqual(["Earlier","Later"]);
    expect((await x.crm.get(x.first.id)).notes[1]?.createdAt).toEqual(note.createdAt);
    await expect(x.crm.addNote({...note,text:"Changed"})).rejects.toThrow();
    expect(()=>x.db.prepare("UPDATE vacancy_notes SET text='rewrite'").run()).toThrow(/append-only/);
    expect(()=>x.db.prepare("DELETE FROM vacancy_notes").run()).toThrow(/cleanup/);
  });
  it("preserves private state through recapture/archive/restore without changing evidence or employer",async()=>{
    const x=await setup();
    const before=await x.workflow.getVacancyReview(x.first.id);
    const sources=x.db.prepare("SELECT * FROM source_observations").all();
    await x.workflow.setVacancyPriority({canonicalVacancyId:x.first.id,priority:"HIGH"});
    const view=await x.workflow.addVacancyNote({canonicalVacancyId:x.first.id,requestId:"note",text:"Private employer poison must not become evidence"});
    const processView=await x.workflow.setVacancyProcessState({canonicalVacancyId:x.first.id,requestId:"progress",state:"PLANNED_TO_APPLY"});
    expect(view.crm?.notes[0]?.text).toContain("Private employer");
    expect(processView.crm?.processState).toBe("PLANNED_TO_APPLY");
    expect(processView.employer).toEqual(before.employer);
    expect(processView.user).toEqual(before.user);
    expect(x.db.prepare("SELECT * FROM source_observations").all()).toEqual(sources);
    x.archive();
    const next=await x.capture(html.replaceAll("Manufacturing Engineer (m/f/d)","Updated Engineer (m/f/d)"));
    expect(next.id).toBe(x.first.id);
    expect(next.source).not.toBe(x.first.source);
    x.service.setArchived(x.first.id,false,x.service.state(x.first.id).token);
    expect((await x.workflow.getVacancyReview(x.first.id)).crm).toEqual(processView.crm);
  });
  it("isolates separate vacancies",async()=>{
    const x=await setup();
    const second=await x.capture(html.replaceAll("4964827101","4964827102"),payload.pageUrl.replace("4964827101","4964827102"));
    expect(second.id).not.toBe(x.first.id);
    await x.crm.setPriority(x.first.id,"HIGH");
    await x.crm.addNote({id:"private",canonicalVacancyId:x.first.id,text:"Only first",createdAt:new Date()});
    await x.crm.setProcessState({canonicalVacancyId:x.first.id,requestId:"first-progress",state:"REVIEWING",createdAt:new Date()});
    expect(await x.crm.get(second.id)).toEqual({priority:"NONE",notes:[],processState:"DISCOVERED",processTransitions:[]});
    await x.crm.setPriority(second.id,"LOW");
    await x.crm.addNote({id:"second",canonicalVacancyId:second.id,text:"Only second",createdAt:new Date()});
    await x.crm.setProcessState({canonicalVacancyId:second.id,requestId:"second-progress",state:"APPLIED",createdAt:new Date()});
    expect((await x.crm.get(x.first.id)).priority).toBe("HIGH");
    expect((await x.crm.get(x.first.id)).notes.map(n=>n.text)).toEqual(["Only first"]);
    expect((await x.crm.get(second.id)).notes.map(n=>n.text)).toEqual(["Only second"]);
    expect((await x.crm.get(x.first.id)).processState).toBe("REVIEWING");
    expect((await x.crm.get(second.id)).processState).toBe("APPLIED");
  });
  it("retains CRM on capture deletion and includes it in guarded whole deletion",async()=>{
    const x=await setup();
    await x.capture(html.replaceAll("Manufacturing Engineer (m/f/d)","Updated Engineer (m/f/d)"));
    await x.crm.setPriority(x.first.id,"HIGH");
    await x.crm.addNote({id:"n",canonicalVacancyId:x.first.id,text:"Keep",createdAt:new Date()});
    await x.workflow.setVacancyProcessState({canonicalVacancyId:x.first.id,requestId:"retain-progress",state:"INTERVIEWING"});
    const state=await x.crm.get(x.first.id);
    x.archive();
    await x.remove(x.first.source);
    expect(await x.crm.get(x.first.id)).toEqual(state);
    expect(x.service.preview(x.first.id).affected).toContainEqual({label:"Private CRM process-state records removed",count:1});
    expect(x.service.preview(x.first.id).affected).toContainEqual({label:"Private CRM process transitions removed",count:1});
    x.event("APPLIED");
    await expect(x.remove()).rejects.toThrow(/Acknowledge/);
    await x.remove(undefined,true);
    expect(x.db.prepare("SELECT * FROM vacancy_notes").all()).toEqual([]);
    expect(x.db.prepare("SELECT * FROM vacancy_crm_priority").all()).toEqual([]);
    expect(x.db.prepare("SELECT * FROM vacancy_crm_process_state").all()).toEqual([]);
    expect(x.db.prepare("SELECT * FROM vacancy_process_transitions").all()).toEqual([]);
    expect(x.db.pragma("foreign_key_check")).toEqual([]);
  });
  it("invalidates cleanup approval after private state changes",async()=>{
    const x=await setup();x.archive();
    const token=x.service.preview(x.first.id).token;
    await x.workflow.setVacancyProcessState({canonicalVacancyId:x.first.id,requestId:"state-change",state:"APPLIED"});
    await expect(x.service.delete({canonicalVacancyId:x.first.id,token,confirmation:"DELETE",acknowledgeApplicationHistory:false})).rejects.toThrow(/changed/);
    const next=x.service.preview(x.first.id).token;
    await x.crm.setPriority(x.first.id,"HIGH");
    expect(x.service.preview(x.first.id).token).not.toBe(next);
  });
});
