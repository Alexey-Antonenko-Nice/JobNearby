import { readNextActions, changeNextAction } from "./sqliteVacancyNextActions.js";
import type Database from "better-sqlite3";
import { VacancyCrmError, validateNote, validatePriority, validateProcessStateChange, type VacancyCrmRepository, type VacancyCrmState, type VacancyNote, type VacancyPriority } from "../../domain/user/VacancyCrm.js";
export class SqliteVacancyCrmRepository implements VacancyCrmRepository {
  constructor(private readonly db: Database.Database) {}
  async getNextActions(id: string) {
    return this.db.transaction(()=>readNextActions(this.db,id)).deferred();
  }
  async changeNextAction(input: Parameters<VacancyCrmRepository["changeNextAction"]>[0], at: Date): Promise<void> {
    changeNextAction(this.db,input,at);
  }
  private requireVacancy(id: string): void {
    if (!this.db.prepare("SELECT 1 FROM canonical_vacancies WHERE id=?").get(id)) throw new VacancyCrmError("Vacancy no longer exists.", 404);
  }
  async get(id: string): Promise<VacancyCrmState> {
    return this.db.transaction(() => {
      this.requireVacancy(id);
      const row = this.db.prepare("SELECT priority FROM vacancy_crm_priority WHERE canonical_vacancy_id=?").get(id) as {priority: VacancyPriority} | undefined;
      const notes = this.db.prepare("SELECT id,canonical_vacancy_id,text,created_at FROM vacancy_notes WHERE canonical_vacancy_id=? ORDER BY created_at,rowid").all(id) as {id:string;canonical_vacancy_id:string;text:string;created_at:string}[];
      const processState = this.db.prepare("SELECT state FROM vacancy_crm_process_state WHERE canonical_vacancy_id=?").get(id) as {state: VacancyCrmState["processState"]} | undefined;
      const transitions = this.db.prepare("SELECT id,canonical_vacancy_id,from_state,to_state,created_at FROM vacancy_process_transitions WHERE canonical_vacancy_id=? ORDER BY created_at,rowid").all(id) as {id:string;canonical_vacancy_id:string;from_state:VacancyCrmState["processState"];to_state:VacancyCrmState["processState"];created_at:string}[];
      return {
        priority:row?.priority ?? "NONE",
        notes:notes.map(n=>({id:n.id,canonicalVacancyId:n.canonical_vacancy_id,text:n.text,createdAt:new Date(n.created_at)})),
        processState:processState?.state ?? "DISCOVERED",
        processTransitions:transitions.map(t=>({id:t.id,canonicalVacancyId:t.canonical_vacancy_id,fromState:t.from_state,toState:t.to_state,createdAt:new Date(t.created_at)})),
      };
    }).deferred();
  }
  async setPriority(id: string, priority: VacancyPriority): Promise<void> {
    validatePriority(priority);
    this.db.transaction(()=>{
      this.requireVacancy(id);
      this.db.prepare("INSERT INTO vacancy_crm_priority VALUES (?,?) ON CONFLICT(canonical_vacancy_id) DO UPDATE SET priority=excluded.priority").run(id,priority);
    }).immediate();
  }
  async addNote(note: VacancyNote): Promise<void> {
    validateNote(note);
    this.db.transaction(()=>{
      this.requireVacancy(note.canonicalVacancyId);
      const existing=this.db.prepare("SELECT canonical_vacancy_id,text FROM vacancy_notes WHERE id=?").get(note.id) as {canonical_vacancy_id:string;text:string}|undefined;
      if(existing) {
        if(existing.canonical_vacancy_id!==note.canonicalVacancyId || existing.text!==note.text) throw new VacancyCrmError("Note request was already used for different content.",409);
        return; // Retrying the same command preserves the original timestamp.
      }
      this.db.prepare("INSERT INTO vacancy_notes VALUES (?,?,?,?)").run(note.id,note.canonicalVacancyId,note.text,note.createdAt.toISOString());
    }).immediate();
  }
  async setProcessState(input: Parameters<VacancyCrmRepository["setProcessState"]>[0]): Promise<void> {
    validateProcessStateChange(input);
    this.db.transaction(()=>{
      this.requireVacancy(input.canonicalVacancyId);
      const existing=this.db.prepare("SELECT canonical_vacancy_id,to_state FROM vacancy_process_transitions WHERE id=?").get(input.requestId) as {canonical_vacancy_id:string;to_state:VacancyCrmState["processState"]}|undefined;
      if(existing) {
        if(existing.canonical_vacancy_id!==input.canonicalVacancyId || existing.to_state!==input.state) {
          throw new VacancyCrmError("Process-state request was already used for a different change.",409);
        }
        return;
      }
      const current=this.db.prepare("SELECT state FROM vacancy_crm_process_state WHERE canonical_vacancy_id=?").get(input.canonicalVacancyId) as {state:VacancyCrmState["processState"]}|undefined;
      const fromState=current?.state ?? "DISCOVERED";
      if(fromState===input.state) return;
      this.db.prepare("INSERT INTO vacancy_process_transitions VALUES (?,?,?,?,?)")
        .run(input.requestId,input.canonicalVacancyId,fromState,input.state,input.createdAt.toISOString());
      this.db.prepare(`INSERT INTO vacancy_crm_process_state VALUES (?,?)
        ON CONFLICT(canonical_vacancy_id) DO UPDATE SET state=excluded.state`)
        .run(input.canonicalVacancyId,input.state);
    }).immediate();
  }
}
