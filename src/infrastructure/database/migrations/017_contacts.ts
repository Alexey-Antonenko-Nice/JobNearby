import type Database from "better-sqlite3";
export const migration017 = {version:17,name:"contacts",up(db:Database.Database):void {
  db.exec(`
    CREATE TABLE contacts (id TEXT PRIMARY KEY,display_name TEXT NOT NULL CHECK(length(trim(display_name))>0),job_title TEXT NOT NULL,notes TEXT NOT NULL,created_at TEXT NOT NULL,archived_at TEXT);
    CREATE TABLE contact_methods (id TEXT PRIMARY KEY,contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE RESTRICT,type TEXT NOT NULL CHECK(type IN ('EMAIL','PHONE','LINKEDIN_URL','OTHER')),value TEXT NOT NULL,label TEXT NOT NULL,created_at TEXT NOT NULL);
    CREATE INDEX contact_methods_contact ON contact_methods(contact_id);
    CREATE TABLE vacancy_contacts (id TEXT PRIMARY KEY,canonical_vacancy_id TEXT NOT NULL REFERENCES canonical_vacancies(id) ON DELETE CASCADE,contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE RESTRICT,role TEXT NOT NULL CHECK(role IN ('RECRUITER','HIRING_MANAGER','HR','INTERVIEWER','REFERRAL','EMPLOYEE_CONTACT','AGENCY_CONSULTANT','OTHER')),created_at TEXT NOT NULL,ended_at TEXT);
    CREATE INDEX vacancy_contacts_vacancy ON vacancy_contacts(canonical_vacancy_id);
    CREATE INDEX vacancy_contacts_person ON vacancy_contacts(contact_id);
    CREATE UNIQUE INDEX vacancy_contacts_active ON vacancy_contacts(canonical_vacancy_id,contact_id,role) WHERE ended_at IS NULL;
    CREATE TABLE contact_requests (request_id TEXT PRIMARY KEY,fingerprint TEXT NOT NULL,result_id TEXT NOT NULL);
    CREATE TRIGGER vacancy_contacts_history BEFORE UPDATE ON vacancy_contacts WHEN NEW.id<>OLD.id OR NEW.canonical_vacancy_id<>OLD.canonical_vacancy_id OR NEW.contact_id<>OLD.contact_id OR NEW.role<>OLD.role OR NEW.created_at<>OLD.created_at OR OLD.ended_at IS NOT NULL OR NEW.ended_at IS NULL BEGIN SELECT RAISE(ABORT,'Contact relationship history is immutable.'); END;
    CREATE TRIGGER vacancy_contacts_delete BEFORE DELETE ON vacancy_contacts WHEN NOT EXISTS(SELECT 1 FROM vacancy_cleanup_guard WHERE canonical_vacancy_id=OLD.canonical_vacancy_id) BEGIN SELECT RAISE(ABORT,'Use guarded vacancy cleanup.'); END;
    CREATE TRIGGER contacts_no_delete BEFORE DELETE ON contacts BEGIN SELECT RAISE(ABORT,'Archive contacts instead.'); END;
    CREATE TRIGGER contact_methods_no_delete BEFORE DELETE ON contact_methods BEGIN SELECT RAISE(ABORT,'Contact methods are retained.'); END;
  `);
}} as const;
