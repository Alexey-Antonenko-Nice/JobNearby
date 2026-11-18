import { createHash, randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { ApplicationDocumentError, validateDocumentRequestId, type ApplicationDocument, type ApplicationDocumentVersion,
  type ApplicationDocumentRepository, type DocumentImportMetadata, type VacancyApplicationDocument } from "../../domain/user/ApplicationDocument.js";
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
        if(!this.db.prepare("SELECT 1 FROM application_documents WHERE id=?").get(documentId)) throw new ApplicationDocumentError("Document not found.",404);
      } else this.db.prepare("INSERT INTO application_documents VALUES (?,?,?,?)").run(documentId,input.kind,input.name,input.createdAt.toISOString());
      const versionNumber=(this.db.prepare("SELECT COALESCE(MAX(version_number),0)+1 n FROM application_document_versions WHERE document_id=?").get(documentId) as {n:number}).n;
      const id=randomUUID(),storageKey=store(documentId,id);
      this.db.prepare("INSERT INTO application_document_versions VALUES (?,?,?,?,?,?,?,?,?,?,?)").run(
        id,documentId,versionNumber,input.originalFileName,input.mediaType,input.sizeBytes,input.contentHash,storageKey,input.createdAt.toISOString(),input.requestId,fingerprint);
      return this.findVersion(id)!;
    }).immediate();
  }
  list():readonly ApplicationDocument[] {
    return (this.db.prepare("SELECT * FROM application_documents ORDER BY created_at,rowid").all() as {id:string;kind:ApplicationDocument["kind"];name:string;created_at:string}[])
      .map(row=>({id:row.id,kind:row.kind,name:row.name,createdAt:new Date(row.created_at)}));
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
      if(!this.findVersion(input.versionId)) throw new ApplicationDocumentError("Document version not found.",404);
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
