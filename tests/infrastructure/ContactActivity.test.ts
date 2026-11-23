import { SqliteVacancyCrmRepository } from "../../src/infrastructure/persistence/SqliteVacancyCrmRepository.js";
import { createVacancyReviewWorkflow } from "../../src/application/user/createVacancyReviewWorkflow.js";
import { SqliteEmployerClusterRepository } from "../../src/infrastructure/persistence/SqliteEmployerClusterRepository.js";
import { SqliteEmployerMemoryPublicDataSource } from "../../src/infrastructure/persistence/SqliteEmployerMemoryPublicDataSource.js";
import { SqliteUserVacancyInteractionRepository } from "../../src/infrastructure/persistence/SqliteUserVacancyInteractionRepository.js";
import { SqliteSourceObservationRepository } from "../../src/infrastructure/persistence/SqliteSourceObservationRepository.js";
import { createTestCaptureServer as createBrowserCaptureServer } from "../support/httpAuthorization.js";
import type { AddressInfo } from "node:net";
import { createDatabase } from "../../src/infrastructure/database/createDatabase.js";
import { createCaptureProcessingRuntime } from "../../src/infrastructure/runtime/createCaptureProcessingRuntime.js";
import { SqliteVacancyCleanup } from "../../src/infrastructure/persistence/SqliteVacancyCleanup.js";
import { SqliteCanonicalVacancyRepository } from "../../src/infrastructure/persistence/SqliteCanonicalVacancyRepository.js";
import { afterEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { ContactLibrary } from "../../src/application/user/ContactLibrary.js";
import { SqliteContactRepository } from "../../src/infrastructure/persistence/SqliteContactRepository.js";
import { migrateDatabase } from "../../src/infrastructure/database/migrateDatabase.js";

import type { ContactCommand } from "../../src/domain/user/Contact.js";

import { recordUserVacancyInteraction } from "../../src/application/user/recordUserVacancyInteraction.js";
import { deriveNextActions } from "../../src/domain/user/VacancyNextAction.js";
import type { RecordUserVacancyInteractionInput } from "../../src/application/user/recordUserVacancyInteraction.js";
const databases:ReturnType<typeof createDatabase>[]=[];
afterEach(()=>{for(const db of databases.splice(0))db.close();});
const at=new Date("2026-11-19T12:00:00.000Z");
const html=readFileSync("tests/fixtures/greenhouseSelectedVacancy.html","utf8");
async function setup(){
 const db=createDatabase(":memory:");databases.push(db);
 const runtime=createCaptureProcessingRuntime(db);
 const payload={pageUrl:"https://job-boards.eu.greenhouse.io/agilerobotsse/jobs/4964827101",pageTitle:"Job",visibleText:"Job",html,capturedAt:at.toISOString()};
 const capture=async(page=html)=>{const result=await runtime.captureAndProcessBrowserVacancy({...payload,html:page});if(result.processing.status!=="PROCESSED")throw Error("capture");return {id:result.processing.canonicalVacancyId,observationId:result.capture.observationId};};
 const first=await capture(),vacancyId=first.id;
 const library=new ContactLibrary(new SqliteContactRepository(db),()=>at);
 let sequence=0;
 const contact=(name="Person")=>library.execute({operation:"CREATE",requestId:"contact-"+(++sequence),displayName:name,jobTitle:"",notes:""});
 const link=(id:string)=>library.execute({operation:"LINK",requestId:"link-"+(++sequence),contactId:id,canonicalVacancyId:vacancyId,role:"RECRUITER"});
 const contactId=contact(),relationshipId=link(contactId);
 const repo=new SqliteUserVacancyInteractionRepository(db),crm=new SqliteVacancyCrmRepository(db),canonical=new SqliteCanonicalVacancyRepository(db);
 const deps={interactionRepository:repo,canonicalVacancyRepository:canonical,now:()=>at};
 const event=(contactId?:string,requestId="event")=>recordUserVacancyInteraction({canonicalVacancyId:vacancyId,type:"CONTACTED",requestId,...(contactId===undefined?{}:{contactId}),metadata:{direction:"INBOUND",contactMethod:"PHONE"}},deps);
 const action=(contactId?:string,requestId="action")=>crm.changeNextAction({canonicalVacancyId:vacancyId,kind:"CREATE",actionId:requestId,requestId,description:"Follow up",dueAt:at.toISOString(),...(contactId===undefined?{}:{contactId})},at);
 const archive=()=>library.execute({operation:"ARCHIVE",requestId:"archive",contactId});
 const end=()=>library.execute({operation:"END_LINK",requestId:"end",contactId,relationshipId});
 const workflow=createVacancyReviewWorkflow({...deps,contactLibrary:library,crmRepository:crm,sourceObservationRepository:new SqliteSourceObservationRepository(db),employerClusterRepository:new SqliteEmployerClusterRepository(db),employerMemoryPublicDataSource:new SqliteEmployerMemoryPublicDataSource(db)});
 return {db,library,repo,crm,deps,workflow,contact,link,event,action,archive,end,contactId,relationshipId,vacancyId,capture,first};
}
describe("Contact-linked activity",()=>{
 it("linked activity leaves recognition, process and document records unchanged",async()=>{
   const x=await setup();
   await x.workflow.setVacancyPriority({canonicalVacancyId:x.vacancyId,priority:"HIGH"});
   await x.workflow.addVacancyNote({canonicalVacancyId:x.vacancyId,requestId:"note",text:"Private note"});
   await x.workflow.setVacancyProcessState({canonicalVacancyId:x.vacancyId,requestId:"state",state:"APPLIED"});
   x.db.prepare("INSERT INTO application_documents VALUES('doc','CV','CV','2026-11-19')").run();
   x.db.prepare("INSERT INTO application_document_versions VALUES('version','doc',1,'cv.pdf',NULL,1,?,'documents/test/content','2026-11-19','import','hash')").run("a".repeat(64));
   x.db.prepare("INSERT INTO vacancy_application_documents VALUES('association',?,'version','2026-11-19')").run(x.vacancyId);
   const tables=["source_observations","canonical_vacancies","canonical_vacancy_exact_identity_claims","employer_clusters","observation_cluster_assignments","vacancy_organization_role_decisions","vacancy_crm_priority","vacancy_notes","vacancy_crm_process_state","vacancy_process_transitions","application_documents","application_document_versions","vacancy_application_documents"];
   const snapshot=()=>tables.map(t=>x.db.prepare("SELECT * FROM "+t).all());const before=snapshot();
   await x.event(x.contactId);await x.action(x.contactId);expect(snapshot()).toEqual(before);
 });
 it("rejects contact reassignment through action lifecycle commands",async()=>{const x=await setup();await x.action(x.contactId);await expect(x.crm.changeNextAction({kind:"COMPLETE",actionId:"action",canonicalVacancyId:x.vacancyId,requestId:"change",contactId:x.contactId} as never,at)).rejects.toThrow(/fixed at creation/);});

 it("old and new contactless events/actions remain readable",async()=>{const x=await setup();await x.event();await x.action();expect((await x.repo.findByCanonicalVacancyId(x.vacancyId))[0]!.contactId).toBeUndefined();expect((await x.crm.getNextActions(x.vacancyId))[0]!.contactId).toBeUndefined();});
 it("persists contact IDs and resolves current names centrally in Review",async()=>{const x=await setup();await x.event(x.contactId);await x.action(x.contactId);x.library.execute({operation:"UPDATE",requestId:"rename",contactId:x.contactId,displayName:"Current name",jobTitle:"",notes:""});const view=await x.workflow.getVacancyReview(x.vacancyId);expect(view.interactions![0]).toMatchObject({contactId:x.contactId,contact:{id:x.contactId,displayName:"Current name",archived:false}});expect(view.nextActions!.actions[0]!.contact).toMatchObject({displayName:"Current name"});});
 it.each(["missing","unrelated","archived","ended","malformed"])("rejects %s contacts on new interactions and actions",async kind=>{const x=await setup();let id=x.contactId;if(kind==="missing")id="missing";if(kind==="unrelated")id=x.contact();if(kind==="archived")x.archive();if(kind==="ended")x.end();if(kind==="malformed")id=" ";await expect(x.event(id)).rejects.toThrow();await expect(x.action(id)).rejects.toThrow();expect(await x.repo.findByCanonicalVacancyId(x.vacancyId)).toEqual([]);expect(await x.crm.getNextActions(x.vacancyId)).toEqual([]);expect(x.db.prepare("SELECT count(*) n FROM interaction_requests").get()).toEqual({n:0});});
 it("rejects contact links on reviewed/interested events without changing taxonomy",async()=>{const x=await setup();for(const type of ["REVIEWED","INTERESTED"] as const)await expect(recordUserVacancyInteraction({canonicalVacancyId:x.vacancyId,type,contactId:x.contactId},x.deps)).rejects.toThrow(/does not involve/);});
 it("interaction retry keeps original ID/timestamps after contact archival and relationship ending",async()=>{const x=await setup();const first=await x.event(x.contactId);x.archive();x.end();const retry=await x.event(x.contactId);expect(retry.event.id).toBe(first.event.id);expect(retry.event.recordedAt).toEqual(first.event.recordedAt);expect(retry.event.contact).toMatchObject({archived:true});expect(await x.repo.findByCanonicalVacancyId(x.vacancyId)).toHaveLength(1);});
 it("interaction request reused with a different or removed contact conflicts",async()=>{const x=await setup(),other=x.contact();x.link(other);await x.event(x.contactId);await expect(x.event(other)).rejects.toThrow(/different content/);await expect(x.event()).rejects.toThrow(/different content/);});
 it("contactless interaction requests are also retry-safe",async()=>{const x=await setup();await x.event();await x.event();expect(await x.repo.findByCanonicalVacancyId(x.vacancyId)).toHaveLength(1);});
 it("action retries preserve identity after ending/archiving and reject another contact",async()=>{const x=await setup(),other=x.contact();x.link(other);await x.action(x.contactId);x.archive();x.end();await x.action(x.contactId);expect(await x.crm.getNextActions(x.vacancyId)).toHaveLength(1);await expect(x.action(other)).rejects.toThrow(/different content/);await expect(x.action()).rejects.toThrow(/different content/);});
 it.each(["COMPLETE","CANCEL"] as const)("%s preserves contact and original creation history",async kind=>{const x=await setup();await x.action(x.contactId);await x.crm.changeNextAction({canonicalVacancyId:x.vacancyId,actionId:"action",requestId:"finish",kind},at);x.archive();x.end();const action=(await x.crm.getNextActions(x.vacancyId))[0]!;expect(action.contact).toMatchObject({id:x.contactId,archived:true});expect(action.changes.map(c=>c.kind)).toEqual(["CREATE",kind]);});
 it("reminders, due states and process semantics remain independent",async()=>{const x=await setup(),before=await x.crm.get(x.vacancyId);await x.action(x.contactId);await x.crm.changeNextAction({canonicalVacancyId:x.vacancyId,actionId:"action",requestId:"reminder",kind:"SET_REMINDER",remindAt:at.toISOString()},at);const view=deriveNextActions(await x.crm.getNextActions(x.vacancyId),new Date(at.getTime()+1));expect(view.actions[0]).toMatchObject({dueState:"OVERDUE",reminderDue:true,contactId:x.contactId});expect(await x.crm.get(x.vacancyId)).toEqual(before);});
 it("contact detail includes linked interactions and completed actions",async()=>{const x=await setup();await x.event(x.contactId);await x.action(x.contactId);await x.crm.changeNextAction({kind:"COMPLETE",canonicalVacancyId:x.vacancyId,actionId:"action",requestId:"complete"},at);expect(x.library.list()[0]!.activities).toEqual(expect.arrayContaining([expect.objectContaining({kind:"INTERACTION",description:"CONTACTED"}),expect.objectContaining({kind:"ACTION",status:"COMPLETED"})]));});
 it("recapture, vacancy archive/restore and single-capture deletion preserve references",async()=>{const x=await setup();await x.event(x.contactId);await x.action(x.contactId);const before=await x.repo.findByCanonicalVacancyId(x.vacancyId),actions=await x.crm.getNextActions(x.vacancyId);await x.capture(html.replaceAll("Manufacturing Engineer (m/f/d)","Updated Engineer (m/f/d)"));const cleanup=new SqliteVacancyCleanup(x.db);cleanup.setArchived(x.vacancyId,true,cleanup.state(x.vacancyId).token);cleanup.setArchived(x.vacancyId,false,cleanup.state(x.vacancyId).token);expect(await x.repo.findByCanonicalVacancyId(x.vacancyId)).toEqual(before);expect(await x.crm.getNextActions(x.vacancyId)).toEqual(actions);cleanup.setArchived(x.vacancyId,true,cleanup.state(x.vacancyId).token);await cleanup.delete({canonicalVacancyId:x.vacancyId,observationId:x.first.observationId,token:cleanup.preview(x.vacancyId,x.first.observationId).token,confirmation:"DELETE",acknowledgeApplicationHistory:false});expect(await x.repo.findByCanonicalVacancyId(x.vacancyId)).toEqual(before);expect(await x.crm.getNextActions(x.vacancyId)).toEqual(actions);});
 it("cleanup tokens change for new activity, not contact edits; whole deletion preserves contact",async()=>{const x=await setup(),cleanup=new SqliteVacancyCleanup(x.db);cleanup.setArchived(x.vacancyId,true,cleanup.state(x.vacancyId).token);const before=cleanup.preview(x.vacancyId);await x.event(x.contactId);const afterEvent=cleanup.preview(x.vacancyId);expect(afterEvent.token).not.toBe(before.token);await x.action(x.contactId);const afterAction=cleanup.preview(x.vacancyId);expect(afterAction.token).not.toBe(afterEvent.token);x.library.execute({operation:"UPDATE",requestId:"rename",contactId:x.contactId,displayName:"Changed",jobTitle:"",notes:""});expect(cleanup.preview(x.vacancyId).token).toBe(afterAction.token);await expect(cleanup.delete({canonicalVacancyId:x.vacancyId,token:before.token,confirmation:"DELETE",acknowledgeApplicationHistory:false})).rejects.toThrow();await cleanup.delete({canonicalVacancyId:x.vacancyId,token:afterAction.token,confirmation:"DELETE",acknowledgeApplicationHistory:false});expect(x.library.list()).toHaveLength(1);for(const table of ["interaction_contact_references","action_contact_references","interaction_requests"])expect(x.db.prepare("SELECT count(*) n FROM "+table).get()).toEqual({n:0});expect(x.db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);});
 it("reference history cannot be updated or independently deleted",async()=>{const x=await setup();await x.event(x.contactId);await x.action(x.contactId);for(const table of ["interaction_contact_references","action_contact_references"]){expect(()=>x.db.prepare("UPDATE "+table+" SET contact_id=contact_id").run()).toThrow(/immutable/);expect(()=>x.db.prepare("DELETE FROM "+table).run()).toThrow(/guarded/);}});
 it("adds migration 18 without rewriting old events or actions",async()=>{const x=await setup();await x.event();await x.action();x.db.exec("DROP TABLE interaction_requests; DROP TABLE interaction_contact_references; DROP TABLE action_contact_references; DELETE FROM schema_migrations WHERE version=18");const oldEvents=x.db.prepare("SELECT * FROM user_vacancy_interaction_events").all(),oldActions=x.db.prepare("SELECT * FROM vacancy_next_actions").all();migrateDatabase(x.db);migrateDatabase(x.db);expect(x.db.prepare("SELECT * FROM user_vacancy_interaction_events").all()).toEqual(oldEvents);expect(x.db.prepare("SELECT * FROM vacancy_next_actions").all()).toEqual(oldActions);expect((await x.repo.findByCanonicalVacancyId(x.vacancyId))[0]!.contactId).toBeUndefined();});
 it("HTTP validates contact IDs and conflicting retries rather than dropping fields",async()=>{const x=await setup(),server=createBrowserCaptureServer({...x.workflow,captureAndProcessBrowserVacancy:async()=>{throw Error("unused");}});await new Promise<void>(r=>server.listen(0,"127.0.0.1",r));const base="http://127.0.0.1:"+(server.address() as AddressInfo).port+"/vacancies/"+x.vacancyId;
 const post=(path:string,body:unknown)=>fetch(base+path,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
 try{for(const [path,input] of [["/interactions",{type:"CONTACTED"}],["/crm/actions",{description:"Call",dueAt:null}]] as const){const body={...input,requestId:path,contactId:x.contactId};expect((await post(path,body)).ok).toBe(true);expect((await post(path,body)).ok).toBe(true);expect((await post(path,{...body,contactId:"missing"})).status).toBe(409);expect((await post(path,{...body,requestId:"invalid"+path,contactId:123})).status).toBe(400);}}finally{await new Promise<void>(r=>server.close(()=>r()));}});
});

it("unified timeline is read-only, stable through recapture/archive and uses persisted history",async()=>{
 const x=await setup();await x.event(x.contactId);await x.action(x.contactId);
 await x.workflow.addVacancyNote({canonicalVacancyId:x.vacancyId,requestId:"timeline-note",text:"Keep this note"});
 await x.workflow.setVacancyProcessState({canonicalVacancyId:x.vacancyId,requestId:"timeline-process",state:"APPLIED"});
 x.end();x.archive();
 const cleanup=new SqliteVacancyCleanup(x.db),token=cleanup.state(x.vacancyId).token;
 const read=()=>x.workflow.getVacancyReview(x.vacancyId);const first=(await read()).activityTimeline!;
 expect(first.map(i=>i.kind)).toEqual(expect.arrayContaining(["INTERACTION","NOTE","PROCESS_TRANSITION","ACTION_CREATED","CONTACT_LINKED","CONTACT_RELATIONSHIP_ENDED"]));
 expect((await read()).activityTimeline).toEqual(first);expect(cleanup.state(x.vacancyId).token).toBe(token);
 await x.capture(html.replaceAll("Manufacturing Engineer (m/f/d)","Updated Engineer (m/f/d)"));
 cleanup.setArchived(x.vacancyId,true,cleanup.state(x.vacancyId).token);expect((await read()).activityTimeline).toEqual(first);
 cleanup.setArchived(x.vacancyId,false,cleanup.state(x.vacancyId).token);expect((await read()).activityTimeline).toEqual(first);
 cleanup.setArchived(x.vacancyId,true,cleanup.state(x.vacancyId).token);
 await cleanup.delete({canonicalVacancyId:x.vacancyId,token:cleanup.preview(x.vacancyId).token,confirmation:"DELETE",acknowledgeApplicationHistory:false});
 await expect(read()).rejects.toThrow();expect(x.library.list()).toHaveLength(1);
});
