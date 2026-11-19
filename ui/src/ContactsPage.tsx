import { useEffect, useRef, useState } from "react";
import type { Contact } from "../../src/domain/user/Contact";
import { contactCommand, getContacts } from "./api";
import { ContactForm, ContactMethodForm, type ContactInput } from "./ContactForms";
export function ContactsPage(){
  const [contacts,setContacts]=useState<Contact[]>([]),[selected,setSelected]=useState<string|null>(null),[filter,setFilter]=useState("ACTIVE"),[search,setSearch]=useState("");
  const [error,setError]=useState<string|null>(null),[pending,setPending]=useState(false);
  const retry=useRef(new Map<string,string>());
  useEffect(()=>{let live=true;getContacts().then(c=>{if(live)setContacts(c);}).catch(()=>{if(live)setError("Unable to load contacts.");});return()=>{live=false;};},[]);
  async function save(input:ContactInput){
    setPending(true);setError(null);const key=JSON.stringify(input),requestId=retry.current.get(key)??crypto.randomUUID();retry.current.set(key,requestId);
    try{const result=await contactCommand({...input,requestId});setContacts(result.contacts);if(input.operation==="CREATE")setSelected(result.resultId);retry.current.delete(key);}catch(e){setError(e instanceof Error?e.message:"Unable to save contact.");}finally{setPending(false);}
  }
  const contact=contacts.find(c=>c.id===selected);
  return <main className="page"><nav><a href="/">Inbox</a> <a href="/documents">Documents</a></nav><h1>Contacts</h1>
    <p>Private local contacts. No automatic merging, enrichment or synchronization. Archive retains relationships; permanent deletion is unavailable.</p>
    {error&&<p role="alert">{error}</p>}
    <label>Contact search<input value={search} onChange={e=>setSearch(e.target.value)}/></label>
    <label>Contact visibility<select value={filter} onChange={e=>setFilter(e.target.value)}><option>ACTIVE</option><option>ARCHIVED</option><option>ALL</option></select></label>
    <ul>{contacts.filter(c=>(filter==="ALL"||(filter==="ARCHIVED")===Boolean(c.archivedAt))&&[c.displayName,...c.methods.map(m=>m.value)].join(" ").toLowerCase().includes(search.toLowerCase())).map(c=><li key={c.id}><button onClick={()=>setSelected(c.id)}>{c.displayName}</button> {c.jobTitle} {c.methods[0]?.value} {c.archivedAt?"Archived":"Active"}</li>)}</ul>
    <button onClick={()=>setSelected(null)}>New contact</button>
    <section aria-label="Contact detail"><h2>{contact?.displayName??"New contact"}</h2><ContactForm key={contact?.id??"new"} {...(contact?{contact}:{})} save={save} disabled={pending}/>
    {contact&&<><button disabled={pending} onClick={()=>void save({operation:contact.archivedAt?"RESTORE":"ARCHIVE",contactId:contact.id})}>{contact.archivedAt?"Restore contact":"Archive contact"}</button>
      <h3>Contact methods</h3>{contact.methods.map(m=><ContactMethodForm key={m.id} contactId={contact.id} method={m} save={save} disabled={pending}/>)}<ContactMethodForm key={contact.id} contactId={contact.id} save={save} disabled={pending}/>
      <h3>Linked activity</h3><ul>{contact.activities?.map(a=><li key={a.kind+a.id}><a href={"/review/"+encodeURIComponent(a.canonicalVacancyId)}>{a.description}</a> - {a.kind} - {a.status} - {new Date(a.at).toLocaleString()}</li>)}</ul>
      <h3>Linked vacancies</h3><ul>{contact.relationships.map(r=><li key={r.id}><a href={"/review/"+encodeURIComponent(r.canonicalVacancyId)}>{r.canonicalVacancyId}</a> — {r.role} — {r.endedAt?"Ended "+r.endedAt:"Active"}</li>)}</ul>
    </>}</section></main>;
}
