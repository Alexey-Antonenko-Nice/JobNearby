import type Database from "better-sqlite3";
import { EMPLOYER_IDENTITY_ALGORITHM, EMPLOYER_IDENTITY_STALE, type EmployerIdentityDecisionStore } from "../../domain/user/EmployerIdentityReview.js";
import { insertObservationClusterAssignment } from "./SqliteObservationClusterAssignmentRepository.js";

/** The assignment log is also the append-only identity decision audit; no role decision is written. */
export class SqliteEmployerIdentityDecisionStore implements EmployerIdentityDecisionStore {
  constructor(private readonly db: Database.Database) {}
  async commit(input: Parameters<EmployerIdentityDecisionStore["commit"]>[0]) {
    this.db.transaction(() => {
      const stale = () => { throw Error(EMPLOYER_IDENTITY_STALE); };
      const members = (this.db.prepare("SELECT source_observation_id AS id FROM canonical_vacancy_source_observations WHERE canonical_vacancy_id=? ORDER BY observation_order").all(input.canonicalVacancyId) as {id:string}[]).map(r=>r.id);
      if (JSON.stringify(members) !== JSON.stringify(input.expectedAssignments.map(a=>a.observationId))) stale();
      const historyIds=(this.db.prepare("SELECT a.id FROM observation_cluster_assignments a JOIN canonical_vacancy_source_observations m ON m.source_observation_id=a.source_observation_id WHERE m.canonical_vacancy_id=? AND a.algorithm=? ORDER BY a.id").all(input.canonicalVacancyId,EMPLOYER_IDENTITY_ALGORITHM) as {id:string}[]).map(r=>r.id);
      if (JSON.stringify(historyIds)!==JSON.stringify([...input.expectedIdentityHistoryIds].sort())) stale();
      const head = this.db.prepare("SELECT id FROM vacancy_organization_role_decisions WHERE canonical_vacancy_id=? ORDER BY rowid DESC LIMIT 1").get(input.canonicalVacancyId) as {id:string}|undefined;
      if ((head?.id ?? null) !== input.expectedRoleDecisionId) stale();
      const target = this.db.prepare("SELECT status FROM employer_clusters WHERE id=?").get(input.targetClusterId) as {status:string}|undefined;
      if (!target || !["PROBABLY_RESOLVED","RESOLVED"].includes(target.status)) stale();
      const targetIds = (this.db.prepare("SELECT id FROM observation_cluster_assignments WHERE employer_cluster_id=? AND superseded_at IS NULL AND status IN ('ACCEPTED','USER_CONFIRMED') ORDER BY id").all(input.targetClusterId) as {id:string}[]).map(r=>r.id);
      if (JSON.stringify(targetIds) !== JSON.stringify([...input.expectedTargetAssignmentIds].sort())) stale();
      if (input.assignments.length !== members.length || !members.length) stale();
      for (const expected of input.expectedAssignments) {
        const current = this.db.prepare("SELECT id FROM observation_cluster_assignments WHERE source_observation_id=? AND superseded_at IS NULL AND status IN ('ACCEPTED','USER_CONFIRMED')").get(expected.observationId) as {id:string}|undefined;
        if (current?.id !== expected.assignmentId) stale();
      }
      for (let i=0;i<members.length;i++) {
        const assignment = input.assignments[i]!;
        if (assignment.sourceObservationId !== members[i] || assignment.employerClusterId !== input.targetClusterId || assignment.algorithm !== EMPLOYER_IDENTITY_ALGORITHM || assignment.status !== (input.decision === "USE_EXISTING" ? "USER_CONFIRMED" : "REJECTED")) stale();
        if (input.decision === "USE_EXISTING") {
          this.db.prepare("UPDATE observation_cluster_assignments SET superseded_at=? WHERE id=? AND superseded_at IS NULL").run(assignment.evaluatedAt.toISOString(),input.expectedAssignments[i]!.assignmentId);
        }
        insertObservationClusterAssignment(this.db,assignment);
      }
      if (input.decision === "USE_EXISTING") {
        const at=input.assignments[0]!.evaluatedAt.toISOString();
        this.db.prepare("UPDATE observation_cluster_assignments SET superseded_at=? WHERE status='PROPOSED' AND superseded_at IS NULL AND source_observation_id IN (SELECT source_observation_id FROM canonical_vacancy_source_observations WHERE canonical_vacancy_id=?)").run(at,input.canonicalVacancyId);
        // Keep raw diagnostics aligned immediately; names, evidence and role decisions stay intact.
        this.db.prepare("UPDATE canonical_vacancy_organization_relationships SET employer_cluster_id=?,derivation_algorithm=?,derivation_algorithm_version='1',derived_at=? WHERE canonical_vacancy_id=? AND role='EMPLOYER' AND employer_cluster_id IS NOT NULL").run(input.targetClusterId,EMPLOYER_IDENTITY_ALGORITHM,at,input.canonicalVacancyId);
        this.db.prepare(`INSERT INTO canonical_vacancy_organization_relationships
          (canonical_vacancy_id,relationship_order,employer_cluster_id,role,derivation_algorithm,derivation_algorithm_version,derived_at)
          SELECT ?,COALESCE(MAX(relationship_order),-1)+1,?,'EMPLOYER',?,'1',?
          FROM canonical_vacancy_organization_relationships WHERE canonical_vacancy_id=?
          HAVING NOT EXISTS (SELECT 1 FROM canonical_vacancy_organization_relationships WHERE canonical_vacancy_id=? AND role='EMPLOYER' AND employer_cluster_id IS NOT NULL)
        `).run(input.canonicalVacancyId,input.targetClusterId,EMPLOYER_IDENTITY_ALGORITHM,at,input.canonicalVacancyId,input.canonicalVacancyId);
        const pointers = this.db.prepare("SELECT relationship_order AS position FROM canonical_vacancy_organization_relationships WHERE canonical_vacancy_id=? AND role='EMPLOYER' AND employer_cluster_id=?").all(input.canonicalVacancyId,input.targetClusterId) as {position:number}[];
        for (const pointer of pointers) this.db.prepare("DELETE FROM canonical_vacancy_organization_evidence WHERE canonical_vacancy_id=? AND relationship_order=?").run(input.canonicalVacancyId,pointer.position);
        input.assignments.forEach((assignment,index) => {
          const evidenceId=`${assignment.id}:identity-evidence`;
          this.db.prepare(`INSERT INTO canonical_vacancy_evidence_references (canonical_vacancy_id,evidence_ref_id,source_observation_id,kind,evidence_order)
            SELECT ?,?,?,'EMPLOYER_IDENTITY_DECISION',COALESCE(MAX(evidence_order),-1)+1 FROM canonical_vacancy_evidence_references WHERE canonical_vacancy_id=?
          `).run(input.canonicalVacancyId,evidenceId,assignment.sourceObservationId,input.canonicalVacancyId);
          for (const pointer of pointers) this.db.prepare("INSERT INTO canonical_vacancy_organization_evidence (canonical_vacancy_id,relationship_order,evidence_order,evidence_ref_id) VALUES (?,?,?,?)").run(input.canonicalVacancyId,pointer.position,index,evidenceId);
        });
      }
    })();
  }
}
