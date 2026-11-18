import { createHash } from "node:crypto";
import {
  ApplicationDocumentError, validateDocumentImport, type ApplicationDocumentLibrary, type ApplicationDocumentRepository,
  type ManagedDocumentStorage, type ImportApplicationDocument, type ApplicationDocumentVersion, type ApplicationDocumentsView
} from "../../domain/user/ApplicationDocument.js";

/** No external source path is retained; only exact imported bytes define a version. */
export class ManagedApplicationDocumentLibrary implements ApplicationDocumentLibrary {
  constructor(private readonly repository:ApplicationDocumentRepository,private readonly storage:ManagedDocumentStorage,
    private readonly now:()=>Date=()=>new Date()) {}
  private verified(version:ApplicationDocumentVersion):Uint8Array {
    let bytes:Uint8Array;
    try {bytes=this.storage.read(version.storageKey);} catch(error) {
      if(error instanceof ApplicationDocumentError) throw error;
      throw new ApplicationDocumentError("Managed document could not be read.",500);
    }
    if(bytes.length!==version.sizeBytes || createHash("sha256").update(bytes).digest("hex")!==version.contentHash)
      throw new ApplicationDocumentError("Managed document integrity check failed.",409);
    return bytes;
  }
  importVersion(input:ImportApplicationDocument):ApplicationDocumentVersion {
    validateDocumentImport(input);
    let rollback:(()=>void)|undefined;
    try {
      const {bytes,...metadata}=input;
      const version=this.repository.importVersion({...metadata,sizeBytes:bytes.length,
        contentHash:createHash("sha256").update(bytes).digest("hex"),createdAt:this.now()},(documentId,versionId)=>{
          const stored=this.storage.store(documentId,versionId,bytes);rollback=stored.rollback;return stored.key;
        });
      // A retry verifies the existing immutable file; it never replaces a missing version.
      if(!rollback) this.verified(version);
      return version;
    } catch(error) {
      if(rollback) {
        try {rollback();} catch {throw new ApplicationDocumentError("Import failed and file cleanup could not finish. Storage needs review.",500);}
      }
      if(error instanceof ApplicationDocumentError) throw error;
      throw new ApplicationDocumentError("Document import failed; no version was registered.",500);
    }
  }
  associate(input:{canonicalVacancyId:string;versionId:string;requestId:string}):void {
    this.repository.associate({...input,createdAt:this.now()},()=>{
      const version=this.repository.findVersion(input.versionId);
      if(!version) throw new ApplicationDocumentError("Document version not found.",404);
      this.verified(version);
    });
  }
  rename(input:{documentId:string;requestId:string;name:string}):void {this.repository.changeLifecycle({...input,operation:"RENAME"},this.now());}
  archive(input:{documentId:string;requestId:string}):void {this.repository.changeLifecycle({...input,operation:"ARCHIVE"},this.now());}
  restore(input:{documentId:string;requestId:string}):void {this.repository.changeLifecycle({...input,operation:"RESTORE"},this.now());}
  forVacancy(id:string):ApplicationDocumentsView {
    return {library:this.list(),associations:this.repository.associations(id)};
  }
  list():ApplicationDocumentsView["library"] {
    const versions=this.repository.versions(), references=this.repository.referenceCounts();
    return this.repository.list().map(document=>({...document,versions:versions.filter(v=>v.documentId===document.id).map(version=>{
      const {storageKey,...metadata}=version;
      let integrity:"AVAILABLE"|"MISSING"|"CORRUPT"="AVAILABLE";
      try {this.verified(version);} catch(error) {integrity=error instanceof ApplicationDocumentError && error.status===404?"MISSING":"CORRUPT";}
      return {...metadata,integrity,...(references.get(version.id)??{referenceCount:0,currentReferenceCount:0})};
    })}));
  }
  download(id:string) {
    const version=this.repository.findVersion(id);
    if(!version) throw new ApplicationDocumentError("Document version not found.",404);
    return {bytes:this.verified(version),originalFileName:version.originalFileName};
  }
}
