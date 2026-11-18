export const applicationDocumentKinds = ["CV", "MOTIVATION_LETTER"] as const;
export type ApplicationDocumentKind = typeof applicationDocumentKinds[number];
export const MAX_DOCUMENT_BYTES = 5 * 1024 * 1024;

export interface ApplicationDocument {
  readonly id:string;
  readonly kind:ApplicationDocumentKind;
  readonly name:string;
  readonly createdAt:Date;
}
export interface ApplicationDocumentVersion {
  readonly id:string;
  readonly documentId:string;
  readonly versionNumber:number;
  readonly originalFileName:string;
  readonly mediaType:string|null;
  readonly sizeBytes:number;
  readonly contentHash:string;
  readonly storageKey:string;
  readonly createdAt:Date;
}
export interface VacancyApplicationDocument {
  readonly id:string;
  readonly canonicalVacancyId:string;
  readonly documentVersionId:string;
  readonly createdAt:Date;
  readonly current:boolean;
}
export type DocumentVersionView = Omit<ApplicationDocumentVersion,"storageKey"> & {
  readonly integrity:"AVAILABLE"|"MISSING"|"CORRUPT";
};
export interface ApplicationDocumentsView {
  readonly library:readonly (ApplicationDocument & {readonly versions:readonly DocumentVersionView[]})[];
  readonly associations:readonly VacancyApplicationDocument[];
}
export type ImportApplicationDocument = {
  readonly requestId:string;
  readonly originalFileName:string;
  readonly mediaType:string|null;
  readonly bytes:Uint8Array;
} & ({readonly documentId:string} | {readonly name:string;readonly kind:ApplicationDocumentKind});
export type DocumentImportMetadata = Omit<ImportApplicationDocument,"bytes"> & {
  readonly documentId?:string;readonly name?:string;readonly kind?:ApplicationDocumentKind;
  readonly sizeBytes:number;readonly contentHash:string;readonly createdAt:Date;
};
export interface ApplicationDocumentRepository {
  importVersion(input:DocumentImportMetadata,store:(documentId:string,versionId:string)=>string):ApplicationDocumentVersion;
  list():readonly ApplicationDocument[];
  versions():readonly ApplicationDocumentVersion[];
  findVersion(id:string):ApplicationDocumentVersion|null;
  associate(input:{canonicalVacancyId:string;versionId:string;requestId:string;createdAt:Date},verify:()=>void):void;
  associations(canonicalVacancyId:string):readonly VacancyApplicationDocument[];
}
export interface ManagedDocumentStorage {
  store(documentId:string,versionId:string,bytes:Uint8Array):{key:string;rollback:()=>void};
  read(key:string):Uint8Array;
}
export interface ApplicationDocumentLibrary {
  importVersion(input:ImportApplicationDocument):ApplicationDocumentVersion;
  associate(input:{canonicalVacancyId:string;versionId:string;requestId:string}):void;
  forVacancy(id:string):ApplicationDocumentsView;
  download(id:string):{bytes:Uint8Array;originalFileName:string};
}
export class ApplicationDocumentError extends Error {
  constructor(message:string,readonly status:400|404|409|413|500) {super(message);}
}
export function validateDocumentRequestId(value:unknown):asserts value is string {
  if(typeof value!=="string" || !value.trim() || value.length>200) throw new ApplicationDocumentError("Invalid document request ID.",400);
}
export function validateDocumentImport(input:ImportApplicationDocument):void {
  validateDocumentRequestId(input.requestId);
  if(!(input.bytes instanceof Uint8Array) || input.bytes.length===0 || input.bytes.length>MAX_DOCUMENT_BYTES)
    throw new ApplicationDocumentError("Choose a nonempty file no larger than 5 MiB.",413);
  if(typeof input.originalFileName!=="string" || !input.originalFileName.trim() || input.originalFileName.length>255
    || /[\/\\:\u0000-\u001f\u007f]/u.test(input.originalFileName) || [".",".."].includes(input.originalFileName))
    throw new ApplicationDocumentError("Use a filename without paths or control characters.",400);
  if(input.mediaType!==null && (typeof input.mediaType!=="string" || input.mediaType.length>150 || !/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/iu.test(input.mediaType)))
    throw new ApplicationDocumentError("Invalid media type metadata.",400);
  if("documentId" in input) {
    if(typeof input.documentId!=="string" || !input.documentId.trim()) throw new ApplicationDocumentError("Choose a logical document.",400);
  } else if(!applicationDocumentKinds.includes(input.kind) || typeof input.name!=="string" || !input.name.trim() || input.name.length>200)
    throw new ApplicationDocumentError("Choose CV or MOTIVATION_LETTER and a document name of 1 to 200 characters.",400);
}
