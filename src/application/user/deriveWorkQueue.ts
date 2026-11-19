import { deriveNextActions, type VacancyNextAction } from "../../domain/user/VacancyNextAction.js";
import type { VacancyPriority, VacancyProcessState } from "../../domain/user/VacancyCrm.js";
export const queueCategories = ["OVERDUE_ACTION","REMINDER_DUE","DUE_TODAY","HIGH_PRIORITY_NO_ACTION","AWAITING_RESPONSE_STALE","UPCOMING_ACTION","ACTIVE_WITHOUT_NEXT_ACTION"] as const;
export type QueueCategory = typeof queueCategories[number];
export interface WorkQueueOpportunity {
  id:string; title:string|null; company:string|null; priority:VacancyPriority; processState:VacancyProcessState;
  archived:boolean; createdAt:Date; lastActivityAt:Date|null; actions:readonly VacancyNextAction[];
}
export interface WorkQueueItem {
  id:string; category:QueueCategory; vacancyId:string; title:string|null; company:string|null;
  priority:VacancyPriority; processState:VacancyProcessState; reviewUrl:string;
  /** Present only for active actions; exact due reminder ID grants dismissal, regardless of category. */
  action?:{id:string;description:string;dismissibleReminderId?:string;contact?:VacancyNextAction["contact"]};
  dueAt:Date|null; remindAt:Date|null; lastActivityAt:Date;
}
export interface DailyWorkQueue { generatedAt:Date; timeZone:string; upcomingDays:number; staleDays:number; items:readonly WorkQueueItem[]; counts:Record<QueueCategory,number> }
export const workQueueDefaults={upcomingDays:7,staleDays:7} as const;
export function activeQueueProcess(state:VacancyProcessState):boolean {
  return !(["REJECTED","WITHDRAWN","NO_LONGER_RELEVANT"] as readonly string[]).includes(state);
}
/** Calendar-day ordinal in the selected IANA timezone, independent of DST day length. */
export function calendarDay(at:Date,timeZone:string):number {
  const parts=new Intl.DateTimeFormat("en-US",{timeZone,year:"numeric",month:"numeric",day:"numeric"}).formatToParts(at);
  const part=(type:string)=>Number(parts.find(p=>p.type===type)!.value);
  return Date.UTC(part("year"),part("month")-1,part("day"))/86400000;
}
export function deriveWorkQueue(opportunities:readonly WorkQueueOpportunity[],options:{now:Date;timeZone:string;upcomingDays?:number;staleDays?:number}):DailyWorkQueue {
  const {now,timeZone}=options, upcomingDays=options.upcomingDays??workQueueDefaults.upcomingDays,staleDays=options.staleDays??workQueueDefaults.staleDays;
  if(!Number.isFinite(now.getTime())||![upcomingDays,staleDays].every(n=>Number.isInteger(n)&&n>=1&&n<=365))throw new Error("Invalid work queue time options.");
  const today=calendarDay(now,timeZone),items:WorkQueueItem[]=[];
  for(const v of opportunities){
    if(v.archived)continue;
    const active=deriveNextActions(v.actions,now).actions.filter(a=>a.status==="ACTIVE");
    const lastActivityAt=v.lastActivityAt??v.createdAt;
    const add=(category:QueueCategory,action?:typeof active[number])=>{
      const reminder=action?.reminders.find(r=>!r.dismissedAt&&!r.supersededAt);
      items.push({id:category.toLowerCase().replaceAll("_","-")+":"+(action?.id??v.id),category,vacancyId:v.id,title:v.title,company:v.company,priority:v.priority,processState:v.processState,reviewUrl:"/review/"+encodeURIComponent(v.id),lastActivityAt,dueAt:action?.dueAt??null,remindAt:reminder?.remindAt??null,...(action?{action:{id:action.id,description:action.description,...(reminder&&action.reminderDue?{dismissibleReminderId:reminder.id}:{}),...(action.contact?{contact:action.contact}:{})}}:{})});
    };
    for(const a of active){
      if(a.dueState==="OVERDUE")add("OVERDUE_ACTION",a);
      else if(a.reminderDue)add("REMINDER_DUE",a);
      else if(a.dueAt&&calendarDay(a.dueAt,timeZone)===today)add("DUE_TODAY",a);
      else if(a.dueAt&&a.dueAt>now&&calendarDay(a.dueAt,timeZone)<=today+upcomingDays)add("UPCOMING_ACTION",a);
    }
    if(active.length===0&&activeQueueProcess(v.processState)){
      if(v.priority==="HIGH")add("HIGH_PRIORITY_NO_ACTION");
      else if(v.processState==="AWAITING_RESPONSE"&&today-calendarDay(lastActivityAt,timeZone)>=staleDays)add("AWAITING_RESPONSE_STALE");
      else add("ACTIVE_WITHOUT_NEXT_ACTION");
    }
  }
  const priority={HIGH:0,NORMAL:1,LOW:2,NONE:3};
  const sortTime=(i:WorkQueueItem)=>i.category==="REMINDER_DUE"?i.remindAt!.getTime():i.action?i.dueAt?.getTime()??0:i.category==="AWAITING_RESPONSE_STALE"?i.lastActivityAt.getTime():0;
  items.sort((a,b)=>queueCategories.indexOf(a.category)-queueCategories.indexOf(b.category)||sortTime(a)-sortTime(b)||priority[a.priority]-priority[b.priority]||(a.id<b.id?-1:a.id>b.id?1:0));
  const counts=Object.fromEntries(queueCategories.map(c=>[c,items.filter(i=>i.category===c).length])) as DailyWorkQueue["counts"];
  return {generatedAt:new Date(now),timeZone,upcomingDays,staleDays,items,counts};
}
