import { useEffect,useState } from "react";
import { getDailyWorkQueue,type DailyWorkQueue } from "./api";
const label=(s:string)=>s.toLowerCase().replaceAll("_"," ");
export function TodayPage(){
 const [queue,setQueue]=useState<DailyWorkQueue|null>(null),[error,setError]=useState("");
 const load=()=>{setError("");getDailyWorkQueue(Intl.DateTimeFormat().resolvedOptions().timeZone).then(setQueue).catch(()=>setError("Could not load the work queue."));};
 useEffect(load,[]);
 return <main className="page"><nav><a href="/">Inbox</a> <a href="/documents">Documents</a> <a href="/contacts">Contacts</a></nav><h1>Today</h1>
 <p>Due work and opportunities needing a next action. Make changes in Review.</p><button onClick={load}>Refresh</button>
 {error&&<p role="alert">{error}</p>}{!queue&&!error&&<p>Loading work queue…</p>}
 {queue&&<><p>Calendar timezone: {queue.timeZone}. Upcoming: {queue.upcomingDays} days. Awaiting-response review threshold: {queue.staleDays} calendar days.</p>
 <section aria-label="Work queue summary"><h2>Summary</h2><ul>{Object.entries(queue.counts).map(([kind,count])=><li key={kind}>{label(kind)}: {count}</li>)}</ul></section>
 {queue.items.length===0?<p>Nothing currently requires attention.</p>:<ol>{queue.items.map(i=><li key={i.id}><h2><a href={i.reviewUrl}>{i.title??"Untitled opportunity"}</a></h2>
 <p>{label(i.category)} · Priority: {label(i.priority)} · Process: {label(i.processState)}</p>
 {i.company&&<p>Company: {i.company}</p>}{i.action&&<p>{i.action.description}</p>}{i.action?.contact&&<p>Contact: {i.action.contact.displayName}{i.action.contact.archived?" (archived)":""}</p>}
 {i.dueAt&&<p>Due: <time dateTime={i.dueAt}>{new Date(i.dueAt).toLocaleString(undefined,{timeZone:queue.timeZone})}</time></p>}
 {i.remindAt&&<p>Reminder: <time dateTime={i.remindAt}>{new Date(i.remindAt).toLocaleString(undefined,{timeZone:queue.timeZone})}</time></p>}
 {i.category==="AWAITING_RESPONSE_STALE"&&<p>Last activity: <time dateTime={i.lastActivityAt}>{new Date(i.lastActivityAt).toLocaleString()}</time></p>}
 <a href={i.reviewUrl}>Open Review</a></li>)}</ol>}</>}
 </main>;
}
