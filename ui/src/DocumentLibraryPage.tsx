import { useEffect, useRef, useState } from "react";
import { archiveLibraryDocument, downloadDocumentVersion, getDocumentLibrary, importLibraryDocument, renameLibraryDocument, restoreLibraryDocument, type DocumentLibrary } from "./api";
import { DocumentImportForm } from "./DocumentImportForm";

export function DocumentLibraryPage() {
  const [library,setLibrary]=useState<DocumentLibrary|null>(null),[filter,setFilter]=useState("ACTIVE"),[selected,setSelected]=useState<string|null>(null);
  const [error,setError]=useState<string|null>(null),[pending,setPending]=useState(false),[newDocument,setNewDocument]=useState(false);
  useEffect(()=>{let current=true;getDocumentLibrary().then(data=>{if(current) setLibrary(data);}).catch(()=>{if(current) setError("Unable to load document library.");});return()=>{current=false;};},[]);
  async function imported(input:Record<string,unknown>) {setLibrary(await importLibraryDocument(input));}
  const document=library?.find(d=>d.id===selected);
  return <main className="page"><a href="/today">Today</a> <a href="/">Back to inbox</a><a href="/contacts">Contacts</a> <a href="/backup">Backup &amp; Restore</a><h1>Documents</h1>
    <p>Reusable private CVs and motivation letters. Vacancy associations mean selected, not sent.</p>
    <p>Archive hides a document from future selection; it does not delete files or vacancy history. Permanent deletion is not available, including for unreferenced versions.</p>
    {error && <p role="alert">{error}</p>}
    {!library?(!error?<p>Loading documents...</p>:null):<>
      <label>Document filter <select value={filter} onChange={e=>{setFilter(e.target.value);setSelected(null);}}><option value="ACTIVE">Active</option><option value="ARCHIVED">Archived</option><option value="ALL">All</option></select></label>
      <button onClick={()=>setNewDocument(!newDocument)}>Import new document</button>
      {newDocument && <section aria-label="New library document"><DocumentImportForm documents={[]} onImport={imported} /></section>}
      <ul aria-label="Document library">{library.filter(d=>filter==="ALL"||(filter==="ARCHIVED"?!!d.archivedAt:!d.archivedAt)).map(d=><li key={d.id}>
        <button onClick={()=>setSelected(d.id)}>{d.name}</button> - {d.kind==="CV"?"CV":"Motivation letter"} - {d.archivedAt?"Archived":"Active"} - {d.versions.length} versions - Latest: {d.versions.length?"v"+d.versions[d.versions.length-1]!.versionNumber:"none"}
      </li>)}</ul>
      {!library.some(d=>filter==="ALL"||(filter==="ARCHIVED"?!!d.archivedAt:!d.archivedAt)) && <p>No documents in this view.</p>}
      {document && <DocumentDetail key={document.id} document={document} onSaved={setLibrary} pending={pending} setPending={setPending} />}
    </>}
  </main>;
}
function DocumentDetail({document,onSaved,pending,setPending}:{document:DocumentLibrary[number];onSaved:(data:DocumentLibrary)=>void;pending:boolean;setPending:(pending:boolean)=>void}) {
  const [name,setName]=useState(document.name),[error,setError]=useState<string|null>(null);
  const retries=useRef(new Map<string,string>());
  useEffect(()=>setName(document.name),[document.name]);
  async function change(operation:"rename"|"archive"|"restore") {
    setPending(true);setError(null);
    const key=operation+":"+(operation==="rename"?name:""),requestId=retries.current.get(key)??crypto.randomUUID();retries.current.set(key,requestId);
    try {
      const data=operation==="rename"?await renameLibraryDocument(document.id,name,requestId):operation==="archive"?await archiveLibraryDocument(document.id,requestId):await restoreLibraryDocument(document.id,requestId);
      onSaved(data);retries.current.delete(key);
    } catch(failure) {setError(failure instanceof Error?failure.message:"Unable to update document.");}
    finally {setPending(false);}
  }
  return <section aria-label="Document detail"><h2>{document.name}</h2><p>{document.archivedAt?"Archived":"Active"}</p>
    {error && <p role="alert">{error}</p>}
    <form onSubmit={e=>{e.preventDefault();void change("rename");}}><label>Rename document <input required maxLength={200} value={name} disabled={pending} onChange={e=>setName(e.target.value)}/></label><button disabled={pending||!name.trim()||name===document.name}>Save document name</button></form>
    <button disabled={pending} onClick={()=>void change(document.archivedAt?"restore":"archive")}>{document.archivedAt?"Restore document":"Archive document"}</button>
    <h3>Version history</h3>
    <ol>{document.versions.map(v=><li key={v.id}>v{v.versionNumber} - {v.originalFileName} - <time dateTime={v.createdAt}>{new Date(v.createdAt).toLocaleString()}</time> - {v.sizeBytes} bytes - {v.integrity}
      <p>{v.referenceCount} references ({v.currentReferenceCount} current, {v.referenceCount-v.currentReferenceCount} historical). {v.referenceCount>0?"Protected by vacancy history.":"Unreferenced; retained until explicit safe deletion is supported."}</p>
      {v.integrity==="AVAILABLE"?<button type="button" onClick={()=>void downloadDocumentVersion(v.id,v.originalFileName).catch(failure=>setError(failure instanceof Error?failure.message:"Unable to download this document."))}>Download v{v.versionNumber}</button>:<p role="status">File {v.integrity==="MISSING"?"missing":"failed integrity verification"}; historical record retained. New selection and download unavailable.</p>}
      <details><summary>Integrity details for v{v.versionNumber}</summary><code>SHA-256: {v.contentHash}</code></details>
    </li>)}</ol>
    {document.archivedAt?<p>Restore this document to import or select another version. Existing selections and intact downloads remain available.</p>:<details><summary>Add version</summary><DocumentImportForm key={document.id} documents={[document]} initialDocumentId={document.id} allowNew={false} disabled={pending} onImport={async input=>onSaved(await importLibraryDocument(input))}/></details>}
  </section>;
}
