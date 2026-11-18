import { closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, renameSync, rmdirSync, unlinkSync, writeFileSync } from "node:fs";
import { join, resolve, parse } from "node:path";
import { ApplicationDocumentError, MAX_DOCUMENT_BYTES, type ManagedDocumentStorage } from "../../domain/user/ApplicationDocument.js";
const uuid="[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const keyPattern=new RegExp("^documents/("+uuid+")/("+uuid+")/content$","u");
export class LocalManagedDocumentStorage implements ManagedDocumentStorage {
  private readonly root:string;
  constructor(root:string) {this.root=resolve(root);}
  private safePath(key:string):string {
    if(!keyPattern.test(key)) throw new ApplicationDocumentError("Invalid document storage identifier.",400);
    let path=parse(this.root).root;
    for(const part of [...this.root.slice(path.length).split(/[\\/]/u),...key.split("/")]) {
      if(part) path=join(path,part);
      if(existsSync(path) && lstatSync(path).isSymbolicLink()) throw new ApplicationDocumentError("Unsafe document storage link.",409);
    }
    return path;
  }
  store(documentId:string,versionId:string,bytes:Uint8Array) {
    if(bytes.length===0 || bytes.length>MAX_DOCUMENT_BYTES) throw new ApplicationDocumentError("Invalid document size.",413);
    const key="documents/"+documentId+"/"+versionId+"/content";
    this.safePath(key);
    const directory=join(this.root,"documents",documentId), final=join(directory,versionId);
    mkdirSync(directory,{recursive:true,mode:0o700});
    this.safePath(key);
    const stage=mkdtempSync(join(directory,".import-"));
    const stagedFile=join(stage,"content");
    let moved=false;
    const remove=()=>{
      const folder=moved?final:stage, file=join(folder,"content");
      this.safePath(key);
      if(existsSync(file)) unlinkSync(file);
      if(existsSync(folder)) rmdirSync(folder);
    };
    try {
      const fd=openSync(stagedFile,"wx",0o600);
      try {writeFileSync(fd,bytes);fsyncSync(fd);} finally {closeSync(fd);}
      if(!readFileSync(stagedFile).equals(Buffer.from(bytes))) throw Error("Staged file verification failed.");
      if(existsSync(final)) throw Error("Document storage collision.");
      renameSync(stage,final);moved=true;
      return {key,rollback:remove};
    } catch(error) {remove();throw error;}
  }
  read(key:string):Uint8Array {
    const file=this.safePath(key);
    if(!existsSync(file)) throw new ApplicationDocumentError("Managed document file is missing. Restore it from backup.",404);
    const stat=lstatSync(file);
    if(!stat.isFile() || stat.size>MAX_DOCUMENT_BYTES) throw new ApplicationDocumentError("Managed document integrity check failed.",409);
    return readFileSync(file);
  }
}
