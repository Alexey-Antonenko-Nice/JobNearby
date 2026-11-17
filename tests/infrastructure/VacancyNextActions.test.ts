import { migration012 } from "../../src/infrastructure/database/migrations/012_vacancy_crm.js";
import { migration013 } from "../../src/infrastructure/database/migrations/013_vacancy_process_state.js";
import { migration011 } from "../../src/infrastructure/database/migrations/011_vacancy_cleanup.js";
import { SqliteVacancyCrmRepository } from "../../src/infrastructure/persistence/SqliteVacancyCrmRepository.js";
import { createVacancyReviewWorkflow } from "../../src/application/user/createVacancyReviewWorkflow.js";
import { SqliteEmployerClusterRepository } from "../../src/infrastructure/persistence/SqliteEmployerClusterRepository.js";
import { SqliteEmployerMemoryPublicDataSource } from "../../src/infrastructure/persistence/SqliteEmployerMemoryPublicDataSource.js";
import { SqliteUserVacancyInteractionRepository } from "../../src/infrastructure/persistence/SqliteUserVacancyInteractionRepository.js";
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
  let clock=new Date("2026-11-17T12:00:00.000Z");
  const workflow = createVacancyReviewWorkflow({
    crmRepository:crm, canonicalVacancyRepository:repo,
    sourceObservationRepository:new SqliteSourceObservationRepository(db),
    interactionRepository:new SqliteUserVacancyInteractionRepository(db),
    employerClusterRepository:new SqliteEmployerClusterRepository(db),
    employerMemoryPublicDataSource:new SqliteEmployerMemoryPublicDataSource(db),
    now:()=>clock
  });
  const target=(requestId:string,actionId="action")=>({canonicalVacancyId:first.id,actionId,requestId});
  const create=(requestId="action",dueAt:string|null=null)=>workflow.createVacancyNextAction({canonicalVacancyId:first.id,requestId,description:"Send follow-up",dueAt});
  const view=async()=> (await workflow.getVacancyReview(first.id)).nextActions!;
  return { db, capture, first, service, repo, archive, remove, event, crm, workflow, target, create, view, clock:(value:string)=>{clock=new Date(value);} };
}


describe("Vacancy next actions and reminders",()=>{
  it("migrates populated version 13 without changing CRM or captured data",async()=>{
    const db=versionEightDatabase();databases.push(db);
    for(const m of [migration009,migration010,migration011,migration012,migration013]) {
      m.up(db);db.prepare("INSERT INTO schema_migrations VALUES (?,?,?)").run(m.version,m.name,"2026-11-17");
    }
    db.prepare("INSERT INTO canonical_vacancies VALUES (?,?,?,?,?,?,?)").run("legacy","PARTIAL","test","1","2026-11-16","2026-11-16","2026-11-16");
    const crm=new SqliteVacancyCrmRepository(db);
    await crm.setPriority("legacy","HIGH");
    await crm.addNote({id:"n",canonicalVacancyId:"legacy",text:"Retain",createdAt:new Date("2026-11-17")});
    await crm.setProcessState({canonicalVacancyId:"legacy",requestId:"p",state:"APPLIED",createdAt:new Date("2026-11-17")});
    const before=await crm.get("legacy");
    migrateDatabase(db);migrateDatabase(db);
    expect(await crm.get("legacy")).toEqual(before);
    expect(await crm.getNextActions("legacy")).toEqual([]);
    expect(db.prepare("SELECT count(*) n FROM schema_migrations WHERE version=14").get()).toEqual({n:1});
    expect(db.pragma("foreign_key_check")).toEqual([]);
  });
  it("creates multiple isolated actions with optional due times and retry-safe identity",async()=>{
    const x=await setup();
    await x.create();await x.create();await x.create("second","2026-11-20T09:00:00.000Z");
    expect((await x.view()).actions.map(a=>[a.id,a.status,a.dueState])).toEqual([["action","ACTIVE","NONE"],["second","ACTIVE","UPCOMING"]]);
    const other=await x.capture(html.replaceAll("4964827101","4964827102"),payload.pageUrl.replace("4964827101","4964827102"));
    expect(await x.crm.getNextActions(other.id)).toEqual([]);
    await expect(x.workflow.completeVacancyNextAction({...x.target("bad"),canonicalVacancyId:other.id})).rejects.toThrow(/belong/);
    await expect(x.create("action","2026-11-20T09:00:00.000Z")).rejects.toThrow(/already used/);
    expect((await x.view()).actions).toHaveLength(2);
  });
  it("derives exact due and overdue boundaries without writes",async()=>{
    const x=await setup();await x.create("action","2026-11-17T12:00:00.000Z");
    expect((await x.view()).actions[0]?.dueState).toBe("DUE");
    x.clock("2026-11-17T12:00:00.001Z");
    expect((await x.view()).overdueCount).toBe(1);
    x.clock("2026-11-17T11:59:59.999Z");
    expect((await x.view()).actions[0]?.dueState).toBe("UPCOMING");
    expect(x.db.prepare("SELECT * FROM vacancy_action_changes").all()).toEqual([]);
  });
  it.each(["complete","cancel"] as const)("preserves %s history and retries without duplicate changes",async kind=>{
    const x=await setup();await x.create("action","2026-11-16T09:00:00.000Z");
    await x.workflow.setVacancyActionReminder({...x.target("reminder"),remindAt:"2026-11-16T08:00:00.000Z"});
    const command=kind==="complete"?x.workflow.completeVacancyNextAction:x.workflow.cancelVacancyNextAction;
    await command(x.target("finish"));x.clock("2026-11-18T12:00:00.000Z");await command(x.target("finish"));
    const result=await x.view(), action=result.actions[0]!;
    expect(action.status).toBe(kind==="complete"?"COMPLETED":"CANCELLED");
    expect(action.dueAt).toEqual(new Date("2026-11-16T09:00:00.000Z"));
    expect(action.completedAt??action.cancelledAt).toEqual(new Date("2026-11-17T12:00:00.000Z"));
    expect(action.reminderDue).toBe(false);expect(result.overdueCount).toBe(0);
    expect(action.changes).toHaveLength(3);
    await expect(command(x.target("another-finish"))).rejects.toThrow(/already completed or cancelled/);
    await expect(x.workflow.rescheduleVacancyNextAction({...x.target("late-change"),dueAt:null})).rejects.toThrow();
    expect(x.service.state(x.first.id).archived).toBe(false);
  });
  it("reschedules explicitly, retains original due history and allows clearing",async()=>{
    const x=await setup();await x.create("action","2026-11-20T12:00:00.000Z");
    const change={...x.target("reschedule"),dueAt:"2026-11-22T12:00:00.000Z"};
    await x.workflow.rescheduleVacancyNextAction(change);
    await x.workflow.rescheduleVacancyNextAction(change);
    await x.workflow.rescheduleVacancyNextAction({...x.target("clear"),dueAt:null});
    const action=(await x.view()).actions[0]!;
    expect(action.dueAt).toBeNull();
    expect(action.changes.map(c=>c.dueAt?.toISOString()??null)).toEqual(["2026-11-20T12:00:00.000Z","2026-11-22T12:00:00.000Z",null]);
    // An old retry cannot restore an earlier schedule.
    await x.workflow.rescheduleVacancyNextAction(change);
    expect((await x.view()).actions[0]?.dueAt).toBeNull();
  });
  it("sets, replaces and dismisses reminders independently with durable retries",async()=>{
    const x=await setup();await x.create("action","2026-11-20T12:00:00.000Z");
    const request={...x.target("r1"),remindAt:"2026-11-18T09:00:00.000Z"};
    await x.workflow.setVacancyActionReminder(request);await x.workflow.setVacancyActionReminder(request);
    expect((await x.view()).actions[0]?.reminderDue).toBe(false);
    x.clock("2026-11-18T09:00:00.000Z");
    expect((await x.view()).actions[0]?.reminderDue).toBe(true);
    await x.workflow.setVacancyActionReminder({...x.target("r2"),remindAt:"2026-11-19T09:00:00.000Z"});
    expect((await x.view()).actions[0]?.reminderDue).toBe(false);
    const dismissal={...x.target("dismiss"),reminderId:"r2"};
    await x.workflow.dismissVacancyActionReminder(dismissal);await x.workflow.dismissVacancyActionReminder(dismissal);
    await x.workflow.setVacancyActionReminder(request); // old retry does not reactivate r1
    x.clock("2026-11-21T09:00:00.000Z");
    const action=(await x.view()).actions[0]!;
    expect(action.reminderDue).toBe(false);expect(action.reminders).toHaveLength(2);
    expect(action.reminders[0]?.supersededAt).not.toBeNull();
    expect(action.reminders[1]?.dismissedAt).not.toBeNull();
    expect(action.dueAt?.toISOString()).toBe("2026-11-20T12:00:00.000Z");
  });
  it("rejects invalid times, descriptions, reminder ownership and cross-command request reuse",async()=>{
    const x=await setup();
    for(const due of ["2026-11-20T09:00","2026-02-30T09:00:00.000Z","invalid"])
      await expect(x.create("invalid",due)).rejects.toThrow(/UTC/);
    await expect(x.workflow.createVacancyNextAction({canonicalVacancyId:x.first.id,requestId:"bad",description:" ",dueAt:null})).rejects.toThrow();
    await x.create();
    await expect(x.workflow.completeVacancyNextAction(x.target("action"))).rejects.toThrow(/already used/);
    await expect(x.workflow.dismissVacancyActionReminder({...x.target("bad-reminder"),reminderId:"unowned"})).rejects.toThrow(/no longer active/);
    expect(()=>x.db.prepare("UPDATE vacancy_next_actions SET description='mutate'").run()).toThrow(/append-only/);
    expect(()=>x.db.prepare("DELETE FROM vacancy_next_actions").run()).toThrow(/guarded/);
  });
  it("preserves actions through recapture/archive and leaves priority/notes/process/employer/evidence unchanged",async()=>{
    const x=await setup();
    await x.workflow.setVacancyPriority({canonicalVacancyId:x.first.id,priority:"HIGH"});
    await x.workflow.addVacancyNote({canonicalVacancyId:x.first.id,requestId:"note",text:"Personal note"});
    await x.workflow.setVacancyProcessState({canonicalVacancyId:x.first.id,requestId:"process",state:"AWAITING_RESPONSE"});
    const before=await x.workflow.getVacancyReview(x.first.id);
    const sources=x.db.prepare("SELECT * FROM source_observations").all();
    await x.create();
    await x.workflow.setVacancyActionReminder({...x.target("reminder"),remindAt:"2026-11-16T09:00:00.000Z"});
    await x.create("finished");await x.workflow.completeVacancyNextAction(x.target("finish","finished"));
    await x.create("cancelled");await x.workflow.cancelVacancyNextAction(x.target("cancel","cancelled"));
    const saved=await x.view();
    const after=await x.workflow.getVacancyReview(x.first.id);
    expect(after.crm).toEqual(before.crm);expect(after.user).toEqual(before.user);expect(after.employer).toEqual(before.employer);
    expect(x.db.prepare("SELECT * FROM source_observations").all()).toEqual(sources);
    x.archive();
    expect(await x.view()).toEqual(saved);
    const next=await x.capture(html.replaceAll("Manufacturing Engineer (m/f/d)","Updated Engineer (m/f/d)"));
    expect(next.id).toBe(x.first.id);expect(next.source).not.toBe(x.first.source);
    x.service.setArchived(x.first.id,false,x.service.state(x.first.id).token);
    expect(await x.view()).toEqual(saved);
    expect((await x.workflow.getVacancyReview(x.first.id)).crm).toEqual(before.crm);
  });
  it("preserves single-capture cleanup, counts whole cleanup and invalidates every stale command approval",async()=>{
    const x=await setup();await x.capture(html.replaceAll("Manufacturing Engineer (m/f/d)","Updated Engineer (m/f/d)"));x.archive();
    const commands=[
      ()=>x.create(),
      ()=>x.workflow.setVacancyActionReminder({...x.target("r"),remindAt:"2026-11-19T12:00:00.000Z"}),
      ()=>x.workflow.rescheduleVacancyNextAction({...x.target("s"),dueAt:"2026-11-20T12:00:00.000Z"}),
      ()=>x.workflow.dismissVacancyActionReminder({...x.target("d"),reminderId:"r"}),
      ()=>x.workflow.completeVacancyNextAction(x.target("c"))
    ];
    for(const command of commands) {
      const token=x.service.preview(x.first.id).token;
      await command();
      await expect(x.service.delete({canonicalVacancyId:x.first.id,token,confirmation:"DELETE",acknowledgeApplicationHistory:false})).rejects.toThrow(/changed/);
    }
    const before=await x.view();await x.remove(x.first.source);expect(await x.view()).toEqual(before);
    expect(x.service.preview(x.first.id).affected).toEqual(expect.arrayContaining([
      {label:"Private CRM next actions removed",count:1},{label:"Private CRM action/reminder history removed",count:4}
    ]));
    await x.remove();
    expect(x.db.prepare("SELECT * FROM vacancy_next_actions").all()).toEqual([]);
    expect(x.db.prepare("SELECT * FROM vacancy_action_changes").all()).toEqual([]);
    expect(x.db.pragma("foreign_key_check")).toEqual([]);
  });
  it("exposes explicit HTTP commands and rejects unknown/timezone-naive fields",async()=>{
    const x=await setup();
    const server=createBrowserCaptureServer({captureAndProcessBrowserVacancy:vi.fn(),...x.workflow});
    await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));
    const root="http://127.0.0.1:"+(server.address() as AddressInfo).port+"/vacancies/"+x.first.id+"/crm/actions";
    const post=(path:string,body:unknown)=>fetch(root+path,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
    try {
      expect((await post("",{requestId:"action",description:"Follow up",dueAt:null})).status).toBe(201);
      expect((await post("/action/reminder",{requestId:"r",remindAt:"2026-11-16T09:00:00.000Z"})).status).toBe(200);
      const completed=await post("/action/complete",{requestId:"c"});
      expect((await completed.json()).review.nextActions.actions[0]).toMatchObject({status:"COMPLETED",reminderDue:false});
      expect((await post("",{requestId:"b",description:"Bad",dueAt:"2026-11-20T09:00"})).status).toBe(400);
      expect((await post("",{requestId:"b",description:"Bad",state:"APPLIED"})).status).toBe(400);
      expect((await post("/action/cancel",{requestId:"later"})).status).toBe(409);
    } finally {await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}
  });
});
