import { useEffect, useRef, useState } from "react";
import { addVacancyNote, setVacancyPriority, setVacancyProcessState, type ReviewView } from "./api";
import { vacancyPriorities, vacancyProcessStates, type VacancyPriority, type VacancyProcessState } from "../../src/domain/user/VacancyCrm.js";

export function VacancyCrmSection({review,onSaved,disabled}: {
  readonly review: ReviewView; readonly onSaved:(view:ReviewView)=>void; readonly disabled:boolean;
}) {
  const [priority,setPriority]=useState<VacancyPriority>(review.crm?.priority ?? "NONE");
  const [processState,setProcessState]=useState<VacancyProcessState>(review.crm?.processState ?? "DISCOVERED");
  const [text,setText]=useState("");
  const [pending,setPending]=useState(false);
  const [error,setError]=useState<string|null>(null);
  const requestId=useRef<string|null>(null);
  const processStateRequestId=useRef<string|null>(null);
  useEffect(()=>{
    setPriority(review.crm?.priority ?? "NONE");
    setProcessState(review.crm?.processState ?? "DISCOVERED");
  },[review.crm?.priority,review.crm?.processState]);
  if(!review.crm) return null;
  async function save(kind:"priority"|"note"|"process-state") {
    setPending(true);setError(null);
    try {
      if(kind==="priority") onSaved(await setVacancyPriority(review.vacancy.canonicalVacancyId,priority));
      else if(kind==="note") {
        requestId.current ??= crypto.randomUUID();
        onSaved(await addVacancyNote(review.vacancy.canonicalVacancyId,requestId.current,text));
        setText("");requestId.current=null;
      } else {
        processStateRequestId.current ??= crypto.randomUUID();
        onSaved(await setVacancyProcessState(review.vacancy.canonicalVacancyId,processStateRequestId.current,processState));
        processStateRequestId.current=null;
      }
    } catch(failure) {setError(failure instanceof Error ? failure.message : "Unable to save private CRM information.");}
    finally {setPending(false);}
  }
  return <section aria-label="Private vacancy CRM">
    <h2>My opportunity</h2>
    <p>Process state is your current assessment. Interaction history records actions; priority and archive are separate.</p>
    {error && <p role="alert">{error}</p>}
    <form onSubmit={event=>{event.preventDefault();void save("process-state");}}>
      <label>Application process state <select value={processState} disabled={disabled||pending} onChange={event=>{
        const next=event.target.value as VacancyProcessState;
        if(next!==processState) processStateRequestId.current=null;
        setProcessState(next);
      }}>
        {vacancyProcessStates.map(value=><option key={value} value={value}>{value.replaceAll("_"," ")}</option>)}
      </select></label>
      <button type="submit" disabled={disabled||pending||processState===review.crm.processState}>Save process state</button>
    </form>
    <h3>Process history</h3>
    {review.crm.processTransitions.length===0 ? <p>No process-state changes yet.</p> : <ol aria-label="Process-state history">{review.crm.processTransitions.map(transition=><li key={transition.id}>
      <time dateTime={transition.createdAt}>{new Date(transition.createdAt).toLocaleString()}</time>
      <p>{transition.fromState.replaceAll("_"," ")} to {transition.toState.replaceAll("_"," ")}</p>
    </li>)}</ol>}
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
