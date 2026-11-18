import { createHash, randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { ApplicationDocumentError, validateDocumentRequestId, type ApplicationDocument, type ApplicationDocumentVersion,
  type ApplicationDocumentRepository, type DocumentImportMetadata, type DocumentLifecycleCommand, type VacancyApplicationDocument } from "../../domain/user/ApplicationDocument.js";
interface VersionRow {
  id:string;document_id:string;version_number:number;original_file_name:string;media_type:string|null;
  size_bytes:number;content_hash:string;storage_key:string;created_at:string;request_id:string;request_fingerprint:string;
}
const mapVersion=(row:VersionRow):ApplicationDocumentVersion=>({id:row.id,documentId:row.document_id,versionNumber:row.version_number,
  originalFileName:row.original_file_name,mediaType:row.media_type,sizeBytes:row.size_bytes,contentHash:row.content_hash,
  storageKey:row.storage_key,createdAt:new Date(row.created_at)});
export class SqliteApplicationDocumentRepository implements ApplicationDocumentRepository {
  constructor(private readonly db:Database.Database) {}
  importVersion(input:DocumentImportMetadata,store:(documentId:string,versionId:string)=>string):ApplicationDocumentVersion {
    const fingerprint=createHash("sha256").update(JSON.stringify([
      input.documentId ?? null,input.kind ?? null,input.name ?? null,input.originalFileName,input.mediaType,input.sizeBytes,input.contentHash
    ])).digest("hex");
    return this.db.transaction(()=>{
      const prior=this.db.prepare("SELECT * FROM application_document_versions WHERE request_id=?").get(input.requestId) as VersionRow|undefined;
      if(prior) {
        if(prior.request_fingerprint!==fingerprint) throw new ApplicationDocumentError("Document request ID was already used for different content.",409);
        return mapVersion(prior);
      }
      const documentId=input.documentId ?? randomUUID();
      if(input.documentId) {
        this.requireActive(documentId);
      } else this.db.prepare("INSERT INTO application_documents VALUES (?,?,?,?)").run(documentId,input.kind,input.name,input.createdAt.toISOString());
      const versionNumber=(this.db.prepare("SELECT COALESCE(MAX(version_number),0)+1 n FROM application_document_versions WHERE document_id=?").get(documentId) as {n:number}).n;
      const id=randomUUID(),storageKey=store(documentId,id);
      this.db.prepare("INSERT INTO application_document_versions VALUES (?,?,?,?,?,?,?,?,?,?,?)").run(
        id,documentId,versionNumber,input.originalFileName,input.mediaType,input.sizeBytes,input.contentHash,storageKey,input.createdAt.toISOString(),input.requestId,fingerprint);
      return this.findVersion(id)!;
    }).immediate();
  }
  private requireActive(id:string):void {
    const document=this.list().find(d=>d.id===id);
    if(!document) throw new ApplicationDocumentError("Document not found.",404);
    if(document.archivedAt) throw new ApplicationDocumentError("Restore this archived document before importing or selecting a version.",409);
  }
  changeLifecycle(input:DocumentLifecycleCommand,at:Date):void {
    validateDocumentRequestId(input.requestId);
    if(!["RENAME","ARCHIVE","RESTORE"].includes(input.operation)) throw new ApplicationDocumentError("Invalid document operation.",400);
    const name=input.operation==="RENAME"?input.name:null;
    if(input.operation==="RENAME" && (typeof name!=="string" || !name.trim() || name.length>200)) throw new ApplicationDocumentError("Document name must contain 1 to 200 characters.",400);
    this.db.transaction(()=>{
      const prior=this.db.prepare("SELECT document_id,operation,name FROM application_document_changes WHERE request_id=?").get(input.requestId) as {document_id:string;operation:string;name:string|null}|undefined;
      if(prior) {
        if(prior.document_id!==input.documentId || prior.operation!==input.operation || prior.name!==name)
          throw new ApplicationDocumentError("Document lifecycle request ID was already used for different content.",409);
        return; // Never replay an old rename/archive over a later decision.
      }
      if(!this.db.prepare("SELECT 1 FROM application_documents WHERE id=?").get(input.documentId)) throw new ApplicationDocumentError("Document not found.",404);
      this.db.prepare("INSERT INTO application_document_changes VALUES (?,?,?,?,?)").run(input.requestId,input.documentId,input.operation,name,at.toISOString());
    }).immediate();
  }
  list():readonly ApplicationDocument[] {
    const documents=(this.db.prepare("SELECT * FROM application_documents ORDER BY created_at,rowid").all() as {id:string;kind:ApplicationDocument["kind"];name:string;created_at:string}[])
      .map(row=>({id:row.id,kind:row.kind,name:row.name,createdAt:new Date(row.created_at),archivedAt:null as Date|null}));
    const byId=new Map(documents.map(d=>[d.id,d]));
    const changes=this.db.prepare("SELECT * FROM application_document_changes ORDER BY rowid").all() as {document_id:string;operation:string;name:string|null;created_at:string}[];
    for(const change of changes) {
      const document=byId.get(change.document_id)!;
      if(change.operation==="RENAME") document.name=change.name!;
      else if(change.operation==="ARCHIVE") document.archivedAt ??= new Date(change.created_at);
      else document.archivedAt=null;
    }
    return documents;
  }
  referenceCounts():ReadonlyMap<string,{referenceCount:number;currentReferenceCount:number}> {
    // All associations count, including superseded selections and archived vacancies.
    const rows=this.db.prepare(`WITH ranked AS (
      SELECT a.document_version_id,ROW_NUMBER() OVER (
        PARTITION BY a.canonical_vacancy_id,d.kind ORDER BY a.rowid DESC) AS position
      FROM vacancy_application_documents a JOIN application_document_versions v ON v.id=a.document_version_id
      JOIN application_documents d ON d.id=v.document_id
    ) SELECT document_version_id,COUNT(*) AS total,SUM(CASE WHEN position=1 THEN 1 ELSE 0 END) AS current
      FROM ranked GROUP BY document_version_id`).all() as {document_version_id:string;total:number;current:number}[];
    return new Map(rows.map(r=>[r.document_version_id,{referenceCount:r.total,currentReferenceCount:r.current}]));
  }
  versions() {return (this.db.prepare("SELECT * FROM application_document_versions ORDER BY document_id,version_number").all() as VersionRow[]).map(mapVersion);}
  findVersion(id:string) {
    const row=this.db.prepare("SELECT * FROM application_document_versions WHERE id=?").get(id) as VersionRow|undefined;
    return row?mapVersion(row):null;
  }
  associate(input:{canonicalVacancyId:string;versionId:string;requestId:string;createdAt:Date},verify:()=>void):void {
    validateDocumentRequestId(input.requestId);
    this.db.transaction(()=>{
      if(!this.db.prepare("SELECT 1 FROM canonical_vacancies WHERE id=?").get(input.canonicalVacancyId)) throw new ApplicationDocumentError("Vacancy not found.",404);
      const prior=this.db.prepare("SELECT canonical_vacancy_id,document_version_id FROM vacancy_application_documents WHERE id=?").get(input.requestId) as {canonical_vacancy_id:string;document_version_id:string}|undefined;
      if(prior) {
        if(prior.canonical_vacancy_id!==input.canonicalVacancyId || prior.document_version_id!==input.versionId) throw new ApplicationDocumentError("Association request ID was already used for different content.",409);
        return;
      }
      const version=this.findVersion(input.versionId);
      if(!version) throw new ApplicationDocumentError("Document version not found.",404);
      this.requireActive(version.documentId);
      verify();
      this.db.prepare("INSERT INTO vacancy_application_documents VALUES (?,?,?,?)").run(input.requestId,input.canonicalVacancyId,input.versionId,input.createdAt.toISOString());
    }).immediate();
  }
  associations(id:string):readonly VacancyApplicationDocument[] {
    const rows=this.db.prepare(`SELECT a.*,d.kind FROM vacancy_application_documents a
      JOIN application_document_versions v ON v.id=a.document_version_id
      JOIN application_documents d ON d.id=v.document_id WHERE a.canonical_vacancy_id=? ORDER BY a.rowid`).all(id) as {
        id:string;canonical_vacancy_id:string;document_version_id:string;created_at:string;kind:string
      }[];
    const latest=new Map(rows.map(row=>[row.kind,row.id]));
    return rows.map(row=>({id:row.id,canonicalVacancyId:row.canonical_vacancy_id,documentVersionId:row.document_version_id,createdAt:new Date(row.created_at),current:latest.get(row.kind)===row.id}));
  }
}
