import { requireSelectableContact } from "./sqliteContactReferences.js";
import type Database from "better-sqlite3";
import { VacancyCrmError } from "../../domain/user/VacancyCrm.js";
import { validateActionRequest, type ActionRequest, type ActionChange, type VacancyNextAction, type VacancyActionReminder } from "../../domain/user/VacancyNextAction.js";

interface ActionRow { id:string; canonical_vacancy_id:string; description:string; due_at:string|null; created_at:string }
interface ChangeRow {
  id:string; canonical_vacancy_id:string; action_id:string; kind:Exclude<ActionRequest["kind"],"CREATE">;
  due_at:string|null; remind_at:string|null; reminder_id:string|null; created_at:string;
}
const date = (value:string|null) => value === null ? null : new Date(value);
function requireVacancy(db:Database.Database,id:string) {
  if(!db.prepare("SELECT 1 FROM canonical_vacancies WHERE id=?").get(id)) throw new VacancyCrmError("Vacancy no longer exists.",404);
}
export function readNextActions(db:Database.Database,id?:string): readonly VacancyNextAction[] {
  if(id!==undefined)requireVacancy(db,id);
  const actions=db.prepare("SELECT * FROM vacancy_next_actions"+(id===undefined?"":" WHERE canonical_vacancy_id=?")+" ORDER BY created_at,rowid").all(...(id===undefined?[]:[id])) as ActionRow[];
  const rows=db.prepare("SELECT * FROM vacancy_action_changes"+(id===undefined?"":" WHERE canonical_vacancy_id=?")+" ORDER BY rowid").all(...(id===undefined?[]:[id])) as ChangeRow[];
  const references=new Map((db.prepare("SELECT r.action_id,c.id,c.display_name,c.archived_at FROM action_contact_references r JOIN contacts c ON c.id=r.contact_id"+(id===undefined?"":" WHERE r.canonical_vacancy_id=?")).all(...(id===undefined?[]:[id])) as {action_id:string;id:string;display_name:string;archived_at:string|null}[]).map(r=>[r.action_id,r]));
  const changesByAction=new Map<string,ChangeRow[]>();
  for(const row of rows){const group=changesByAction.get(row.action_id)??[];group.push(row);changesByAction.set(row.action_id,group);}
  return actions.map(action => {
    let dueAt=date(action.due_at), completedAt:Date|null=null, cancelledAt:Date|null=null;
    let reminders:VacancyActionReminder[]=[];
    const changes:ActionChange[]=[{id:action.id,kind:"CREATE",createdAt:new Date(action.created_at),dueAt:date(action.due_at),remindAt:null,reminderId:null}];
    for(const row of changesByAction.get(action.id)??[]) {
      const createdAt=new Date(row.created_at);
      changes.push({id:row.id,kind:row.kind,createdAt,dueAt:date(row.due_at),remindAt:date(row.remind_at),reminderId:row.reminder_id});
      if(row.kind==="RESCHEDULE") dueAt=date(row.due_at);
      if(row.kind==="COMPLETE") completedAt=createdAt;
      if(row.kind==="CANCEL") cancelledAt=createdAt;
      if(row.kind==="SET_REMINDER") {
        reminders=reminders.map(r=>r.supersededAt ? r : {...r,supersededAt:createdAt});
        reminders.push({id:row.id,actionId:action.id,remindAt:new Date(row.remind_at!),createdAt,dismissedAt:null,supersededAt:null});
      }
      if(row.kind==="DISMISS_REMINDER") reminders=reminders.map(r=>r.id===row.reminder_id ? {...r,dismissedAt:createdAt} : r);
    }
    const reference=references.get(action.id);
    return {...(reference?{contactId:reference.id,contact:{id:reference.id,displayName:reference.display_name,archived:reference.archived_at!==null}}:{}),id:action.id,canonicalVacancyId:action.canonical_vacancy_id,description:action.description,createdAt:new Date(action.created_at),
      dueAt,completedAt,cancelledAt,reminders,changes};
  });
}
/** Every command is checked and appended under the same IMMEDIATE transaction. */
export function changeNextAction(db:Database.Database,input:ActionRequest,at:Date):void {
  validateActionRequest(input);
  if(!Number.isFinite(at.getTime())) throw new VacancyCrmError("Invalid action date.",400);
  db.transaction(()=>{
    requireVacancy(db,input.canonicalVacancyId);
    const priorAction=db.prepare("SELECT * FROM vacancy_next_actions WHERE id=?").get(input.requestId) as ActionRow|undefined;
    const priorChange=db.prepare("SELECT * FROM vacancy_action_changes WHERE id=?").get(input.requestId) as ChangeRow|undefined;
    if(priorAction || priorChange) {
      const same=priorAction ? input.kind==="CREATE" && priorAction.canonical_vacancy_id===input.canonicalVacancyId
        && priorAction.description===input.description && priorAction.due_at===input.dueAt
        && ((db.prepare("SELECT contact_id FROM action_contact_references WHERE action_id=?").get(priorAction.id) as {contact_id:string}|undefined)?.contact_id??null)===(input.contactId??null)
        : priorChange!.canonical_vacancy_id===input.canonicalVacancyId && priorChange!.action_id===input.actionId
        && priorChange!.kind===input.kind
        && priorChange!.due_at===("dueAt" in input ? input.dueAt : null)
        && priorChange!.remind_at===("remindAt" in input ? input.remindAt : null)
        && priorChange!.reminder_id===("reminderId" in input ? input.reminderId : null);
      if(!same) throw new VacancyCrmError("Action request ID was already used for different content.",409);
      return;
    }
    if(input.kind==="CREATE") {
      if(input.contactId!==undefined)requireSelectableContact(db,input.canonicalVacancyId,input.contactId);
      db.prepare("INSERT INTO vacancy_next_actions VALUES (?,?,?,?,?)")
        .run(input.actionId,input.canonicalVacancyId,input.description,input.dueAt,at.toISOString());
      if(input.contactId!==undefined)db.prepare("INSERT INTO action_contact_references VALUES(?,?,?)").run(input.actionId,input.canonicalVacancyId,input.contactId);
      return;
    }
    const action=readNextActions(db,input.canonicalVacancyId).find(action=>action.id===input.actionId);
    if(!action) throw new VacancyCrmError("Action does not belong to this vacancy.",404);
    if(action.completedAt || action.cancelledAt) throw new VacancyCrmError("This action is already completed or cancelled.",409);
    if(input.kind==="DISMISS_REMINDER" && !action.reminders.some(r=>r.id===input.reminderId && !r.dismissedAt && !r.supersededAt))
      throw new VacancyCrmError("This reminder is no longer active.",409);
    db.prepare("INSERT INTO vacancy_action_changes VALUES (?,?,?,?,?,?,?,?)").run(
      input.requestId,input.canonicalVacancyId,input.actionId,input.kind,
      "dueAt" in input ? input.dueAt : null,"remindAt" in input ? input.remindAt : null,
      "reminderId" in input ? input.reminderId : null,at.toISOString());
  }).immediate();
}
