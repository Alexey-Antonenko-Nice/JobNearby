import {afterEach,it,expect} from "vitest";
import {readFileSync} from "node:fs";
import {createDatabase} from "../../src/infrastructure/database/createDatabase.js";
import {createCaptureProcessingRuntime} from "../../src/infrastructure/runtime/createCaptureProcessingRuntime.js";
import {SqliteVacancyCrmRepository} from "../../src/infrastructure/persistence/SqliteVacancyCrmRepository.js";
import {SqliteDailyWorkQueue} from "../../src/infrastructure/persistence/SqliteDailyWorkQueue.js";
import {SqliteVacancyCleanup} from "../../src/infrastructure/persistence/SqliteVacancyCleanup.js";
import {ContactLibrary} from "../../src/application/user/ContactLibrary.js";
import {SqliteContactRepository} from "../../src/infrastructure/persistence/SqliteContactRepository.js";
const dbs:ReturnType<typeof createDatabase>[]=[];afterEach(()=>dbs.splice(0).forEach(d=>d.close()));
const old=new Date("2026-11-01T12:00:00.000Z"),now=new Date("2026-11-19T12:00:00.000Z");
async function setup(){const db=createDatabase(":memory:");dbs.push(db);const runtime=createCaptureProcessingRuntime(db);const html=readFileSync("tests/fixtures/greenhouseSelectedVacancy.html","utf8");const capture=()=>runtime.captureAndProcessBrowserVacancy({pageUrl:"https://job-boards.eu.greenhouse.io/agilerobotsse/jobs/4964827101",pageTitle:"Job",html,visibleText:"Job",capturedAt:old.toISOString()});const result=await capture();if(result.processing.status!=="PROCESSED")throw Error("capture");const id=result.processing.canonicalVacancyId,crm=new SqliteVacancyCrmRepository(db);await crm.setProcessState({canonicalVacancyId:id,requestId:"process",state:"AWAITING_RESPONSE",createdAt:old});const reader=new SqliteDailyWorkQueue(db),read=()=>reader.get({now,timeZone:"Europe/Paris"});return {db,id,crm,capture,read};}
it("batch snapshot resolves title/company and reads without modifying any tables",async()=>{const x=await setup();x.db.prepare("INSERT INTO canonical_vacancy_organization_relationships(canonical_vacancy_id,relationship_order,raw_name,role,derivation_algorithm,derivation_algorithm_version,derived_at) VALUES(?,999,'Test company','DISPLAYED_COMPANY','test','1',?)").run(x.id,old.toISOString());const before=x.db.serialize();const q=x.read();expect(q.items[0]?.category).toBe("AWAITING_RESPONSE_STALE");expect(q.items[0]?.title).toBeTruthy();expect(q.items[0]?.company).toBeTruthy();expect(x.db.serialize()).toEqual(before);});
it("recapture cannot reset private staleness; archive/restore preserves queue",async()=>{const x=await setup(),before=x.read();await x.capture();expect(x.read()).toEqual(before);const cleanup=new SqliteVacancyCleanup(x.db);cleanup.setArchived(x.id,true,cleanup.state(x.id).token);expect(x.read().items).toEqual([]);cleanup.setArchived(x.id,false,cleanup.state(x.id).token);expect(x.read()).toEqual(before);});
it.each(["note","interaction","transition","action","contact"])("recent %s resets staleness",async kind=>{const x=await setup();if(kind==="note")await x.crm.addNote({id:"n",canonicalVacancyId:x.id,text:"Note",createdAt:now});if(kind==="interaction")x.db.prepare("INSERT INTO user_vacancy_interaction_events VALUES(?,?,?,?,?,NULL)").run("e",x.id,"CONTACTED",now.toISOString(),now.toISOString());if(kind==="transition"){await x.crm.setProcessState({canonicalVacancyId:x.id,requestId:"p2",state:"APPLIED",createdAt:now});await x.crm.setProcessState({canonicalVacancyId:x.id,requestId:"p3",state:"AWAITING_RESPONSE",createdAt:now});}if(kind==="action"){await x.crm.changeNextAction({canonicalVacancyId:x.id,kind:"CREATE",actionId:"a",requestId:"a",description:"Call",dueAt:null},old);await x.crm.changeNextAction({canonicalVacancyId:x.id,kind:"COMPLETE",actionId:"a",requestId:"done"},now);}if(kind==="contact"){const lib=new ContactLibrary(new SqliteContactRepository(x.db),()=>now);const c=lib.execute({operation:"CREATE",requestId:"c",displayName:"Person",jobTitle:"",notes:""});lib.execute({operation:"LINK",requestId:"link",contactId:c,canonicalVacancyId:x.id,role:"RECRUITER"});}expect(x.read().items[0]?.category).toBe("ACTIVE_WITHOUT_NEXT_ACTION");expect(x.read().items[0]?.lastActivityAt).toEqual(now);});
it("batch actions retain contact, reschedule and reminder semantics",async()=>{const x=await setup();const lib=new ContactLibrary(new SqliteContactRepository(x.db),()=>old);const c=lib.execute({operation:"CREATE",requestId:"c",displayName:"Person",jobTitle:"",notes:""});lib.execute({operation:"LINK",requestId:"link",contactId:c,canonicalVacancyId:x.id,role:"RECRUITER"});await x.crm.changeNextAction({canonicalVacancyId:x.id,kind:"CREATE",actionId:"a",requestId:"a",description:"Call",dueAt:null,contactId:c},old);await x.crm.changeNextAction({canonicalVacancyId:x.id,kind:"SET_REMINDER",actionId:"a",requestId:"r",remindAt:old.toISOString()},old);const item=x.read().items[0]!;expect(item.category).toBe("REMINDER_DUE");expect(item.action?.contact?.displayName).toBe("Person");lib.execute({operation:"ARCHIVE",requestId:"archive",contactId:c});expect(x.read().items[0]?.lastActivityAt).toEqual(old);expect(x.read().items[0]?.action?.contact?.archived).toBe(true);});
it("document selection counts as private activity",async()=>{
 const x=await setup();
 x.db.prepare("INSERT INTO application_documents(id,kind,name,created_at) VALUES('doc','CV','CV',?)").run(old.toISOString());
 x.db.prepare("INSERT INTO application_document_versions(id,document_id,version_number,original_file_name,size_bytes,content_hash,storage_key,created_at,request_id,request_fingerprint) VALUES('version','doc',1,'cv.pdf',1,?,'doc/version/file',?,'import','fingerprint')").run('a'.repeat(64),old.toISOString());
 x.db.prepare("INSERT INTO vacancy_application_documents VALUES('selection',?,'version',?)").run(x.id,now.toISOString());
 expect(x.read().items[0]?.lastActivityAt).toEqual(now);
 expect(x.read().items[0]?.category).toBe("ACTIVE_WITHOUT_NEXT_ACTION");
});
import type {AddressInfo} from "node:net";
import {createBrowserCaptureServer} from "../../src/infrastructure/http/createBrowserCaptureServer.js";
it("HTTP read validates timezone and serializes queue without mutations",async()=>{
 const x=await setup();const server=createBrowserCaptureServer({captureAndProcessBrowserVacancy:async()=>{throw Error("unused");},getDailyWorkQueue:timeZone=>new SqliteDailyWorkQueue(x.db).get({now,timeZone})});
 await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));
 try {const base="http://127.0.0.1:"+(server.address() as AddressInfo).port;const before=x.db.serialize();const response=await fetch(base+"/work-queue?timeZone=Europe%2FParis");expect(response.status).toBe(200);expect((await response.json()).items[0].category).toBe("AWAITING_RESPONSE_STALE");expect((await fetch(base+"/work-queue?timeZone=invalid")).status).toBe(400);expect(x.db.serialize()).toEqual(before);}finally{await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()));}
});
import {createVacancyReviewWorkflow} from "../../src/application/user/createVacancyReviewWorkflow.js";
import {SqliteCanonicalVacancyRepository} from "../../src/infrastructure/persistence/SqliteCanonicalVacancyRepository.js";
import {SqliteSourceObservationRepository} from "../../src/infrastructure/persistence/SqliteSourceObservationRepository.js";
import {SqliteEmployerClusterRepository} from "../../src/infrastructure/persistence/SqliteEmployerClusterRepository.js";
import {SqliteEmployerMemoryPublicDataSource} from "../../src/infrastructure/persistence/SqliteEmployerMemoryPublicDataSource.js";
import {SqliteUserVacancyInteractionRepository} from "../../src/infrastructure/persistence/SqliteUserVacancyInteractionRepository.js";
function commands(x:Awaited<ReturnType<typeof setup>>){return createVacancyReviewWorkflow({crmRepository:x.crm,canonicalVacancyRepository:new SqliteCanonicalVacancyRepository(x.db),sourceObservationRepository:new SqliteSourceObservationRepository(x.db),employerClusterRepository:new SqliteEmployerClusterRepository(x.db),employerMemoryPublicDataSource:new SqliteEmployerMemoryPublicDataSource(x.db),interactionRepository:new SqliteUserVacancyInteractionRepository(x.db),now:()=>now});}
async function pending(x:Awaited<ReturnType<typeof setup>>,dueAt:string|null=old.toISOString(),id="a"){
 await x.crm.changeNextAction({canonicalVacancyId:x.id,kind:"CREATE",actionId:id,requestId:id,description:"Follow up",dueAt},old);
 return {canonicalVacancyId:x.id,actionId:id,requestId:"command-"+id};
}
it.each(["complete","cancel"] as const)("%s existing command reclassifies and retries without duplicate history",async operation=>{
 const x=await setup(),target=await pending(x),workflow=commands(x);
 const before=x.read();expect(before.counts.OVERDUE_ACTION).toBe(1);
 const command=operation==="complete"?workflow.completeVacancyNextAction:workflow.cancelVacancyNextAction;
 await command(target);await command(target);
 const after=x.read();expect(after.counts.OVERDUE_ACTION).toBe(0);expect(after.items[0]?.category).toBe("ACTIVE_WITHOUT_NEXT_ACTION");expect(after.items[0]?.lastActivityAt).toEqual(now);
 expect((await x.crm.getNextActions(x.id))[0]?.changes).toHaveLength(2);
 await expect(command({...target,requestId:"stale"})).rejects.toThrow(/already completed or cancelled/);
 await expect((operation==="complete"?workflow.cancelVacancyNextAction:workflow.completeVacancyNextAction)(target)).rejects.toThrow(/already used/);
});
it.each(["complete","cancel"] as const)("%s last action exposes high priority without changing private/public data",async operation=>{
 const x=await setup();await x.crm.setPriority(x.id,"HIGH");const target=await pending(x),workflow=commands(x);
 const tables=(x.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all() as {name:string}[]).map(r=>r.name).filter(n=>n!=="vacancy_action_changes");
 const snapshot=()=>Object.fromEntries(tables.map(t=>[t,x.db.prepare('SELECT * FROM "'+t+'"').all()]));const before=snapshot();
 await (operation==="complete"?workflow.completeVacancyNextAction:workflow.cancelVacancyNextAction)(target);
 expect(x.read().items[0]?.category).toBe("HIGH_PRIORITY_NO_ACTION");expect(snapshot()).toEqual(before);
 expect((x.db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as {name:string}[]).some(r=>/today|dashboard|queue/.test(r.name))).toBe(false);
});
it.each([null,old.toISOString(),"2026-11-21T12:00:00.000Z",now.toISOString()])("dismiss reminder preserves underlying action classification for due %s",async due=>{
 const x=await setup(),target=await pending(x,due),workflow=commands(x);
 await x.crm.changeNextAction({...target,kind:"SET_REMINDER",requestId:"reminder",remindAt:old.toISOString()},old);
 expect(x.read().items[0]?.action?.dismissibleReminderId).toBe("reminder");
 const input={...target,reminderId:"reminder"};await workflow.dismissVacancyActionReminder(input);await workflow.dismissVacancyActionReminder(input);
 const q=x.read();expect(q.items[0]?.action?.dismissibleReminderId).toBeUndefined();
 expect(q.items.map(i=>i.category)).toEqual(due===null?[]:[due===old.toISOString()?"OVERDUE_ACTION":due===now.toISOString()?"DUE_TODAY":"UPCOMING_ACTION"]);
 const action=(await x.crm.getNextActions(x.id))[0]!;expect(action.completedAt).toBeNull();expect(action.dueAt?.toISOString()??null).toBe(due);expect(action.changes.filter(c=>c.kind==="DISMISS_REMINDER")).toHaveLength(1);
 expect((await x.crm.get(x.id)).processState).toBe("AWAITING_RESPONSE");
 await expect(workflow.dismissVacancyActionReminder({...input,requestId:"stale"})).rejects.toThrow(/no longer active/);
 await expect(workflow.dismissVacancyActionReminder({...input,reminderId:"different"})).rejects.toThrow(/already used/);
});
it("other actions retain IDs; archive race follows existing commands and hides vacancy",async()=>{
 const x=await setup(),target=await pending(x);await pending(x,old.toISOString(),"b");
 x.db.prepare("INSERT INTO canonical_vacancies(id,canonicalization_status,derivation_algorithm,derivation_algorithm_version,derived_at,created_at,updated_at) SELECT 'unrelated',canonicalization_status,derivation_algorithm,derivation_algorithm_version,derived_at,created_at,updated_at FROM canonical_vacancies WHERE id=?").run(x.id);
 const unrelated=x.read().items.find(i=>i.vacancyId==="unrelated");const before=x.read().items.find(i=>i.action?.id==="b");await commands(x).completeVacancyNextAction(target);
 const after=x.read().items.find(i=>i.action?.id==="b");expect(x.read().items.find(i=>i.vacancyId==="unrelated")).toEqual(unrelated);expect(after?.id).toBe(before?.id);expect(after?.action).toEqual(before?.action);
 const cleanup=new SqliteVacancyCleanup(x.db);cleanup.setArchived(x.id,true,cleanup.state(x.id).token);
 await commands(x).cancelVacancyNextAction({canonicalVacancyId:x.id,actionId:"b",requestId:"cancel-b"});expect(x.read().items.filter(i=>i.vacancyId===x.id)).toEqual([]);expect(cleanup.state(x.id).archived).toBe(true);
});
