import { ActivityContactPicker } from "./ActivityContactPicker";
import { useRef, useState } from "react";
import {
  createVacancyNextAction, completeVacancyNextAction, cancelVacancyNextAction,
  rescheduleVacancyNextAction, setVacancyActionReminder, dismissVacancyActionReminder,
  getReview, type ReviewView
} from "./api";

type Action = NonNullable<ReviewView["nextActions"]>["actions"][number];
const showTime = (value:string) => new Date(value).toLocaleString();
export function localActionTime(value:string): string|null {
  if(!value) return null;
  const parsed=new Date(value);
  const parts=/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/u.exec(value);
  if(!parts || !Number.isFinite(parsed.getTime()) ||
    parsed.getFullYear()!==Number(parts[1]) || parsed.getMonth()+1!==Number(parts[2]) ||
    parsed.getDate()!==Number(parts[3]) || parsed.getHours()!==Number(parts[4]) || parsed.getMinutes()!==Number(parts[5]))
    throw Error("Choose a valid local date and time.");
  return parsed.toISOString();
}
export function VacancyNextActionsSection({review,onSaved,disabled}:{
  readonly review:ReviewView;readonly onSaved:(view:ReviewView)=>void;readonly disabled:boolean;
}) {
  const [contactId,setContactId]=useState("");
  const [description,setDescription]=useState("");
  const [due,setDue]=useState("");
  const [pending,setPending]=useState(false);
  const [error,setError]=useState<string|null>(null);
  const requests=useRef(new Map<string,string>());
  if(!review.nextActions) return null;
  const id=review.vacancy.canonicalVacancyId;
  async function run(key:string,command:(requestId:string)=>Promise<ReviewView>):Promise<boolean> {
    setPending(true);setError(null);
    const requestId=requests.current.get(key) ?? crypto.randomUUID();
    requests.current.set(key,requestId);
    try {onSaved(await command(requestId));requests.current.delete(key);return true;}
    catch(failure) {setError(failure instanceof Error?failure.message:"Unable to save next action.");return false;}
    finally {setPending(false);}
  }
  async function create() {
    try {
      const dueAt=localActionTime(due);
      if(await run(JSON.stringify(["create",description,dueAt,contactId]),requestId=>createVacancyNextAction(id,requestId,description,dueAt,contactId||undefined))) {
        setDescription("");setDue("");setContactId("");
      }
    } catch(failure) {setError((failure as Error).message);}
  }
  const active=review.nextActions.actions.filter(action=>action.status==="ACTIVE");
  const history=review.nextActions.actions.filter(action=>action.status!=="ACTIVE");
  const busy=disabled||pending;
  return <section aria-label="Next actions and reminders">
    <h2>Next actions</h2>
    <p>Private intentions, separate from process state and recorded interactions.</p>
    <p>Times use {Intl.DateTimeFormat().resolvedOptions().timeZone}. Reminders are checked on opening or refreshing Review.
      No desktop notifications are sent.</p>
    <p>Checked: <time dateTime={review.nextActions.evaluatedAt}>{showTime(review.nextActions.evaluatedAt)}</time></p>
    <button disabled={busy} onClick={()=>void run("refresh",()=>getReview(id))}>Refresh action status</button>
    {error && <p role="alert">{error}</p>}
    <form onSubmit={event=>{event.preventDefault();void create();}}>
      <label>Next action description <textarea maxLength={2000} value={description} disabled={busy} onChange={event=>setDescription(event.target.value)}/></label>
      <label>Due date and time (optional) <input type="datetime-local" value={due} disabled={busy} onChange={event=>setDue(event.target.value)}/></label>
      <ActivityContactPicker review={review} value={contactId} onChange={setContactId} disabled={busy} label="Action contact (optional)"/>
      <button disabled={busy||!description.trim()}>Create action</button>
    </form>
    <h3>Active actions</h3>
    {active.length===0 && <p>No active actions.</p>}
    {active.map(action=><ActionCard key={action.id} action={action} disabled={busy} run={run} vacancyId={id}/>)}
    <h3>Completed and cancelled actions</h3>
    {history.length===0 && <p>No completed or cancelled actions.</p>}
    {history.map(action=><ActionCard key={action.id} action={action} disabled={busy} run={run} vacancyId={id}/>)}
  </section>;
}
function ActionCard({action,disabled,run,vacancyId}:{action:Action;disabled:boolean;vacancyId:string;
  run:(key:string,command:(id:string)=>Promise<ReviewView>)=>Promise<boolean>}) {
  const [due,setDue]=useState("");
  const [remind,setRemind]=useState("");
  const [error,setError]=useState<string|null>(null);
  const active=action.status==="ACTIVE";
  const reminder=action.reminders.find(reminder=>!reminder.supersededAt);
  async function schedule(kind:"due"|"reminder") {
    setError(null);
    try {
      const instant=localActionTime(kind==="due"?due:remind);
      if(kind==="reminder" && instant===null) throw Error("Choose a reminder time.");
      const ok=await run(JSON.stringify([action.id,kind,instant]),requestId=>kind==="due"
        ? rescheduleVacancyNextAction(vacancyId,action.id,requestId,instant)
        : setVacancyActionReminder(vacancyId,action.id,requestId,instant!));
      if(ok) {setDue("");setRemind("");}
    } catch(failure) {setError((failure as Error).message);}
  }
  return <article aria-label={action.description}>
    <h4 style={{whiteSpace:"pre-wrap",overflowWrap:"anywhere"}}>{action.description}</h4>
    {action.contact && <p>Contact: {action.contact.displayName}{action.contact.archived?" (Archived contact)":""}</p>}
    <p>{action.status==="ACTIVE"?"Active":action.status==="COMPLETED"?"Completed":"Cancelled"}
      {action.dueState==="OVERDUE" && " — Overdue"}{action.dueState==="DUE" && " — Due now"}
      {action.dueState==="UPCOMING" && " — Upcoming"}</p>
    <p>{action.dueAt ? "Due: "+showTime(action.dueAt) : "No due date"}</p>
    {reminder && <p>{reminder.dismissedAt?"Reminder dismissed":!active?"Reminder inactive":action.reminderDue?"Reminder due":"Reminder scheduled"}: {showTime(reminder.remindAt)}</p>}
    {error && <p role="alert">{error}</p>}
    {active && <>
      <button disabled={disabled} onClick={()=>void run(action.id+":complete",requestId=>completeVacancyNextAction(vacancyId,action.id,requestId))}>Complete action</button>
      <button disabled={disabled} onClick={()=>void run(action.id+":cancel",requestId=>cancelVacancyNextAction(vacancyId,action.id,requestId))}>Cancel action</button>
      <details><summary>Due date and reminder</summary>
        <form onSubmit={event=>{event.preventDefault();void schedule("due");}}>
          <label>New due date and time <input type="datetime-local" disabled={disabled} value={due} onChange={event=>setDue(event.target.value)}/></label>
          <p>Leave blank to remove the due date.</p>
          <button disabled={disabled}>Reschedule action</button>
        </form>
        <form onSubmit={event=>{event.preventDefault();void schedule("reminder");}}>
          <label>Reminder date and time <input type="datetime-local" disabled={disabled} value={remind} onChange={event=>setRemind(event.target.value)}/></label>
          <button disabled={disabled||!remind}>Set reminder</button>
        </form>
        {reminder && !reminder.dismissedAt && <button disabled={disabled}
          onClick={()=>void run(action.id+":dismiss:"+reminder.id,requestId=>dismissVacancyActionReminder(vacancyId,action.id,requestId,reminder.id))}>Dismiss reminder</button>}
      </details>
    </>}
    <details><summary>Action history</summary><ol>{action.changes.map(change=><li key={change.id}>
      {change.kind.replaceAll("_"," ").toLowerCase()} — <time dateTime={change.createdAt}>{showTime(change.createdAt)}</time>
      {(change.kind==="CREATE"||change.kind==="RESCHEDULE") && (change.dueAt?" — due "+showTime(change.dueAt):" — no due date")}
      {change.remindAt && " — remind "+showTime(change.remindAt)}
    </li>)}</ol></details>
  </article>;
}
