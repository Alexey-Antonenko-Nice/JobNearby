/** Private CRM people. Never captured evidence or organization-role decisions. */
export const contactRoles = ["RECRUITER", "HIRING_MANAGER", "HR", "INTERVIEWER", "REFERRAL", "EMPLOYEE_CONTACT", "AGENCY_CONSULTANT", "OTHER"] as const;
export const contactMethodTypes = ["EMAIL", "PHONE", "LINKEDIN_URL", "OTHER"] as const;
export type ContactRole = typeof contactRoles[number];
export type ContactMethodType = typeof contactMethodTypes[number];
export interface ContactMethod { id:string; type:ContactMethodType; value:string; label:string; createdAt:string }
export interface VacancyContact { id:string; canonicalVacancyId:string; contactId:string; role:ContactRole; createdAt:string; endedAt:string|null }
export interface ContactActivity { kind:"INTERACTION"|"ACTION"; id:string; canonicalVacancyId:string; description:string; at:string; status:string }
export interface Contact { activities?:ContactActivity[]; id:string; displayName:string; jobTitle:string; notes:string; createdAt:string; archivedAt:string|null; methods:ContactMethod[]; relationships:VacancyContact[] }
export type ContactCommand = {requestId:string} & (
  {operation:"CREATE";displayName:string;jobTitle:string;notes:string} |
  {operation:"UPDATE";contactId:string;displayName:string;jobTitle:string;notes:string} |
  {operation:"ARCHIVE"|"RESTORE";contactId:string} |
  {operation:"ADD_METHOD";contactId:string;type:ContactMethodType;value:string;label:string} |
  {operation:"UPDATE_METHOD";contactId:string;methodId:string;type:ContactMethodType;value:string;label:string} |
  {operation:"LINK";contactId:string;canonicalVacancyId:string;role:ContactRole} |
  {operation:"END_LINK";contactId:string;relationshipId:string}
);
export interface ContactRepository {
  list():Contact[];
  execute(command:ContactCommand,at:string):string;
}
export interface ContactsView { library:Contact[]; relationships:VacancyContact[] }
export class ContactError extends Error { constructor(message:string,readonly status:400|404|409=400){super(message);} }

export interface ResolvedContact { readonly id:string; readonly displayName:string; readonly archived:boolean }
export function validateContactId(value:unknown):asserts value is string {
  if(typeof value!=="string" || !value.trim() || value.length>200 || /[\u0000-\u001f]/u.test(value)) throw new ContactError("Invalid contact ID.");
}
