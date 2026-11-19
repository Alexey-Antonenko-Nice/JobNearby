import type Database from "better-sqlite3";
import { ContactError, validateContactId, type ResolvedContact } from "../../domain/user/Contact.js";
/** Called inside the activity write transaction, after checking for an identical retry. */
export function requireSelectableContact(db:Database.Database,vacancyId:string,contactId:string):void {
  validateContactId(contactId);
  const contact=db.prepare("SELECT archived_at FROM contacts WHERE id=?").get(contactId) as {archived_at:string|null}|undefined;
  if(!contact)throw new ContactError("Contact does not exist.",404);
  if(contact.archived_at)throw new ContactError("Archived contacts cannot be selected for new activity.",409);
  if(!db.prepare("SELECT 1 FROM vacancy_contacts WHERE canonical_vacancy_id=? AND contact_id=? AND ended_at IS NULL").get(vacancyId,contactId))
    throw new ContactError("Choose a contact with an active relationship to this vacancy.",409);
}
/** Current names, including archived identities; no display-name snapshots or method values. */
export function resolveContact(db:Database.Database,id:string):ResolvedContact {
  const row=db.prepare("SELECT display_name,archived_at FROM contacts WHERE id=?").get(id) as {display_name:string;archived_at:string|null}|undefined;
  if(!row)throw new ContactError("Stored contact reference is missing.",409);
  return {id,displayName:row.display_name,archived:row.archived_at!==null};
}
