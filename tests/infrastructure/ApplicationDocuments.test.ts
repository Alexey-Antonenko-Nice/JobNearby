import { migration015 } from "../../src/infrastructure/database/migrations/015_application_documents.js";
import { migration012 } from "../../src/infrastructure/database/migrations/012_vacancy_crm.js";
import { migration013 } from "../../src/infrastructure/database/migrations/013_vacancy_process_state.js";
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
import { readFileSync, writeFileSync, mkdtempSync, rmSync, readdirSync, unlinkSync, symlinkSync, mkdirSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { createDatabase } from "../../src/infrastructure/database/createDatabase.js";
import { createCaptureProcessingRuntime } from "../../src/infrastructure/runtime/createCaptureProcessingRuntime.js";
import { SqliteVacancyCleanup } from "../../src/infrastructure/persistence/SqliteVacancyCleanup.js";
import { SqliteCanonicalVacancyRepository } from "../../src/infrastructure/persistence/SqliteCanonicalVacancyRepository.js";
import { migration014 } from "../../src/infrastructure/database/migrations/014_vacancy_next_actions.js";
import { ManagedApplicationDocumentLibrary } from "../../src/application/user/ApplicationDocumentLibrary.js";
import { SqliteApplicationDocumentRepository } from "../../src/infrastructure/persistence/SqliteApplicationDocumentRepository.js";
import { LocalManagedDocumentStorage } from "../../src/infrastructure/storage/LocalManagedDocumentStorage.js";
import { documentDataDirectory } from "../../src/infrastructure/storage/documentDataDirectory.js";
import { MAX_DOCUMENT_BYTES, type ImportApplicationDocument } from "../../src/domain/user/ApplicationDocument.js";
const html = readFileSync("tests/fixtures/greenhouseSelectedVacancy.html", "utf8");
const payload = { pageUrl: "https://job-boards.eu.greenhouse.io/agilerobotsse/jobs/4964827101", pageTitle: "Job Application", html, visibleText: "Selected job", capturedAt: "2026-10-27T12:00:00Z" };
const databases: ReturnType<typeof createDatabase>[] = [];
const roots:string[]=[];
afterEach(() => { for (const db of databases.splice(0)) db.close(); for(const root of roots.splice(0)) rmSync(root,{recursive:true,force:true}); });
function temporaryRoot() {const root=mkdtempSync(join(tmpdir(),"jobnearby-documents-test-"));roots.push(root);return root;}
function importInput(requestId="import-1"):ImportApplicationDocument {return {requestId,name:"Engineering CV",kind:"CV",originalFileName:"cv.pdf",mediaType:"application/pdf",bytes:Buffer.from("exact CV bytes")};}
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
  const root=temporaryRoot(), documentRepo=new SqliteApplicationDocumentRepository(db),storage=new LocalManagedDocumentStorage(root);
  const library=new ManagedApplicationDocumentLibrary(documentRepo,storage,()=>clock);
  const workflow = createVacancyReviewWorkflow({
    documentLibrary:library,
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
  return { root, documentRepo, storage, library, db, capture, first, service, repo, archive, remove, event, crm, workflow, target, create, view, clock:(value:string)=>{clock=new Date(value);} };
}


describe("Immutable application documents",()=>{
  it("creates CV and motivation-letter documents with isolated first versions and hashes",async()=>{
    const x=await setup(), cv=x.library.importVersion(importInput());
    const letter=x.library.importVersion({...importInput("letter"),kind:"MOTIVATION_LETTER",name:"Letter",bytes:Buffer.from("letter bytes")});
    expect(x.documentRepo.list().map(d=>d.kind)).toEqual(["CV","MOTIVATION_LETTER"]);
    expect([cv.versionNumber,letter.versionNumber]).toEqual([1,1]);
    expect(cv.documentId).not.toBe(letter.documentId);
    expect(cv.contentHash).toBe(createHash("sha256").update("exact CV bytes").digest("hex"));
    expect(x.storage.read(cv.storageKey)).toEqual(Buffer.from("exact CV bytes"));
    expect(cv.storageKey).toMatch(/^documents\/[^/]+\/[^/]+\/content$/);
    expect(JSON.stringify(x.library.forVacancy(x.first.id))).not.toContain("storageKey");
  });
  it("adds a second immutable version; changing the original external file cannot alter version one",async()=>{
    const x=await setup(), external=join(x.root,"external.pdf");writeFileSync(external,"original");
    const first=x.library.importVersion({...importInput(),bytes:readFileSync(external)});
    writeFileSync(external,"edited");
    const second=x.library.importVersion({requestId:"v2",documentId:first.documentId,originalFileName:"cv.pdf",mediaType:null,bytes:readFileSync(external)});
    expect(second.versionNumber).toBe(2);expect(second.contentHash).not.toBe(first.contentHash);
    expect(Buffer.from(x.library.download(first.id).bytes).toString()).toBe("original");
    expect(x.documentRepo.findVersion(first.id)).toEqual(first);
    expect(()=>x.db.prepare("UPDATE application_document_versions SET original_file_name='changed'").run()).toThrow(/immutable/);
    expect(()=>x.db.prepare("DELETE FROM application_document_versions").run()).toThrow(/deletion/);
  });
  it("retries imports without duplicate documents or versions and rejects changed request content",async()=>{
    const x=await setup(), input=importInput(), first=x.library.importVersion(input);
    expect(x.library.importVersion(input)).toEqual(first);
    expect(x.documentRepo.list()).toHaveLength(1);expect(x.documentRepo.versions()).toHaveLength(1);
    for(const changed of [{...input,bytes:Buffer.from("changed")},{...input,originalFileName:"other.pdf"},{...input,name:"another"}])
      expect(()=>x.library.importVersion(changed)).toThrow(/already used/);
    const second={requestId:"v2",documentId:first.documentId,bytes:Buffer.from("second"),mediaType:null,originalFileName:"v2"};
    expect(x.library.importVersion(second)).toEqual(x.library.importVersion(second));
    expect(x.documentRepo.versions()).toHaveLength(2);
  });
  it.each(["../cv.pdf","..\\cv.pdf","D:\\private.pdf","/secret","..","bad\nname"])("rejects unsafe filename %j",async name=>{
    const x=await setup();expect(()=>x.library.importVersion({...importInput(),originalFileName:name})).toThrow(/filename/);
    expect(x.documentRepo.list()).toEqual([]);
  });
  it("rejects empty and oversized bytes, invalid kinds, missing logical documents and bad storage paths",async()=>{
    const x=await setup();
    for(const bytes of [Buffer.alloc(0),Buffer.alloc(MAX_DOCUMENT_BYTES+1)]) expect(()=>x.library.importVersion({...importInput(),bytes})).toThrow(/5 MiB/);
    expect(()=>x.library.importVersion({...importInput(),kind:"PASSPORT"} as never)).toThrow(/Choose CV/);
    expect(()=>x.library.importVersion({...importInput(),documentId:"missing"})).toThrow(/not found/);
    expect(()=>x.storage.read("../../secret")).toThrow(/storage identifier/);
    expect(x.documentRepo.versions()).toEqual([]);
  });
  it("reports missing or corrupt files, refuses new associations/downloads and never overwrites a missing version on retry",async()=>{
    const x=await setup(), v=x.library.importVersion(importInput());
    writeFileSync(join(x.root,v.storageKey),"corrupt");
    expect(x.library.forVacancy(x.first.id).library[0]?.versions[0]?.integrity).toBe("CORRUPT");
    expect(()=>x.library.download(v.id)).toThrow(/integrity/);
    expect(()=>x.library.associate({canonicalVacancyId:x.first.id,versionId:v.id,requestId:"a"})).toThrow(/integrity/);
    unlinkSync(join(x.root,v.storageKey));
    expect(x.library.forVacancy(x.first.id).library[0]?.versions[0]?.integrity).toBe("MISSING");
    expect(()=>x.library.importVersion(importInput())).toThrow(/missing/);
    expect(()=>x.library.download(v.id)).toThrow(/missing/);
    expect(x.documentRepo.versions()).toHaveLength(1);expect(x.documentRepo.associations(x.first.id)).toEqual([]);
  });
  it("rolls back registered metadata and removes owned files when metadata insertion fails",async()=>{
    const x=await setup();
    x.db.exec("CREATE TRIGGER simulate_failure BEFORE INSERT ON application_document_versions BEGIN SELECT RAISE(ABORT,'simulated failure'); END;");
    expect(()=>x.library.importVersion(importInput())).toThrow(/no version was registered/);
    expect(x.documentRepo.list()).toEqual([]);expect(x.documentRepo.versions()).toEqual([]);
    const paths=readdirSync(x.root,{recursive:true}).map(String);
    expect(paths.some(p=>p.endsWith("content")||p.includes(".import-"))).toBe(false);
  });
  it("cleans staged files on a storage collision without touching an existing version",async()=>{
    const x=await setup(),doc="11111111-1111-1111-1111-111111111111",version="22222222-2222-2222-2222-222222222222";
    const existing=x.storage.store(doc,version,Buffer.from("original"));
    expect(()=>x.storage.store(doc,version,Buffer.from("replace"))).toThrow(/collision/);
    expect(x.storage.read(existing.key)).toEqual(Buffer.from("original"));
    expect(readdirSync(join(x.root,"documents",doc))).toEqual([version]);
  });
  it("rejects a linked storage subtree instead of writing outside its managed root",async()=>{
    const x=await setup(),outside=temporaryRoot();
    symlinkSync(outside,join(x.root,"documents"),"junction");
    expect(()=>x.library.importVersion(importInput())).toThrow(/Unsafe document storage link/);
    expect(readdirSync(outside)).toEqual([]);expect(x.documentRepo.list()).toEqual([]);
  });
  it("does not register metadata after storage failure and hides filesystem paths from client errors",async()=>{
    const x=await setup();
    const broken=new ManagedApplicationDocumentLibrary(x.documentRepo,{store(){throw Error("private machine path");},read(){throw Error("private machine path");}});
    expect(()=>broken.importVersion(importInput())).toThrow("Document import failed; no version was registered.");
    expect(x.documentRepo.list()).toEqual([]);
    const v=x.library.importVersion(importInput());
    expect(()=>broken.download(v.id)).toThrow("Managed document could not be read.");
  });
  it("selects both roles, preserves replacement history, and does not replay a superseded retry",async()=>{
    const x=await setup(), first=x.library.importVersion(importInput());
    const second=x.library.importVersion({...importInput("v2"),documentId:first.documentId,bytes:Buffer.from("v2")});
    const letter=x.library.importVersion({...importInput("letter"),kind:"MOTIVATION_LETTER",name:"Letter"});
    const associate=(versionId:string,requestId:string)=>x.workflow.associateVacancyDocument({canonicalVacancyId:x.first.id,versionId,requestId});
    await associate(first.id,"a1");await associate(letter.id,"letter-a");await associate(second.id,"a2");await associate(first.id,"a1");
    const view=await x.workflow.getVacancyReview(x.first.id);
    expect(view.documents?.associations.map(a=>[a.documentVersionId,a.current])).toEqual([[first.id,false],[letter.id,true],[second.id,true]]);
    await expect(associate(second.id,"a1")).rejects.toThrow(/already used/);
    expect(()=>x.db.prepare("UPDATE vacancy_application_documents SET created_at='changed'").run()).toThrow(/immutable/);
  });
  it("supersedes by kind across different logical CVs without altering the motivation letter",async()=>{
    const x=await setup(), a=x.library.importVersion(importInput()),b=x.library.importVersion({...importInput("other"),name:"Other CV"});
    x.library.associate({canonicalVacancyId:x.first.id,versionId:a.id,requestId:"a"});
    x.library.associate({canonicalVacancyId:x.first.id,versionId:b.id,requestId:"b"});
    expect(x.library.forVacancy(x.first.id).associations.map(a=>a.current)).toEqual([false,true]);
  });
  it("shares versions across vacancies but isolates association decisions",async()=>{
    const x=await setup(), v=x.library.importVersion(importInput());
    const other=await x.capture(html.replaceAll("4964827101","4964827102"),payload.pageUrl.replace("4964827101","4964827102"));
    x.library.associate({canonicalVacancyId:x.first.id,versionId:v.id,requestId:"a"});
    expect(x.library.forVacancy(other.id).associations).toEqual([]);
    x.library.associate({canonicalVacancyId:other.id,versionId:v.id,requestId:"b"});
    expect(x.documentRepo.versions()).toHaveLength(1);
    expect(x.library.forVacancy(other.id).associations).toHaveLength(1);
    expect(()=>x.library.associate({canonicalVacancyId:other.id,versionId:v.id,requestId:"a"})).toThrow(/already used/);
  });
  it("does not change captured/recognition data, priority, notes, process history or next actions",async()=>{
    const x=await setup();await x.workflow.setVacancyPriority({canonicalVacancyId:x.first.id,priority:"HIGH"});
    await x.workflow.addVacancyNote({canonicalVacancyId:x.first.id,requestId:"note",text:"Private note"});
    await x.workflow.setVacancyProcessState({canonicalVacancyId:x.first.id,requestId:"process",state:"APPLIED"});await x.create();
    const before=await x.workflow.getVacancyReview(x.first.id);
    const rows=()=>["source_observations","canonical_vacancy_organization_relationships","observation_cluster_assignments","user_vacancy_interaction_events"].map(t=>x.db.prepare("SELECT * FROM "+t).all());
    const previous=rows();
    const v=x.library.importVersion(importInput());x.library.associate({canonicalVacancyId:x.first.id,versionId:v.id,requestId:"a"});
    const after=await x.workflow.getVacancyReview(x.first.id);
    expect(after.crm).toEqual(before.crm);expect(after.nextActions).toEqual(before.nextActions);expect(after.employer).toEqual(before.employer);expect(rows()).toEqual(previous);
  });
  it("preserves associations through recapture and archive/restore",async()=>{
    const x=await setup(),v=x.library.importVersion(importInput());x.library.associate({canonicalVacancyId:x.first.id,versionId:v.id,requestId:"a"});
    const before=x.library.forVacancy(x.first.id);
    const recaptured=await x.capture(html.replaceAll("Manufacturing Engineer (m/f/d)","Updated Engineer (m/f/d)"));
    expect(recaptured.id).toBe(x.first.id);x.archive();x.service.setArchived(x.first.id,false,x.service.state(x.first.id).token);
    expect(x.library.forVacancy(x.first.id)).toEqual(before);
  });
  it("preserves library and associations on single-capture deletion",async()=>{
    const x=await setup(), v=x.library.importVersion(importInput());x.library.associate({canonicalVacancyId:x.first.id,versionId:v.id,requestId:"a"});
    await x.capture(html.replaceAll("Manufacturing Engineer (m/f/d)","Updated Engineer (m/f/d)"));
    x.archive();await x.remove(x.first.source);
    expect(x.documentRepo.associations(x.first.id)).toHaveLength(1);expect(x.library.download(v.id).bytes).toEqual(Buffer.from("exact CV bytes"));
  });
  it("whole-vacancy cleanup removes only its associations and preserves shared library bytes",async()=>{
    const x=await setup(),v=x.library.importVersion(importInput());
    const other=await x.capture(html.replaceAll("4964827101","4964827102"),payload.pageUrl.replace("4964827101","4964827102"));
    for(const [id,requestId] of [[x.first.id,"a"],[other.id,"b"]] as const) x.library.associate({canonicalVacancyId:id,versionId:v.id,requestId});
    x.archive();expect(x.service.preview(x.first.id).affected).toContainEqual({label:"Vacancy document associations removed (library retained)",count:1});
    await x.remove();
    expect(x.documentRepo.associations(x.first.id)).toEqual([]);expect(x.documentRepo.associations(other.id)).toHaveLength(1);
    expect(x.documentRepo.list()).toHaveLength(1);expect(x.library.download(v.id).bytes).toEqual(Buffer.from("exact CV bytes"));
    expect(x.db.pragma("foreign_key_check")).toEqual([]);
  });
  it("association changes invalidate stale cleanup approvals; ordinary deletes remain guarded",async()=>{
    const x=await setup(),v=x.library.importVersion(importInput());x.archive();const preview=x.service.preview(x.first.id);
    x.library.associate({canonicalVacancyId:x.first.id,versionId:v.id,requestId:"a"});
    await expect(x.service.delete({canonicalVacancyId:x.first.id,token:preview.token,confirmation:"DELETE",acknowledgeApplicationHistory:false})).rejects.toThrow(/changed|stale/i);
    expect(()=>x.db.prepare("DELETE FROM vacancy_application_documents").run()).toThrow(/deletion/);
    expect(x.documentRepo.associations(x.first.id)).toHaveLength(1);
  });
  it("migrates populated version 14 additively and idempotently",async()=>{
    const db=versionEightDatabase();databases.push(db);
    for(const m of [migration009,migration010,migration011,migration012,migration013,migration014]) {
      m.up(db);db.prepare("INSERT INTO schema_migrations VALUES (?,?,?)").run(m.version,m.name,"2026-11-17");
    }
    db.prepare("INSERT INTO canonical_vacancies VALUES (?,?,?,?,?,?,?)").run("legacy","PARTIAL","test","1","2026-11-16","2026-11-16","2026-11-16");
    const crm=new SqliteVacancyCrmRepository(db);await crm.setPriority("legacy","HIGH");
    await crm.addNote({id:"n",canonicalVacancyId:"legacy",text:"Retain",createdAt:new Date("2026-11-17")});
    const before=await crm.get("legacy");migrateDatabase(db);migrateDatabase(db);
    expect(await crm.get("legacy")).toEqual(before);expect(db.prepare("SELECT count(*) n FROM schema_migrations WHERE version=15").get()).toEqual({n:1});
    expect(new SqliteApplicationDocumentRepository(db).list()).toEqual([]);expect(db.pragma("foreign_key_check")).toEqual([]);
  });
  it("resolves per-user storage without repository/cwd, temporary or relative production paths",()=>{
    const home=resolve("C:/Users/example"), repositoryRoot=resolve("C:/project"),temporaryRoot=resolve("C:/temp");
    const base={home,repositoryRoot,temporaryRoot};
    expect(documentDataDirectory({...base,platform:"win32",env:{}})).toBe(join(home,"AppData","Local","JobNearby"));
    expect(documentDataDirectory({...base,platform:"linux",env:{}})).toBe(join(home,".local","share","JobNearby"));
    expect(documentDataDirectory({...base,platform:"darwin",env:{}})).toBe(join(home,"Library","Application Support","JobNearby"));
    for(const path of ["relative",join(repositoryRoot,"documents"),join(temporaryRoot,"documents")])
      expect(()=>documentDataDirectory({...base,env:{JOB_NEARBY_DOCUMENT_DATA_DIR:path}})).toThrow(/absolute|outside/);
  });
  it("HTTP imports, selects and downloads exact bytes without exposing storage paths",async()=>{
    const x=await setup(),server=createBrowserCaptureServer({captureAndProcessBrowserVacancy:async()=>{throw Error("unused");},...x.workflow});
    await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));
    const base="http://127.0.0.1:"+(server.address() as AddressInfo).port;
    try {
      const body={requestId:"http",kind:"CV",name:"HTTP CV",originalFileName:"cv.html",mediaType:"text/html",contentBase64:Buffer.from("<script>not rendered</script>").toString("base64")};
      const post=(path:string,body:unknown,type="application/json")=>fetch(base+path,{method:"POST",headers:{"Content-Type":type},body:JSON.stringify(body)});
      const path="/vacancies/"+x.first.id+"/documents/";
      const response=await post(path+"import",body);expect(response.status).toBe(200);
      const result=await response.json() as {review:{documents:{library:{versions:{id:string}[]}[]}}};
      expect(JSON.stringify(result)).not.toContain("storageKey");const v=result.review.documents.library[0]!.versions[0]!;
      expect((await post(path+"associations",{requestId:"a",versionId:v.id})).status).toBe(200);
      const content=await fetch(base+"/documents/versions/"+v.id+"/content");
      expect(content.headers.get("Content-Type")).toBe("application/octet-stream");expect(content.headers.get("Content-Disposition")).toMatch(/^attachment/);
      expect(content.headers.get("X-Content-Type-Options")).toBe("nosniff");expect(await content.text()).toBe("<script>not rendered</script>");
      expect((await post(path+"import",body,"text/plain")).status).toBe(415);
      expect((await post(path+"import",{...body,requestId:"traversal",originalFileName:"../secret"})).status).toBe(400);
      expect((await post(path+"import",{...body,requestId:"bad",contentBase64:"%%%"})).status).toBe(400);
      expect((await post(path+"import",{...body,requestId:"extra",path:"/secret"})).status).toBe(400);
      expect((await post(path+"import",{...body,requestId:"large",contentBase64:Buffer.alloc(MAX_DOCUMENT_BYTES+1).toString("base64")})).status).toBe(413);
      expect((await post("/vacancies/missing/documents/import",{...body,requestId:"missing"})).status).toBe(404);
      expect(x.documentRepo.versions()).toHaveLength(1);
    } finally {await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()));}
  });
});


describe("Document library lifecycle",()=>{
  it("renames only logical metadata while preserving exact versions and association history",async()=>{
    const x=await setup(),v=x.library.importVersion(importInput());
    x.library.associate({canonicalVacancyId:x.first.id,versionId:v.id,requestId:"selected"});
    const before=x.documentRepo.versions(),associations=x.documentRepo.associations(x.first.id),bytes=x.storage.read(v.storageKey);
    x.library.rename({documentId:v.documentId,name:"Commissioning CV - EN",requestId:"rename"});
    expect(x.library.list()[0]?.name).toBe("Commissioning CV - EN");
    expect(x.documentRepo.versions()).toEqual(before);expect(x.documentRepo.associations(x.first.id)).toEqual(associations);expect(x.storage.read(v.storageKey)).toEqual(bytes);
    expect(x.library.list()[0]?.versions[0]).toMatchObject({referenceCount:1,currentReferenceCount:1});
  });
  it("archives/restores without changing versions, associations, download or vacancy archive state",async()=>{
    const x=await setup(),v=x.library.importVersion(importInput());
    const selection={canonicalVacancyId:x.first.id,versionId:v.id,requestId:"selected"};x.library.associate(selection);
    const before=x.documentRepo.versions(),associations=x.documentRepo.associations(x.first.id),cleanup=x.service.state(x.first.id);
    x.library.archive({documentId:v.documentId,requestId:"archive"});
    expect(x.library.list()[0]?.archivedAt?.toISOString()).toBe("2026-11-17T12:00:00.000Z");
    expect(x.library.download(v.id).bytes).toEqual(Buffer.from("exact CV bytes"));
    expect(()=>x.library.associate({...selection,requestId:"new-selection"})).toThrow(/Restore/);
    expect(()=>x.library.importVersion({...importInput("new-version"),documentId:v.documentId})).toThrow(/Restore/);
    x.library.associate(selection);expect(x.library.importVersion(importInput())).toEqual(v);
    expect(x.service.state(x.first.id)).toEqual(cleanup);
    expect(x.documentRepo.versions()).toEqual(before);expect(x.documentRepo.associations(x.first.id)).toEqual(associations);
    x.library.restore({documentId:v.documentId,requestId:"restore"});
    expect(x.library.list()[0]?.archivedAt).toBeNull();
    expect(x.library.importVersion({...importInput("new-version"),documentId:v.documentId}).versionNumber).toBe(2);
  });
  it("lifecycle retries never replay old changes and conflicting IDs are rejected",async()=>{
    const x=await setup(),v=x.library.importVersion(importInput());const target={documentId:v.documentId};
    const rename={...target,name:"First name",requestId:"rename"};
    x.library.rename(rename);x.library.rename({...rename,name:"Later name",requestId:"rename-later"});x.library.rename(rename);
    x.library.archive({...target,requestId:"archive"});x.library.restore({...target,requestId:"restore"});x.library.archive({...target,requestId:"archive"});x.library.restore({...target,requestId:"restore"});
    expect(x.library.list()[0]).toMatchObject({name:"Later name",archivedAt:null});
    expect(x.db.prepare("SELECT COUNT(*) n FROM application_document_changes").get()).toEqual({n:4});
    expect(()=>x.library.rename({...rename,name:"Conflict"})).toThrow(/already used/);
    expect(()=>x.library.restore({...target,requestId:"archive"})).toThrow(/already used/);
    const other=x.library.importVersion(importInput("other"));
    expect(()=>x.library.archive({documentId:other.documentId,requestId:"archive"})).toThrow(/already used/);
    x.library.archive({...target,requestId:"archive-again"});x.library.restore({...target,requestId:"restore"});
    expect(x.library.list()[0]?.archivedAt).not.toBeNull();
  });
  it.each(["", " ", "x".repeat(201)])("rejects invalid rename without a lifecycle write (%j)",async name=>{
    const x=await setup(),v=x.library.importVersion(importInput());
    expect(()=>x.library.rename({documentId:v.documentId,requestId:"bad",name})).toThrow(/1 to 200/);
    expect(x.db.prepare("SELECT * FROM application_document_changes").all()).toEqual([]);
  });
  it("counts historical and current references across active and archived vacancies",async()=>{
    const x=await setup(),v1=x.library.importVersion(importInput()),v2=x.library.importVersion({...importInput("v2"),documentId:v1.documentId});
    const other=await x.capture(html.replaceAll("4964827101","4964827102"),payload.pageUrl.replace("4964827101","4964827102"));
    const select=(vacancy:string,version:string,requestId:string)=>x.library.associate({canonicalVacancyId:vacancy,versionId:version,requestId});
    select(x.first.id,v1.id,"a1");select(x.first.id,v2.id,"a2");select(other.id,v1.id,"b1");x.archive();
    x.library.archive({documentId:v1.documentId,requestId:"archive-doc"});
    expect(x.library.list()[0]?.versions.map(v=>[v.versionNumber,v.referenceCount,v.currentReferenceCount])).toEqual([[1,2,1],[2,1,1]]);
    for(const id of [v1.id,v2.id]) expect(()=>x.db.prepare("DELETE FROM application_document_versions WHERE id=?").run(id)).toThrow(/deletion/);
    expect(()=>x.db.prepare("DELETE FROM application_documents WHERE id=?").run(v1.documentId)).toThrow(/deletion/);
  });
  it("forbids deletion even for unreferenced versions and keeps the lifecycle ledger immutable",async()=>{
    const x=await setup(),v=x.library.importVersion(importInput());
    expect(x.library.list()[0]?.versions[0]?.referenceCount).toBe(0);
    expect(()=>x.db.prepare("DELETE FROM application_document_versions WHERE id=?").run(v.id)).toThrow(/deletion/);
    x.library.archive({documentId:v.documentId,requestId:"a"});
    expect(()=>x.db.prepare("UPDATE application_document_changes SET operation='RESTORE'").run()).toThrow(/immutable/);
    expect(()=>x.db.prepare("DELETE FROM application_document_changes").run()).toThrow(/cannot be deleted/);
    for(const field of ["document_id","version_number","content_hash","storage_key","size_bytes","original_file_name","media_type"])
      expect(()=>x.db.prepare("UPDATE application_document_versions SET "+field+"="+field+" WHERE id=?").run(v.id)).toThrow(/immutable/);
    expect(x.library).not.toHaveProperty("deleteVersion");
  });
  it("recapture and vacancy archive/restore do not change document lifecycle, CRM or employer semantics",async()=>{
    const x=await setup(),v=x.library.importVersion(importInput());await x.create();
    await x.workflow.setVacancyPriority({canonicalVacancyId:x.first.id,priority:"HIGH"});
    await x.workflow.addVacancyNote({canonicalVacancyId:x.first.id,requestId:"note",text:"Keep"});
    await x.workflow.setVacancyProcessState({canonicalVacancyId:x.first.id,requestId:"p",state:"APPLIED"});
    const before=await x.workflow.getVacancyReview(x.first.id);
    x.library.rename({documentId:v.documentId,requestId:"rename",name:"Renamed"});x.library.archive({documentId:v.documentId,requestId:"archive"});
    const after=await x.workflow.getVacancyReview(x.first.id);
    expect(after.crm).toEqual(before.crm);expect(after.nextActions).toEqual(before.nextActions);expect(after.employer).toEqual(before.employer);
    const documents=x.library.list();await x.capture(html.replaceAll("Manufacturing Engineer (m/f/d)","Updated Engineer (m/f/d)"));
    x.archive();x.service.setArchived(x.first.id,false,x.service.state(x.first.id).token);
    expect(x.library.list()).toEqual(documents);
  });
  it("last-reference cleanup preserves archived logical identity, lifecycle, versions and files",async()=>{
    const x=await setup(),v=x.library.importVersion(importInput());
    x.library.associate({canonicalVacancyId:x.first.id,versionId:v.id,requestId:"a"});
    x.library.archive({documentId:v.documentId,requestId:"archive-doc"});x.archive();await x.remove();
    expect(x.library.list()[0]).toMatchObject({id:v.documentId,archivedAt:expect.any(Date)});
    expect(x.library.list()[0]?.versions[0]).toMatchObject({id:v.id,referenceCount:0,currentReferenceCount:0,integrity:"AVAILABLE"});
    expect(x.library.download(v.id).bytes).toEqual(Buffer.from("exact CV bytes"));expect(x.db.pragma("foreign_key_check")).toEqual([]);
  });
  it("retains lifecycle and verified downloads after relocating the managed store",async()=>{
    const x=await setup(),v=x.library.importVersion(importInput());x.library.rename({documentId:v.documentId,requestId:"rename",name:"Moved CV"});x.library.archive({documentId:v.documentId,requestId:"a"});
    const relocated=temporaryRoot();cpSync(x.root,relocated,{recursive:true});
    const library=new ManagedApplicationDocumentLibrary(x.documentRepo,new LocalManagedDocumentStorage(relocated));
    expect(library.list()).toEqual(x.library.list());expect(library.download(v.id).bytes).toEqual(x.library.download(v.id).bytes);
    library.restore({documentId:v.documentId,requestId:"restore"});expect(library.list()[0]?.archivedAt).toBeNull();
  });
  it("migrates populated version 15 without rewriting document or association history",()=>{
    const db=versionEightDatabase();databases.push(db);
    for(const m of [migration009,migration010,migration011,migration012,migration013,migration014,migration015]) {
      m.up(db);db.prepare("INSERT INTO schema_migrations VALUES (?,?,?)").run(m.version,m.name,"2026-11-18");
    }
    db.prepare("INSERT INTO canonical_vacancies VALUES (?,?,?,?,?,?,?)").run("legacy","PARTIAL","test","1","2026-11-16","2026-11-16","2026-11-16");
    db.prepare("INSERT INTO application_documents VALUES (?,?,?,?)").run("doc","CV","Original","2026-11-18");
    db.prepare("INSERT INTO application_document_versions VALUES (?,?,?,?,?,?,?,?,?,?,?)").run("v","doc",1,"cv.pdf",null,1,"a".repeat(64),"relative", "2026-11-18","import","fingerprint");
    db.prepare("INSERT INTO vacancy_application_documents VALUES (?,?,?,?)").run("a","legacy","v","2026-11-18");
    const snapshot=()=>["application_documents","application_document_versions","vacancy_application_documents"].map(t=>db.prepare("SELECT * FROM "+t).all());
    const before=snapshot();migrateDatabase(db);migrateDatabase(db);expect(snapshot()).toEqual(before);
    expect(new SqliteApplicationDocumentRepository(db).list()[0]).toMatchObject({name:"Original",archivedAt:null});
    expect(db.prepare("SELECT COUNT(*) n FROM schema_migrations WHERE version=16").get()).toEqual({n:1});
  });
  it("library HTTP reuses imports, lifecycle guards and verified downloads; no deletion route exists",async()=>{
    const x=await setup(),server=createBrowserCaptureServer({captureAndProcessBrowserVacancy:async()=>{throw Error("unused");},...x.workflow});
    await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));
    const base="http://127.0.0.1:"+(server.address() as AddressInfo).port;
    try {
      const post=(path:string,body:unknown)=>fetch(base+path,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
      const input={requestId:"library-import",name:"Library CV",kind:"CV",originalFileName:"cv.pdf",mediaType:null,contentBase64:Buffer.from("cv").toString("base64")};
      expect((await post("/documents/import",input)).status).toBe(200);
      expect((await post("/documents/import",input)).status).toBe(200);
      const doc=x.library.list()[0]!,version=doc.versions[0]!;
      const next={requestId:"v2",documentId:doc.id,originalFileName:"new.pdf",mediaType:null,contentBase64:Buffer.from("cv2").toString("base64")};
      expect((await post("/documents/import",next)).status).toBe(200);
      expect(x.library.list()[0]?.versions.map(v=>v.versionNumber)).toEqual([1,2]);
      expect((await post("/documents/"+doc.id+"/rename",{requestId:"rename",name:"Renamed"})).status).toBe(200);
      expect((await post("/documents/"+doc.id+"/archive",{requestId:"archive"})).status).toBe(200);
      expect((await post("/documents/"+doc.id+"/archive",{requestId:"archive"})).status).toBe(200);
      expect((await post("/documents/import",{...next,requestId:"v3"})).status).toBe(409);
      expect((await post("/documents/"+doc.id+"/restore",{requestId:"restore"})).status).toBe(200);
      const response=await fetch(base+"/documents");expect(response.status).toBe(200);
      expect(JSON.stringify(await response.json())).not.toContain("storageKey");
      for(const path of ["/documents/"+doc.id,"/documents/versions/"+version.id]) expect((await fetch(base+path,{method:"DELETE"})).status).toBe(404);
      expect((await post("/documents/"+doc.id+"/rename",{requestId:"bad",name:"bad",storageKey:"evil"})).status).toBe(400);
      expect((await fetch(base+"/documents/versions/"+version.id+"/content")).status).toBe(200);
    } finally {await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()));}
  });
});

it("Review timeline preserves superseded document selections and loads document metadata once",async()=>{
 const x=await setup(),v1=x.library.importVersion(importInput());x.library.associate({canonicalVacancyId:x.first.id,versionId:v1.id,requestId:"first-selection"});
 const v2=x.library.importVersion({documentId:v1.documentId,requestId:"second-version",originalFileName:"cv2.pdf",mediaType:null,bytes:Buffer.from("revision")});
 x.library.associate({canonicalVacancyId:x.first.id,versionId:v2.id,requestId:"second-selection"});
 const spy=vi.spyOn(x.library,"forVacancy");const view=await x.workflow.getVacancyReview(x.first.id);
 expect(spy).toHaveBeenCalledTimes(1);const selections=view.activityTimeline!.filter(i=>i.kind==="DOCUMENT_SELECTED");expect(selections).toHaveLength(2);expect(selections.map(i=>i.summary)).toEqual(expect.arrayContaining(["Engineering CV - v1","Engineering CV - v2"]));
 expect(selections.every(i=>i.title==="CV selected")).toBe(true);
});
