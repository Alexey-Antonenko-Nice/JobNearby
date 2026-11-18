import { useRef, useState } from "react";
import { associateVacancyDocument, documentDownloadUrl, importApplicationDocument, type ReviewView } from "./api";
import { MAX_DOCUMENT_BYTES, type ApplicationDocumentKind } from "../../src/domain/user/ApplicationDocument.js";

const labels={CV:"CV",MOTIVATION_LETTER:"Motivation letter"};
export function VacancyDocumentsSection({review,onSaved,disabled}:{review:ReviewView;onSaved:(review:ReviewView)=>void;disabled:boolean}) {
  const [kind,setKind]=useState<ApplicationDocumentKind>("CV"), [name,setName]=useState(""), [documentId,setDocumentId]=useState("");
  const [file,setFile]=useState<File|null>(null), [selection,setSelection]=useState<Record<string,string>>({});
  const [pending,setPending]=useState(false), [error,setError]=useState<string|null>(null);
  const retries=useRef(new Map<string,string>()), fileInput=useRef<HTMLInputElement>(null);
  const data=review.documents;
  if(!data) return null;
  const versions=data.library.flatMap(doc=>doc.versions.map(version=>({doc,version})));
  const idFor=(signature:string)=>{
    const id=retries.current.get(signature)??crypto.randomUUID();
    retries.current.set(signature,id);return id;
  };
  async function save(operation:()=>Promise<ReviewView>) {
    setPending(true);setError(null);
    try {onSaved(await operation());} catch(failure) {setError(failure instanceof Error?failure.message:"Unable to save documents.");}
    finally {setPending(false);}
  }
  async function importFile() {
    if(!file) return;
    await save(async()=>{
      if(!file.size || file.size>MAX_DOCUMENT_BYTES) throw Error("Choose a nonempty file no larger than 5 MiB.");
      const contentBase64=await new Promise<string>((resolve,reject)=>{
        const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(",")[1]??"");reader.onerror=()=>reject(Error("Unable to read selected file."));reader.readAsDataURL(file);
      });
      const input={...(documentId?{documentId}:{name,kind}),originalFileName:file.name,mediaType:file.type||null,contentBase64};
      const signature=JSON.stringify(input);
      const next=await importApplicationDocument(review.vacancy.canonicalVacancyId,{...input,requestId:idFor(signature)});
      retries.current.delete(signature);
      setFile(null);if(fileInput.current) fileInput.current.value="";return next;
    });
  }
  return <section aria-label="Application documents">
    <h2>Application documents</h2>
    <p>Selected for this vacancy, not proof of sending. Imported versions are private, immutable copies.</p>
    {error && <p role="alert">{error}</p>}
    {(["CV","MOTIVATION_LETTER"] as const).map(role=>{
      const current=data.associations.find(a=>a.current && versions.some(v=>v.version.id===a.documentVersionId && v.doc.kind===role));
      const chosen=versions.find(v=>v.version.id===current?.documentVersionId);
      return <div key={role}>
        <h3>{labels[role]}</h3>
        <p>{chosen?"Selected: "+chosen.doc.name+" — v"+chosen.version.versionNumber:"No "+labels[role].toLowerCase()+" selected."}</p>
        {chosen && <p>{chosen.version.originalFileName} — {chosen.version.integrity}
          {chosen.version.integrity==="AVAILABLE" && <> <a href={documentDownloadUrl(chosen.version.id)}>Download selected {labels[role].toLowerCase()}</a></>}
        </p>}
        <form onSubmit={event=>{event.preventDefault();const versionId=selection[role];if(versionId) void save(async()=>{const signature="select:"+role+":"+versionId;const next=await associateVacancyDocument(review.vacancy.canonicalVacancyId,versionId,idFor(signature));retries.current.delete(signature);return next;});}}>
          <label>{labels[role]} version <select aria-label={labels[role]+" version"} value={selection[role]??""} disabled={disabled||pending} onChange={e=>setSelection({...selection,[role]:e.target.value})}>
            <option value="">Choose an existing version</option>
            {versions.filter(v=>v.doc.kind===role).map(({doc,version})=><option key={version.id} value={version.id} disabled={version.integrity!=="AVAILABLE"}>{doc.name} — v{version.versionNumber} — {version.originalFileName}{version.integrity!=="AVAILABLE"?" ("+version.integrity+")":""}</option>)}
          </select></label>
          <button disabled={disabled||pending||!selection[role]||selection[role]===current?.documentVersionId}>Select {labels[role].toLowerCase()} version</button>
        </form>
      </div>;
    })}
    <details><summary>Import a document version</summary>
      <form onSubmit={e=>{e.preventDefault();void importFile();}}>
        <fieldset disabled={disabled||pending}>
          <label>Logical document <select value={documentId} onChange={e=>setDocumentId(e.target.value)}><option value="">Create a new document</option>{data.library.map(d=><option key={d.id} value={d.id}>{d.name} ({labels[d.kind]})</option>)}</select></label>
          {!documentId && <><label>Document kind <select value={kind} onChange={e=>setKind(e.target.value as ApplicationDocumentKind)}><option value="CV">CV</option><option value="MOTIVATION_LETTER">Motivation letter</option></select></label>
            <label>Document name <input value={name} maxLength={200} required onChange={e=>setName(e.target.value)} /></label></>}
          <label>Document file (maximum 5 MiB) <input ref={fileInput} type="file" required onChange={e=>setFile(e.target.files?.[0]??null)} /></label>
          <button disabled={!file||(!documentId&&!name.trim())}>Import immutable version</button>
        </fieldset>
      </form>
      <p>Importing adds a library version. Select it separately for this vacancy. Editing the original file will not change the imported copy.</p>
    </details>
    <details><summary>Document association history ({data.associations.length})</summary>
      {data.associations.length===0?<p>No document associations yet.</p>:<ol>{data.associations.map(a=>{
        const item=versions.find(v=>v.version.id===a.documentVersionId);
        return <li key={a.id}>{item?labels[item.doc.kind]+": "+item.doc.name+" — v"+item.version.versionNumber:"Unavailable version"} — {a.current?"Currently selected":"Previously selected"} — <time dateTime={a.createdAt}>{new Date(a.createdAt).toLocaleString()}</time>
          {item?.version.integrity==="AVAILABLE" && <> <a href={documentDownloadUrl(item.version.id)}>Download associated version</a></>}
        </li>;
      })}</ol>}
    </details>
  </section>;
}
