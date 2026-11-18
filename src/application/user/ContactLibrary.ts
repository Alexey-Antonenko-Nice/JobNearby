import { ContactError, contactRoles, contactMethodTypes, type ContactCommand, type ContactRepository, type ContactsView } from "../../domain/user/Contact.js";

/** Explicit, validated private CRM commands. No inference or automatic identity merging. */
export class ContactLibrary {
  constructor(private readonly repository:ContactRepository,private readonly now:()=>Date=()=>new Date()){}
  list(){return this.repository.list();}
  forVacancy(id:string):ContactsView {const library=this.list();return {library,relationships:library.flatMap(c=>c.relationships.filter(r=>r.canonicalVacancyId===id))};}
  execute(input:unknown):string {
    if(!input || typeof input!=="object" || Array.isArray(input)) throw new ContactError("Invalid contact command.");
    const c=input as Record<string,unknown>;
    const fields:Record<string,string[]>={CREATE:["displayName","jobTitle","notes"],UPDATE:["contactId","displayName","jobTitle","notes"],ARCHIVE:["contactId"],RESTORE:["contactId"],ADD_METHOD:["contactId","type","value","label"],UPDATE_METHOD:["contactId","methodId","type","value","label"],LINK:["contactId","canonicalVacancyId","role"],END_LINK:["contactId","relationshipId"]};
    const keys=typeof c.operation==="string" && Object.hasOwn(fields,c.operation)?fields[c.operation]:undefined;
    if(!keys || Object.keys(c).some(k=>!["operation","requestId",...keys].includes(k))) throw new ContactError("Unsupported contact command.");
    for(const key of ["requestId",...keys]) {
      const value=c[key], optional=["jobTitle","notes","label"].includes(key);
      if(typeof value!=="string" || (!optional && !value.trim()) || value.length>(key==="notes"?10000:500) || /[\u0000]/u.test(value)) throw new ContactError("Invalid contact field: "+key+".");
    }
    if(c.role!==undefined && !contactRoles.includes(c.role as never)) throw new ContactError("Invalid contact role.");
    if(c.type!==undefined && !contactMethodTypes.includes(c.type as never)) throw new ContactError("Invalid contact method type.");
    return this.repository.execute(c as ContactCommand,this.now().toISOString());
  }
}
