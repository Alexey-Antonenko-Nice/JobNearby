import type Database from "better-sqlite3";
import { deriveWorkQueue, type WorkQueueOpportunity } from "../../application/user/deriveWorkQueue.js";
import { readNextActions } from "./sqliteVacancyNextActions.js";
/** Fixed-count batch reads in one snapshot; never loads Review, source payloads or file contents. */
export class SqliteDailyWorkQueue {
  constructor(private readonly db:Database.Database){}
  get(options:Parameters<typeof deriveWorkQueue>[1]){
    return this.db.transaction(()=>{
      const rows=this.db.prepare(`SELECT v.id,v.created_at,COALESCE(p.priority,'NONE') priority,COALESCE(s.state,'DISCOVERED') process_state,
        f.value_json FROM canonical_vacancies v
        LEFT JOIN vacancy_cleanup_state c ON c.canonical_vacancy_id=v.id
        LEFT JOIN vacancy_crm_priority p ON p.canonical_vacancy_id=v.id
        LEFT JOIN vacancy_crm_process_state s ON s.canonical_vacancy_id=v.id
        LEFT JOIN canonical_vacancy_fields f ON f.canonical_vacancy_id=v.id AND f.field_name='role' AND f.status='RESOLVED'
        WHERE c.archived_at IS NULL`).all() as {id:string;created_at:string;priority:WorkQueueOpportunity['priority'];process_state:WorkQueueOpportunity['processState'];value_json:string|null}[];
      // Same private historical sources/timestamps as the vacancy activity timeline; no public derived_at/updated_at.
      const activity=this.db.prepare(`SELECT canonical_vacancy_id,MAX(at) at FROM (
        SELECT canonical_vacancy_id,occurred_at at FROM user_vacancy_interaction_events
        UNION ALL SELECT canonical_vacancy_id,created_at FROM vacancy_process_transitions
        UNION ALL SELECT canonical_vacancy_id,created_at FROM vacancy_notes
        UNION ALL SELECT canonical_vacancy_id,created_at FROM vacancy_next_actions
        UNION ALL SELECT canonical_vacancy_id,created_at FROM vacancy_action_changes
        UNION ALL SELECT canonical_vacancy_id,created_at FROM vacancy_application_documents
        UNION ALL SELECT canonical_vacancy_id,created_at FROM vacancy_contacts
        UNION ALL SELECT canonical_vacancy_id,ended_at FROM vacancy_contacts WHERE ended_at IS NOT NULL
      ) GROUP BY canonical_vacancy_id`).all() as {canonical_vacancy_id:string;at:string}[];
      const recent=new Map(activity.map(r=>[r.canonical_vacancy_id,new Date(r.at)]));
      const companies=new Map<string,string>();
      const organizations=this.db.prepare(`SELECT canonical_vacancy_id,raw_name FROM canonical_vacancy_organization_relationships
        WHERE role IN ('EMPLOYER','DISPLAYED_COMPANY') AND raw_name IS NOT NULL
        ORDER BY CASE role WHEN 'EMPLOYER' THEN 0 ELSE 1 END,relationship_order`).all() as {canonical_vacancy_id:string;raw_name:string}[];
      for(const r of organizations)if(!companies.has(r.canonical_vacancy_id))companies.set(r.canonical_vacancy_id,r.raw_name);
      const actions=new Map<string,ReturnType<typeof readNextActions>[number][]>();
      for(const a of readNextActions(this.db)){const group=actions.get(a.canonicalVacancyId)??[];group.push(a);actions.set(a.canonicalVacancyId,group);}
      return deriveWorkQueue(rows.map(r=>({id:r.id,title:r.value_json?(JSON.parse(r.value_json) as {title?:string}).title??null:null,company:companies.get(r.id)??null,priority:r.priority,processState:r.process_state,archived:false,createdAt:new Date(r.created_at),lastActivityAt:recent.get(r.id)??null,actions:actions.get(r.id)??[]})),options);
    }).deferred();
  }
}
