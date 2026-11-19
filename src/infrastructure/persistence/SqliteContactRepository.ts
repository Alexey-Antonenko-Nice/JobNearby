import { readNextActions } from "./sqliteVacancyNextActions.js";
import type { ContactActivity } from "../../domain/user/Contact.js";
import type Database from "better-sqlite3";
import { createHash, randomUUID } from "node:crypto";
import { ContactError, type Contact, type ContactCommand, type ContactRepository, type ContactMethod, type VacancyContact } from "../../domain/user/Contact.js";
export class SqliteContactRepository implements ContactRepository {
  constructor(private readonly db:Database.Database){}
  list():Contact[] {
    const contacts=this.db.prepare("SELECT id,display_name displayName,job_title jobTitle,notes,created_at createdAt,archived_at archivedAt FROM contacts ORDER BY rowid").all() as Omit<Contact,"methods"|"relationships">[];
    const methods=this.db.prepare("SELECT id,contact_id contactId,type,value,label,created_at createdAt FROM contact_methods ORDER BY rowid").all() as (ContactMethod & {contactId:string})[];
    const links=this.db.prepare("SELECT id,canonical_vacancy_id canonicalVacancyId,contact_id contactId,role,created_at createdAt,ended_at endedAt FROM vacancy_contacts ORDER BY rowid").all() as VacancyContact[];
    const events=this.db.prepare("SELECT r.contact_id contactId,e.id,e.canonical_vacancy_id canonicalVacancyId,e.event_type description,e.occurred_at at FROM interaction_contact_references r JOIN user_vacancy_interaction_events e ON e.id=r.event_id ORDER BY e.occurred_at DESC,e.id").all() as (Omit<ContactActivity,"kind"|"status"> & {contactId:string})[];
    const vacancyIds=this.db.prepare("SELECT DISTINCT canonical_vacancy_id id FROM action_contact_references").all() as {id:string}[];
    const actions=vacancyIds.flatMap(v=>readNextActions(this.db,v.id)).filter(a=>a.contactId);
    return contacts.map(c=>({...c,activities:[
      ...events.filter(e=>e.contactId===c.id).map(e=>({kind:"INTERACTION" as const,id:e.id,canonicalVacancyId:e.canonicalVacancyId,description:e.description,at:e.at,status:"Recorded"})),
      ...actions.filter(a=>a.contactId===c.id).map(a=>({kind:"ACTION" as const,id:a.id,canonicalVacancyId:a.canonicalVacancyId,description:a.description,at:a.createdAt.toISOString(),status:a.completedAt?"COMPLETED":a.cancelledAt?"CANCELLED":"ACTIVE"}))
    ].sort((a,b)=>b.at.localeCompare(a.at)||a.id.localeCompare(b.id)),methods:methods.filter(m=>m.contactId===c.id),relationships:links.filter(r=>r.contactId===c.id)}));
  }
  execute(c:ContactCommand,at:string):string {
    const fingerprint=createHash("sha256").update(JSON.stringify(Object.entries(c).sort(([a],[b])=>a.localeCompare(b)))).digest("hex");
    return this.db.transaction(()=>{
      const old=this.db.prepare("SELECT fingerprint,result_id FROM contact_requests WHERE request_id=?").get(c.requestId) as {fingerprint:string;result_id:string}|undefined;
      if(old){if(old.fingerprint!==fingerprint)throw new ContactError("Request ID already used for a different contact command.",409);return old.result_id;}
      let result="contactId" in c?c.contactId:randomUUID();
      const contact="contactId" in c?this.db.prepare("SELECT archived_at FROM contacts WHERE id=?").get(c.contactId) as {archived_at:string|null}|undefined:undefined;
      if("contactId" in c && !contact)throw new ContactError("Contact not found.",404);
      switch(c.operation){
        case "CREATE":this.db.prepare("INSERT INTO contacts VALUES(?,?,?,?,?,NULL)").run(result,c.displayName,c.jobTitle,c.notes,at);break;
        case "UPDATE":this.db.prepare("UPDATE contacts SET display_name=?,job_title=?,notes=? WHERE id=?").run(c.displayName,c.jobTitle,c.notes,c.contactId);break;
        case "ARCHIVE":this.db.prepare("UPDATE contacts SET archived_at=COALESCE(archived_at,?) WHERE id=?").run(at,c.contactId);break;
        case "RESTORE":this.db.prepare("UPDATE contacts SET archived_at=NULL WHERE id=?").run(c.contactId);break;
        case "ADD_METHOD":result=randomUUID();this.db.prepare("INSERT INTO contact_methods VALUES(?,?,?,?,?,?)").run(result,c.contactId,c.type,c.value,c.label,at);break;
        case "UPDATE_METHOD":if(this.db.prepare("UPDATE contact_methods SET type=?,value=?,label=? WHERE id=? AND contact_id=?").run(c.type,c.value,c.label,c.methodId,c.contactId).changes!==1)throw new ContactError("Contact method not found.",404);result=c.methodId;break;
        case "LINK":{
          if(contact!.archived_at)throw new ContactError("Restore contact before creating a new relationship.",409);
          if(!this.db.prepare("SELECT 1 FROM canonical_vacancies WHERE id=?").get(c.canonicalVacancyId))throw new ContactError("Vacancy not found.",404);
          if(this.db.prepare("SELECT 1 FROM vacancy_contacts WHERE canonical_vacancy_id=? AND contact_id=? AND role=? AND ended_at IS NULL").get(c.canonicalVacancyId,c.contactId,c.role))throw new ContactError("This active relationship already exists.",409);
          result=randomUUID();this.db.prepare("INSERT INTO vacancy_contacts VALUES(?,?,?,?,?,NULL)").run(result,c.canonicalVacancyId,c.contactId,c.role,at);break;
        }
        case "END_LINK":{
          const link=this.db.prepare("SELECT ended_at FROM vacancy_contacts WHERE id=? AND contact_id=?").get(c.relationshipId,c.contactId) as {ended_at:string|null}|undefined;
          if(!link)throw new ContactError("Contact relationship not found.",404);
          if(link.ended_at===null)this.db.prepare("UPDATE vacancy_contacts SET ended_at=? WHERE id=?").run(at,c.relationshipId);
          result=c.relationshipId;break;
        }
      }
      this.db.prepare("INSERT INTO contact_requests VALUES(?,?,?)").run(c.requestId,fingerprint,result);return result;
    }).immediate();
  }
}
