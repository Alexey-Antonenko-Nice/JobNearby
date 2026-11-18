import { useState } from "react";
import { contactMethodTypes, type Contact, type ContactCommand, type ContactMethod } from "../../src/domain/user/Contact";
export type ContactInput = ContactCommand extends infer C ? C extends ContactCommand ? Omit<C,"requestId"> : never : never;
export function ContactForm({contact,save,disabled}:{contact?:Contact;save:(input:ContactInput)=>Promise<void>;disabled:boolean}) {
  const [name,setName]=useState(contact?.displayName??""),[title,setTitle]=useState(contact?.jobTitle??""),[notes,setNotes]=useState(contact?.notes??"");
  return <form onSubmit={e=>{e.preventDefault();void save(contact?{operation:"UPDATE",contactId:contact.id,displayName:name,jobTitle:title,notes}:{operation:"CREATE",displayName:name,jobTitle:title,notes});}}>
    <label>Contact name<input required maxLength={500} value={name} onChange={e=>setName(e.target.value)}/></label>
    <label>Job title<input maxLength={500} value={title} onChange={e=>setTitle(e.target.value)}/></label>
    <label>Contact notes<textarea maxLength={10000} value={notes} onChange={e=>setNotes(e.target.value)}/></label>
    <button disabled={disabled}>{contact?"Save contact":"Create contact"}</button>
  </form>;
}
export function ContactMethodForm({contactId,method,save,disabled}:{contactId:string;method?:ContactMethod;save:(input:ContactInput)=>Promise<void>;disabled:boolean}) {
  const [type,setType]=useState(method?.type??"EMAIL"),[value,setValue]=useState(method?.value??""),[label,setLabel]=useState(method?.label??"");
  return <form aria-label={method?"Edit contact method":"Add contact method"} onSubmit={e=>{e.preventDefault();void save(method?{operation:"UPDATE_METHOD",contactId,methodId:method.id,type,value,label}:{operation:"ADD_METHOD",contactId,type,value,label});}}>
    <label>Method type<select value={type} onChange={e=>setType(e.target.value as typeof type)}>{contactMethodTypes.map(t=><option key={t}>{t}</option>)}</select></label>
    <label>Contact value<input required maxLength={500} value={value} onChange={e=>setValue(e.target.value)}/></label>
    <label>Method label<input maxLength={500} value={label} onChange={e=>setLabel(e.target.value)}/></label>
    <button disabled={disabled}>{method?"Save method":"Add method"}</button>
  </form>;
}
