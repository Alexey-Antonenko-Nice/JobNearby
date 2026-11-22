import { useEffect,useRef,useState } from "react";
import { getDailyWorkQueue,completeVacancyNextAction,cancelVacancyNextAction,dismissVacancyActionReminder,type DailyWorkQueue } from "./api";
const label=(s:string)=>s.toLowerCase().replaceAll("_"," ");
type Item=DailyWorkQueue["items"][number];
type Operation="complete"|"cancel"|"dismiss";
export function TodayPage(){
 const [queue,setQueue]=useState<DailyWorkQueue|null>(null),[error,setError]=useState("");
 const [pending,setPending]=useState<ReadonlySet<string>>(new Set());
 const [commandErrors,setCommandErrors]=useState<Record<string,string>>({});
 const [refreshing,setRefreshing]=useState(false);
 const inFlight=useRef(new Set<string>()),requests=useRef(new Map<string,string>()),readSequence=useRef(0);
 const itemKey=(i:Item)=>JSON.stringify([i.vacancyId,i.action?.id]);
 async function refresh(){
   const sequence=++readSequence.current;setRefreshing(true);
   try {const fresh=await getDailyWorkQueue(Intl.DateTimeFormat().resolvedOptions().timeZone);if(sequence===readSequence.current){setQueue(fresh);setError("");}}
   catch {if(sequence===readSequence.current)setError("Could not refresh the work queue. Displayed items may be out of date.");throw Error("refresh");}
   finally {if(sequence===readSequence.current)setRefreshing(false);}
 }
 useEffect(()=>{void refresh().catch(()=>{});return()=>{readSequence.current++;};},[]);
 async function run(item:Item,operation:Operation){
   const action=item.action;if(!action)return;
   const key=itemKey(item);if(inFlight.current.has(key))return;
   if(operation==="dismiss"&&!action.dismissibleReminderId)return;
   const requestKey=JSON.stringify([key,operation,operation==="dismiss"?action.dismissibleReminderId:null]);
   const requestId=requests.current.get(requestKey)??crypto.randomUUID();requests.current.set(requestKey,requestId);
   inFlight.current.add(key);setPending(new Set(inFlight.current));
   setCommandErrors(previous=>({...previous,[key]:""}));
   let succeeded=false;
   try {
     if(operation==="complete")await completeVacancyNextAction(item.vacancyId,action.id,requestId);
     else if(operation==="cancel")await cancelVacancyNextAction(item.vacancyId,action.id,requestId);
     else await dismissVacancyActionReminder(item.vacancyId,action.id,requestId,action.dismissibleReminderId!);
     succeeded=true;
   } catch(failure){
     const status=(failure as {status?:number}|null)?.status;
     setCommandErrors(previous=>({...previous,[key]:action.description+": "+(status===409||status===404?"This action or reminder has changed or is no longer available. Refreshing the queue.":"Could not confirm the change. Refreshing the queue; retry if needed.")}));
   }
   // Even a lost command response may mean the write succeeded. Never patch rows/counts locally.
   try {await refresh();if(succeeded)requests.current.delete(requestKey);}catch{/* Keep retry ID until both command and read succeed. */}
   finally {inFlight.current.delete(key);setPending(new Set(inFlight.current));}
 }
 return <main className="page"><nav><a href="/">Inbox</a> <a href="/documents">Documents</a> <a href="/contacts">Contacts</a> <a href="/backup">Backup &amp; Restore</a></nav><h1>Today</h1>
 <p>Complete or cancel actions and dismiss due reminders here. Open Review for other changes.</p><button disabled={refreshing} onClick={()=>void refresh().catch(()=>{})}>Refresh</button>
 {error&&<p role="alert">{error}</p>}{Object.entries(commandErrors).filter(([,message])=>message).map(([key,message])=><p role="alert" key={key}>{message}</p>)}
 {!queue&&!error&&<p>Loading work queue.</p>}
 {queue&&<><p>Calendar timezone: {queue.timeZone}. Upcoming: {queue.upcomingDays} days. Awaiting-response review threshold: {queue.staleDays} calendar days.</p>
 <section aria-label="Work queue summary"><h2>Summary</h2><ul>{Object.entries(queue.counts).map(([kind,count])=><li key={kind}>{label(kind)}: {count}</li>)}</ul></section>
 {queue.items.length===0?<p>Nothing currently requires attention.</p>:<ol>{queue.items.map(i=><li key={i.id}><h2><a href={i.reviewUrl}>{i.title??"Untitled opportunity"}</a></h2>
 <p>{label(i.category)} - Priority: {label(i.priority)} - Process: {label(i.processState)}</p>
 {i.company&&<p>Company: {i.company}</p>}{i.action&&<p>{i.action.description}</p>}{i.action?.contact&&<p>Contact: {i.action.contact.displayName}{i.action.contact.archived?" (archived)":""}</p>}
 {i.dueAt&&<p>Due: <time dateTime={i.dueAt}>{new Date(i.dueAt).toLocaleString(undefined,{timeZone:queue.timeZone})}</time></p>}
 {i.remindAt&&<p>Reminder: <time dateTime={i.remindAt}>{new Date(i.remindAt).toLocaleString(undefined,{timeZone:queue.timeZone})}</time></p>}
 {i.category==="AWAITING_RESPONSE_STALE"&&<p>Last activity: <time dateTime={i.lastActivityAt}>{new Date(i.lastActivityAt).toLocaleString()}</time></p>}
 {i.action&&<div aria-label={"Commands for "+i.action.description} aria-busy={pending.has(itemKey(i))}>
 <button disabled={pending.has(itemKey(i))} onClick={()=>void run(i,"complete")}>Complete action</button>
 <button disabled={pending.has(itemKey(i))} onClick={()=>void run(i,"cancel")}>Cancel action</button>
 {i.action.dismissibleReminderId&&<button disabled={pending.has(itemKey(i))} onClick={()=>void run(i,"dismiss")}>Dismiss reminder</button>}
 {pending.has(itemKey(i))&&<span role="status">Working...</span>}
 </div>}
 <a href={i.reviewUrl}>Open Review</a></li>)}</ol>}</>}
 </main>;
}
