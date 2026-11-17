import type Database from "better-sqlite3";
import { VacancyCrmError, validateNote, validatePriority, type VacancyCrmRepository, type VacancyCrmState, type VacancyNote, type VacancyPriority } from "../../domain/user/VacancyCrm.js";
export class SqliteVacancyCrmRepository implements VacancyCrmRepository {
  constructor(private readonly db: Database.Database) {}
  private requireVacancy(id: string): void {
    if (!this.db.prepare("SELECT 1 FROM canonical_vacancies WHERE id=?").get(id)) throw new VacancyCrmError("Vacancy no longer exists.", 404);
  }
  async get(id: string): Promise<VacancyCrmState> {
    this.requireVacancy(id);
    const row = this.db.prepare("SELECT priority FROM vacancy_crm_priority WHERE canonical_vacancy_id=?").get(id) as {priority: VacancyPriority} | undefined;
    const notes = this.db.prepare("SELECT id,canonical_vacancy_id,text,created_at FROM vacancy_notes WHERE canonical_vacancy_id=? ORDER BY created_at,rowid").all(id) as {id:string;canonical_vacancy_id:string;text:string;created_at:string}[];
    return {priority:row?.priority ?? "NONE",notes:notes.map(n=>({id:n.id,canonicalVacancyId:n.canonical_vacancy_id,text:n.text,createdAt:new Date(n.created_at)}))};
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
}
