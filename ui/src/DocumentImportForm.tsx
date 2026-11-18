import { useRef, useState } from "react";
import { MAX_DOCUMENT_BYTES, type ApplicationDocumentKind } from "../../src/domain/user/ApplicationDocument.js";
import type { DocumentLibrary } from "./api";

/** Shared by Review and the library: one file-reader, size limit and retry identity. */
export function DocumentImportForm({documents,onImport,disabled=false,initialDocumentId="",allowNew=true}:{
  documents:DocumentLibrary;onImport:(input:Record<string,unknown>)=>Promise<void>;disabled?:boolean;initialDocumentId?:string;allowNew?:boolean;
}) {
  const [kind,setKind]=useState<ApplicationDocumentKind>("CV"),[name,setName]=useState("");
  const [documentId,setDocumentId]=useState(initialDocumentId),[file,setFile]=useState<File|null>(null);
  const [pending,setPending]=useState(false),[error,setError]=useState<string|null>(null);
  const retries=useRef(new Map<string,string>()),fileInput=useRef<HTMLInputElement>(null);
  async function submit() {
    if(!file) return;
    setPending(true);setError(null);
    try {
      if(!file.size || file.size>MAX_DOCUMENT_BYTES) throw Error("Choose a nonempty file no larger than 5 MiB.");
      const contentBase64=await new Promise<string>((resolve,reject)=>{
        const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(",")[1]??"");
        reader.onerror=()=>reject(Error("Unable to read selected file."));reader.readAsDataURL(file);
      });
      const input={...(documentId?{documentId}:{name,kind}),originalFileName:file.name,mediaType:file.type||null,contentBase64};
      const signature=JSON.stringify(input),requestId=retries.current.get(signature)??crypto.randomUUID();
      retries.current.set(signature,requestId);
      await onImport({...input,requestId});retries.current.delete(signature);
      setFile(null);if(fileInput.current) fileInput.current.value="";
    } catch(failure) {setError(failure instanceof Error?failure.message:"Unable to import document.");}
    finally {setPending(false);}
  }
  return <form onSubmit={e=>{e.preventDefault();void submit();}}>
    {error && <p role="alert">{error}</p>}
    <fieldset disabled={disabled||pending}>
      <label>Logical document <select value={documentId} onChange={e=>setDocumentId(e.target.value)} disabled={!allowNew}>
        {allowNew && <option value="">Create a new document</option>}
        {documents.filter(d=>!d.archivedAt).map(d=><option key={d.id} value={d.id}>{d.name} ({d.kind==="CV"?"CV":"Motivation letter"})</option>)}
      </select></label>
      {!documentId && <><label>Document kind <select value={kind} onChange={e=>setKind(e.target.value as ApplicationDocumentKind)}><option value="CV">CV</option><option value="MOTIVATION_LETTER">Motivation letter</option></select></label>
        <label>Document name <input value={name} maxLength={200} required onChange={e=>setName(e.target.value)} /></label></>}
      <label>Document file (maximum 5 MiB) <input ref={fileInput} type="file" required onChange={e=>setFile(e.target.files?.[0]??null)} /></label>
      <button disabled={!file||(!documentId&&!name.trim())}>Import immutable version</button>
    </fieldset>
  </form>;
}
