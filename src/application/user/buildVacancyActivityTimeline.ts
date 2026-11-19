import type { VacancyActivityItem, VacancyActivityKind } from "../../domain/user/VacancyActivityItem.js";
import type { UserVacancyInteractionEvent } from "../../domain/user/UserVacancyInteractionEvent.js";
import type { VacancyCrmState } from "../../domain/user/VacancyCrm.js";
import type { VacancyNextAction } from "../../domain/user/VacancyNextAction.js";
import type { ApplicationDocumentsView } from "../../domain/user/ApplicationDocument.js";
import type { ContactsView, ResolvedContact } from "../../domain/user/Contact.js";
export interface VacancyActivitySources {
  readonly interactions:readonly UserVacancyInteractionEvent[];
  readonly crm?:VacancyCrmState;
  readonly actions?:readonly VacancyNextAction[];
  readonly documents?:ApplicationDocumentsView;
  readonly contacts?:ContactsView;
}
const words=(value:string)=>value.replaceAll("_"," ").toLowerCase();
/** Pure projection: no clock, I/O, random IDs, writes, or lookup per activity row. */
export function buildVacancyActivityTimeline(vacancyId:string,sources:VacancyActivitySources):readonly VacancyActivityItem[] {
  const items:VacancyActivityItem[]=[];
  const people=new Map(sources.contacts?.library.map(c=>[c.id,{id:c.id,displayName:c.displayName,archived:c.archivedAt!==null}]));
  const person=(id:string|undefined,fallback?:ResolvedContact)=>id?people.get(id)??fallback:fallback;
  function add(kind:VacancyActivityKind,model:VacancyActivityItem["source"]["model"],recordId:string,at:Date,title:string,summary:string,details:VacancyActivityItem["details"]=[],contact?:ResolvedContact){
    // No invented timestamps if a malformed legacy record cannot be ordered.
    if(!Number.isFinite(at.getTime()))return;
    items.push({id:kind.toLowerCase()+":"+recordId,vacancyId,kind,occurredAt:new Date(at),title,summary,details:details.map(d=>({...d})),source:{model,recordId},...(contact?{contact:{...contact}}:{})});
  }
  for(const e of sources.interactions.filter(e=>e.canonicalVacancyId===vacancyId))
    add("INTERACTION","InteractionEvent",e.id,e.occurredAt,"Interaction: "+words(e.type),"",Object.entries(e.metadata??{}).map(([label,value])=>({label,value:String(value)})),person(e.contactId,e.contact));
  for(const t of sources.crm?.processTransitions??[]){if(t.canonicalVacancyId===vacancyId)add("PROCESS_TRANSITION","ProcessTransition",t.id,t.createdAt,"Process state changed",words(t.fromState)+" to "+words(t.toState));}
  for(const n of sources.crm?.notes??[]){if(n.canonicalVacancyId===vacancyId)add("NOTE","VacancyNote",n.id,n.createdAt,"Note",n.text);}
  for(const a of sources.actions??[]){
    if(a.canonicalVacancyId!==vacancyId)continue;
    const contact=person(a.contactId,a.contact);
    const creation=a.changes.find(c=>c.kind==="CREATE");
    // Current dueAt may have changed; only the creation record proves the original due time.
    add("ACTION_CREATED","VacancyNextAction",a.id,a.createdAt,"Action created",a.description,creation?[{label:"Original due time",value:creation.dueAt?.toISOString()??"No due date"}]:[],contact);
    let reminderAlreadySet=false;
    for(const c of a.changes){
      if(c.kind==="CREATE")continue;
      const kind:VacancyActivityKind=c.kind==="COMPLETE"?"ACTION_COMPLETED":c.kind==="CANCEL"?"ACTION_CANCELLED":c.kind==="RESCHEDULE"?"ACTION_RESCHEDULED":c.kind==="SET_REMINDER"?"REMINDER_SET":"REMINDER_DISMISSED";
      const title=c.kind==="COMPLETE"?"Action completed":c.kind==="CANCEL"?"Action cancelled":c.kind==="RESCHEDULE"?"Action rescheduled":c.kind==="SET_REMINDER"?(reminderAlreadySet?"Reminder replaced":"Reminder set"):"Reminder dismissed";
      const details=c.kind==="RESCHEDULE"?[{label:"New due time",value:c.dueAt?.toISOString()??"No due date"}]:c.kind==="SET_REMINDER"?[{label:"Reminder time",value:c.remindAt?.toISOString()??"Unavailable"}]:[];
      add(kind,"ActionChange",c.id,c.createdAt,title,a.description,details,contact);
      if(c.kind==="SET_REMINDER")reminderAlreadySet=true;
    }
  }
  const versions=new Map(sources.documents?.library.flatMap(d=>d.versions.map(v=>[v.id,{name:d.name,kind:d.kind,number:v.versionNumber}] as const)));
  for(const a of sources.documents?.associations??[]){
    if(a.canonicalVacancyId!==vacancyId)continue;
    const v=versions.get(a.documentVersionId);
    add("DOCUMENT_SELECTED","DocumentAssociation",a.id,a.createdAt,v?(v.kind==="CV"?"CV selected":"Motivation letter selected"):"Document selected",v?v.name+" - v"+v.number:"Version details unavailable",[{label:"Usage",value:"Selected for this vacancy; not proof of sending"}]);
  }
  for(const r of sources.contacts?.relationships??[]){
    if(r.canonicalVacancyId!==vacancyId)continue;
    const contact=person(r.contactId);
    add("CONTACT_LINKED","VacancyContact",r.id,new Date(r.createdAt),"Contact linked",words(r.role),[],contact);
    if(r.endedAt)add("CONTACT_RELATIONSHIP_ENDED","VacancyContact",r.id,new Date(r.endedAt),"Contact relationship ended",words(r.role),[],contact);
  }
  // Code-point ID ordering is independent of locale and input enumeration order.
  return items.sort((a,b)=>b.occurredAt.getTime()-a.occurredAt.getTime()||(a.id<b.id?-1:a.id>b.id?1:0));
}
