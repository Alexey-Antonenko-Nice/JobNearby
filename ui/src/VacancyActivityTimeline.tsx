import type { ReviewView } from "./api";
/** Ordering and historical semantics belong to the application projection. */
export function VacancyActivityTimeline({items}:{items:ReviewView["activityTimeline"]}){
  if(!items)return null;
  return <section aria-label="Vacancy activity timeline"><h2>Activity timeline</h2>
    <p>Newest first. A read-only overview of recorded activity; manage records in their sections below.</p>
    {items.length===0?<p>No recorded activity yet.</p>:<ol>{items.map(item=><li key={item.id}>
      <h3>{item.title}</h3><time dateTime={item.occurredAt}>{new Date(item.occurredAt).toLocaleString()}</time>
      {item.contact&&<p>{item.contact.displayName}{item.contact.archived?" (Archived contact)":""}</p>}
      {item.summary&&<p style={{whiteSpace:"pre-wrap",overflowWrap:"anywhere"}}>{item.summary}</p>}
      {item.details.length>0&&<dl>{item.details.map((detail,index)=><div key={index}><dt>{detail.label}</dt><dd>{detail.value}</dd></div>)}</dl>}
    </li>)}</ol>}
  </section>;
}
