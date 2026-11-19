import type { ReviewView } from "./api";
/** New activity uses active vacancy links; existing resolved references are displayed separately. */
export function ActivityContactPicker({review,value,onChange,disabled,label}:{review:ReviewView;value:string;onChange:(value:string)=>void;disabled:boolean;label:string}){
  const data=review.contacts;
  const choices=data?.library.filter(c=>!c.archivedAt && data.relationships.some(r=>r.contactId===c.id&&!r.endedAt))??[];
  return <label>{label}<select value={value} disabled={disabled} onChange={e=>onChange(e.target.value)}><option value="">No contact</option>{choices.map(c=><option key={c.id} value={c.id}>{c.displayName} ({c.id})</option>)}</select></label>;
}
