import { useEffect, useRef, useState } from "react";
import { addVacancyNote, setVacancyPriority, type ReviewView } from "./api";
import { vacancyPriorities, type VacancyPriority } from "../../src/domain/user/VacancyCrm.js";

export function VacancyCrmSection({review,onSaved,disabled}: {
  readonly review: ReviewView; readonly onSaved:(view:ReviewView)=>void; readonly disabled:boolean;
}) {
  const [priority,setPriority]=useState<VacancyPriority>(review.crm?.priority ?? "NONE");
  const [text,setText]=useState("");
  const [pending,setPending]=useState(false);
  const [error,setError]=useState<string|null>(null);
  const requestId=useRef<string|null>(null);
  useEffect(()=>{setPriority(review.crm?.priority ?? "NONE");},[review.crm?.priority]);
  if(!review.crm) return null;
  async function save(kind:"priority"|"note") {
    setPending(true);setError(null);
    try {
      if(kind==="priority") onSaved(await setVacancyPriority(review.vacancy.canonicalVacancyId,priority));
      else {
        requestId.current ??= crypto.randomUUID();
        onSaved(await addVacancyNote(review.vacancy.canonicalVacancyId,requestId.current,text));
        setText("");requestId.current=null;
      }
    } catch(failure) {setError(failure instanceof Error ? failure.message : "Unable to save private CRM information.");}
    finally {setPending(false);}
  }
  return <section aria-label="Private opportunity notes and priority">
    <h2>My opportunity</h2>
    <p>Private notes and priority do not change application status or employer recognition.</p>
    {error && <p role="alert">{error}</p>}
    <form onSubmit={event=>{event.preventDefault();void save("priority");}}>
      <label>Priority <select value={priority} disabled={disabled||pending} onChange={event=>setPriority(event.target.value as VacancyPriority)}>
        {vacancyPriorities.map(value=><option key={value} value={value}>{value==="NONE"?"No priority":value[0]+value.slice(1).toLowerCase()}</option>)}
      </select></label>
      <button type="submit" disabled={disabled||pending||priority===review.crm.priority}>Save priority</button>
    </form>
    <h3>Notes</h3>
    <p>Notes are kept in chronological order. Add a new note to clarify an earlier one.</p>
    {review.crm.notes.length===0 ? <p>No notes yet.</p> : <ol>{review.crm.notes.map(note=><li key={note.id}>
      <time dateTime={note.createdAt}>{new Date(note.createdAt).toLocaleString()}</time>
      <p style={{whiteSpace:"pre-wrap",overflowWrap:"anywhere"}}>{note.text}</p>
    </li>)}</ol>}
    <form onSubmit={event=>{event.preventDefault();void save("note");}}>
      <label>New note <textarea value={text} maxLength={10000} disabled={disabled||pending} onChange={event=>{setText(event.target.value);requestId.current=null;}}/></label>
      <button type="submit" disabled={disabled||pending||!text.trim()}>Add note</button>
    </form>
  </section>;
}
