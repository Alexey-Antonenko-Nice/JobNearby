import { useRef, useState } from "react";
import { contactRoles, type ContactRole } from "../../src/domain/user/Contact";
import { contactCommand, getReview, type ReviewView } from "./api";
import { ContactForm, type ContactInput } from "./ContactForms";
export function VacancyContactsSection({review,onSaved,disabled}:{review:ReviewView;onSaved:(r:ReviewView)=>void;disabled:boolean}){
  const [selected,setSelected]=useState(""),[role,setRole]=useState<ContactRole>("RECRUITER"),[creating,setCreating]=useState(false),[pending,setPending]=useState(false),[error,setError]=useState<string|null>(null);
  const retry=useRef(new Map<string,string>());const data=review.contacts;if(!data)return null;
  async function send(input:ContactInput){const key=JSON.stringify(input),requestId=retry.current.get(key)??crypto.randomUUID();retry.current.set(key,requestId);const result=await contactCommand({...input,requestId});return result;}
  async function save(input:ContactInput){setPending(true);setError(null);try{
    let result=await send(input);
    if(input.operation==="CREATE")result=await send({operation:"LINK",contactId:result.resultId,canonicalVacancyId:review.vacancy.canonicalVacancyId,role});
    onSaved(await getReview(review.vacancy.canonicalVacancyId));
    retry.current.clear();setCreating(false);setSelected("");
  }catch(e){setError(e instanceof Error?e.message:"Unable to save contact.");}finally{setPending(false);}}
  return <section aria-label="Vacancy contacts"><h2>Contacts</h2><a href="/contacts">Manage contacts</a>{error&&<p role="alert">{error}</p>}
    <ul>{data.relationships.map(r=>{const c=data.library.find(c=>c.id===r.contactId)!;return <li key={r.id}>{c.displayName} — {r.role} {c.archivedAt&&"(Archived contact)"} {r.endedAt?"Ended "+r.endedAt:"Active"}<ul>{c.methods.map(m=><li key={m.id}>{m.type}: {m.value}</li>)}</ul>{!r.endedAt&&<button disabled={disabled||pending} onClick={()=>void save({operation:"END_LINK",contactId:c.id,relationshipId:r.id})}>End relationship with {c.displayName}</button>}</li>;})}</ul>
    <label>Contact role<select value={role} disabled={pending} onChange={e=>setRole(e.target.value as ContactRole)}>{contactRoles.map(r=><option key={r}>{r}</option>)}</select></label>
    <label>Existing contact<select value={selected} onChange={e=>setSelected(e.target.value)}><option value="">Choose contact</option>{data.library.filter(c=>!c.archivedAt).map(c=><option key={c.id} value={c.id}>{c.displayName} — {c.jobTitle} — {c.methods[0]?.value??c.id}</option>)}</select></label>
    <button disabled={disabled||pending||!selected} onClick={()=>void save({operation:"LINK",contactId:selected,canonicalVacancyId:review.vacancy.canonicalVacancyId,role})}>Link contact</button>
    <button disabled={disabled||pending} onClick={()=>setCreating(!creating)}>Create and link contact</button>
    {creating&&<ContactForm save={save} disabled={disabled||pending}/>}</section>;
}
