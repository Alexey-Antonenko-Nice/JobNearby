import { useRef, useState } from "react";
import { associateVacancyDocument, documentDownloadUrl, importApplicationDocument, type ReviewView } from "./api";
import { DocumentImportForm } from "./DocumentImportForm";

const labels={CV:"CV",MOTIVATION_LETTER:"Motivation letter"};
export function VacancyDocumentsSection({review,onSaved,disabled}:{review:ReviewView;onSaved:(review:ReviewView)=>void;disabled:boolean}) {
  const [selection,setSelection]=useState<Record<string,string>>({});
  const [pending,setPending]=useState(false), [error,setError]=useState<string|null>(null);
  const retries=useRef(new Map<string,string>());
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
  return <section aria-label="Application documents">
    <h2>Application documents</h2>
    <a href="/documents">Manage document library</a>
    <p>Selected for this vacancy, not proof of sending. Imported versions are private, immutable copies.</p>
    {error && <p role="alert">{error}</p>}
    {(["CV","MOTIVATION_LETTER"] as const).map(role=>{
      const current=data.associations.find(a=>a.current && versions.some(v=>v.version.id===a.documentVersionId && v.doc.kind===role));
      const chosen=versions.find(v=>v.version.id===current?.documentVersionId);
      return <div key={role}>
        <h3>{labels[role]}</h3>
        <p>{chosen?"Selected: "+chosen.doc.name+" — v"+chosen.version.versionNumber:"No "+labels[role].toLowerCase()+" selected."}</p>
        {chosen && <p>{chosen.version.originalFileName} — {chosen.version.integrity}{chosen.doc.archivedAt && " - Document archived; selection preserved"}
          {chosen.version.integrity==="AVAILABLE" && <> <a href={documentDownloadUrl(chosen.version.id)}>Download selected {labels[role].toLowerCase()}</a></>}
        </p>}
        <form onSubmit={event=>{event.preventDefault();const versionId=selection[role];if(versionId) void save(async()=>{const signature="select:"+role+":"+versionId;const next=await associateVacancyDocument(review.vacancy.canonicalVacancyId,versionId,idFor(signature));retries.current.delete(signature);return next;});}}>
          <label>{labels[role]} version <select aria-label={labels[role]+" version"} value={selection[role]??""} disabled={disabled||pending} onChange={e=>setSelection({...selection,[role]:e.target.value})}>
            <option value="">Choose an existing version</option>
            {versions.filter(v=>v.doc.kind===role && !v.doc.archivedAt).map(({doc,version})=><option key={version.id} value={version.id} disabled={version.integrity!=="AVAILABLE"}>{doc.name} — v{version.versionNumber} — {version.originalFileName}{version.integrity!=="AVAILABLE"?" ("+version.integrity+")":""}</option>)}
          </select></label>
          <button disabled={disabled||pending||!selection[role]||selection[role]===current?.documentVersionId}>Select {labels[role].toLowerCase()} version</button>
        </form>
      </div>;
    })}
    <details><summary>Import a document version</summary>
      <DocumentImportForm documents={data.library} disabled={disabled||pending}
        onImport={async input=>onSaved(await importApplicationDocument(review.vacancy.canonicalVacancyId,input))} />
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
