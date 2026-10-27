import { createHash } from "node:crypto";
import type Database from "better-sqlite3";
import { VacancyCleanupError, type VacancyCleanup, type VacancyCleanupState, type VacancyDeletionPreview } from "../../domain/user/VacancyCleanup.js";
import { createVacancyEvidenceExtractor } from "../../application/evidence/createVacancyEvidenceExtractor.js";
import { VacancyOrganizationRoleDecisionEvidenceExtractor } from "../../application/evidence/VacancyOrganizationRoleDecisionEvidenceExtractor.js";
import { ExistingPipelineCanonicalVacancyAdapter } from "../../application/vacancies/ExistingPipelineCanonicalVacancyAdapter.js";
import { DeterministicCanonicalVacancyCanonicalizer } from "../../application/vacancies/DeterministicCanonicalVacancyCanonicalizer.js";
import { resolveCanonicalEmployerCluster } from "../../application/vacancies/processVacancyObservation.js";
import { SqliteSourceObservationRepository } from "./SqliteSourceObservationRepository.js";
import { SqliteCanonicalVacancyRepository } from "./SqliteCanonicalVacancyRepository.js";
import { SqliteVacancyOrganizationRoleDecisionRepository } from "./SqliteVacancyOrganizationRoleDecisionRepository.js";
import { SqliteObservationClusterAssignmentRepository } from "./SqliteObservationClusterAssignmentRepository.js";
import { SqliteEmployerClusterRepository } from "./SqliteEmployerClusterRepository.js";
import type { CanonicalVacancy } from "../../domain/vacancies/CanonicalVacancy.js";

const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const stale = () => new VacancyCleanupError("This vacancy changed. Reload the review and preview again.", 409);
/** Async extraction happens before the transaction; a content token is rechecked
 * under BEGIN IMMEDIATE before any mutation. No Promise crosses the transaction. */
export class SqliteVacancyCleanup implements VacancyCleanup {
  constructor(private readonly db: Database.Database) {}
  private members(id: string): string[] {
    return (this.db.prepare(`SELECT source_observation_id AS id FROM canonical_vacancy_observation_claims WHERE canonical_vacancy_id=?
      UNION SELECT source_observation_id AS id FROM canonical_vacancy_source_observations WHERE canonical_vacancy_id=? ORDER BY id`).all(id, id) as { id: string }[]).map(r => r.id);
  }
  private snapshot(id: string) {
    const vacancy = this.db.prepare("SELECT * FROM canonical_vacancies WHERE id=?").get(id);
    if (!vacancy) throw new VacancyCleanupError("Vacancy no longer exists.", 404);
    const ids = JSON.stringify(this.members(id));
    const tables = ["canonical_vacancies", "canonical_vacancy_observation_claims", "canonical_vacancy_source_observations", "canonical_vacancy_exact_identity_claims", "vacancy_organization_role_decisions", "user_vacancy_interaction_events", "vacancy_cleanup_state"];
    const owned = tables.map(table => [table, this.db.prepare(`SELECT * FROM ${table} WHERE ${table === "canonical_vacancies" ? "id" : "canonical_vacancy_id"}=? ORDER BY rowid`).all(id)]);
    const sources = ["source_observations", "capture_occurrences", "observation_cluster_assignments", "publication_family_memberships", "recruitment_campaign_memberships"].map(table => [table, this.db.prepare(`SELECT * FROM ${table} WHERE ${table === "source_observations" ? "id" : "source_observation_id"} IN (SELECT value FROM json_each(?)) ORDER BY rowid`).all(ids)]);
    // Shared-memory or effective-employer changes can alter retention/reprojection.
    const shared = ["employer_alias_evidence", "confirmed_organization_roles", "shared_employer_source_evidence", "employer_clusters"].map(table => [table, this.db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]);
    return { owned, sources, shared };
  }
  state(id: string): VacancyCleanupState {
    const token = hash(this.snapshot(id));
    const row = this.db.prepare("SELECT archived_at FROM vacancy_cleanup_state WHERE canonical_vacancy_id=?").get(id) as { archived_at: string | null } | undefined;
    const title = this.db.prepare("SELECT value_json FROM canonical_vacancy_fields WHERE canonical_vacancy_id=? AND field_name='role'").get(id) as { value_json: string | null } | undefined;
    const captures = this.db.prepare(`SELECT id,title,source_url AS url,observed_at AS observedAt FROM source_observations WHERE id IN (SELECT value FROM json_each(?)) ORDER BY observed_at,id`).all(JSON.stringify(this.members(id))) as VacancyCleanupState["captures"];
    return { canonicalVacancyId: id, title: title?.value_json ? (JSON.parse(title.value_json) as { title?: string }).title ?? null : null, archived: Boolean(row?.archived_at), token, captures };
  }
  setArchived(id: string, archived: boolean, expectedToken: string): VacancyCleanupState {
    return this.db.transaction(() => {
      if (this.state(id).token !== expectedToken) throw stale();
      this.db.prepare(`INSERT INTO vacancy_cleanup_state(canonical_vacancy_id,archived_at,revision) VALUES (?,?,1)
        ON CONFLICT(canonical_vacancy_id) DO UPDATE SET archived_at=excluded.archived_at,revision=revision+1`).run(id, archived ? new Date().toISOString() : null);
      return this.state(id);
    }).immediate();
  }
  private retained(ids: readonly string[]) {
    return ids.filter(id => this.db.prepare(`SELECT 1 FROM confirmed_organization_roles WHERE source_observation_id=?
      UNION SELECT 1 FROM employer_alias_evidence e JOIN observation_cluster_assignments a ON a.id=e.source_assignment_id WHERE a.source_observation_id=?
      UNION SELECT 1 FROM shared_employer_source_evidence WHERE source_observation_id=?
      UNION SELECT 1 FROM canonical_vacancy_evidence_references e JOIN confirmed_organization_roles m ON m.source_vacancy_id=e.canonical_vacancy_id
        WHERE e.source_observation_id=? AND e.evidence_ref_id IN (SELECT value FROM json_each(m.supporting_evidence_ids_json)) LIMIT 1`).get(id, id, id, id));
  }
  preview(id: string, observationId?: string): VacancyDeletionPreview {
    const state = this.state(id);
    if (!state.archived) throw new VacancyCleanupError("Archive the vacancy before deleting.", 409);
    if (observationId !== undefined && (!state.captures.some(c => c.id === observationId) || state.captures.length < 2)) throw new VacancyCleanupError("Choose a capture belonging to this vacancy; use whole-vacancy deletion for the last capture.", 400);
    const ids = observationId ? [observationId] : state.captures.map(c => c.id);
    const retainedSourceIds = this.retained(ids);
    const count = (table: string, column: string, values: readonly string[]) => (this.db.prepare(`SELECT count(*) AS n FROM ${table} WHERE ${column} IN (SELECT value FROM json_each(?))`).get(JSON.stringify(values)) as { n: number }).n;
    const history = this.db.prepare("SELECT 1 FROM user_vacancy_interaction_events WHERE canonical_vacancy_id=? AND event_type IN ('APPLIED','INTERVIEW') LIMIT 1").get(id);
    return { ...state, token: hash([state.token, observationId ?? null]), targetObservationId: observationId ?? null,
      requiresHistoryAcknowledgement: Boolean(history), retainedSourceIds,
      affected: [
        { label: "Vacancy records", count: observationId ? 0 : 1 },
        { label: "Capture links removed", count: ids.length },
        { label: "Source snapshots permanently removed", count: ids.length - retainedSourceIds.length },
        { label: "Source snapshots retained only for shared employer memory", count: retainedSourceIds.length },
        { label: "Capture occurrences removed", count: count("capture_occurrences", "source_observation_id", ids) },
        { label: "Vacancy role decisions removed", count: observationId ? 0 : count("vacancy_organization_role_decisions", "canonical_vacancy_id", [id]) },
        { label: "Vacancy interactions removed", count: observationId ? 0 : count("user_vacancy_interaction_events", "canonical_vacancy_id", [id]) },
        { label: "Publication/campaign memberships removed", count: count("publication_family_memberships", "source_observation_id", ids) + count("recruitment_campaign_memberships", "source_observation_id", ids) },
        { label: "Employer assignment history removed", count: (this.db.prepare(`SELECT count(*) AS n FROM observation_cluster_assignments WHERE source_observation_id IN (SELECT value FROM json_each(?)) AND id NOT IN (SELECT source_assignment_id FROM employer_alias_evidence)`).get(JSON.stringify(ids)) as { n: number }).n },
      ] };
  }
  async delete(input: Parameters<VacancyCleanup["delete"]>[0]) {
    const id = input.canonicalVacancyId;
    const preview = this.preview(id, input.observationId);
    if (preview.token !== input.token) throw stale();
    if (input.confirmation !== "DELETE") throw new VacancyCleanupError("Explicit deletion confirmation is required.", 400);
    if (preview.requiresHistoryAcknowledgement && input.acknowledgeApplicationHistory !== true) throw new VacancyCleanupError("Acknowledge the application or interview history before deleting.", 400);
    const target = input.observationId ? [input.observationId] : preview.captures.map(c => c.id);
    const remaining = preview.captures.map(c => c.id).filter(o => !target.includes(o));
    let projection: CanonicalVacancy | undefined;
    if (remaining.length) {
      const repo = new SqliteSourceObservationRepository(this.db);
      const observations = await Promise.all(remaining.map(async o => { const value = await repo.findById(o); if (!value) throw stale(); return value; }));
      const decisions = new SqliteVacancyOrganizationRoleDecisionRepository(this.db);
      const extractor = new VacancyOrganizationRoleDecisionEvidenceExtractor(createVacancyEvidenceExtractor(), o => decisions.forObservation(o));
      const employerCluster = await resolveCanonicalEmployerCluster(remaining, { assignmentRepository: new SqliteObservationClusterAssignmentRepository(this.db), clusterRepository: new SqliteEmployerClusterRepository(this.db) });
      projection = new ExistingPipelineCanonicalVacancyAdapter(new DeterministicCanonicalVacancyCanonicalizer()).canonicalize({
        canonicalVacancyId: id, observations, extractedEvidence: await Promise.all(observations.map(o => extractor.extract(o))),
        ...(employerCluster ? { employerCluster } : {}), derivation: { algorithm: "vacancy-cleanup-reprojection", algorithmVersion: "1", derivedAt: new Date() },
      });
    }
    return this.db.transaction(() => {
      if (this.preview(id, input.observationId).token !== input.token) throw stale();
      for (const source of target) {
        const other = this.db.prepare("SELECT 1 FROM canonical_vacancy_source_observations WHERE source_observation_id=? AND canonical_vacancy_id<>?").get(source, id);
        if (other) throw new VacancyCleanupError("Capture ownership is ambiguous; deletion was cancelled.", 409);
      }
      this.db.prepare("INSERT INTO vacancy_cleanup_guard VALUES (?)").run(id);
      for (const source of target) this.db.prepare("INSERT INTO vacancy_cleanup_source_guard VALUES (?)").run(source);
      this.db.prepare(`INSERT OR IGNORE INTO shared_employer_source_evidence
        SELECT e.canonical_vacancy_id,e.evidence_ref_id,e.source_observation_id,e.kind
        FROM canonical_vacancy_evidence_references e JOIN confirmed_organization_roles m ON m.source_vacancy_id=e.canonical_vacancy_id
        WHERE e.canonical_vacancy_id=? AND e.evidence_ref_id IN (SELECT value FROM json_each(m.supporting_evidence_ids_json))`).run(id);
      // Clear projections in dependency order; saveSync rebuilds them from remaining evidence.
      for (const table of ["canonical_vacancy_organization_relationships", "canonical_vacancy_fields", "canonical_vacancy_evidence_references", "canonical_vacancy_source_observations"]) this.db.prepare(`DELETE FROM ${table} WHERE canonical_vacancy_id=?`).run(id);
      for (const source of target) this.db.prepare("DELETE FROM canonical_vacancy_observation_claims WHERE source_observation_id=? AND canonical_vacancy_id=?").run(source, id);
      this.db.prepare("DELETE FROM canonical_vacancy_exact_identity_claims WHERE canonical_vacancy_id=?").run(id);
      if (!remaining.length) {
        // Delete newest first because decisions link to their immutable predecessors.
        const decisions = this.db.prepare("SELECT id FROM vacancy_organization_role_decisions WHERE canonical_vacancy_id=? ORDER BY rowid DESC").all(id) as { id: string }[];
        for (const decision of decisions) this.db.prepare("DELETE FROM vacancy_organization_role_decisions WHERE id=?").run(decision.id);
        this.db.prepare("DELETE FROM user_vacancy_interaction_events WHERE canonical_vacancy_id=?").run(id);
        this.db.prepare("INSERT INTO deleted_vacancy_records VALUES (?,?)").run(id, new Date().toISOString());
        this.db.prepare("DELETE FROM canonical_vacancies WHERE id=?").run(id);
      }
      for (const source of target) {
        for (const table of ["capture_occurrences", "publication_family_memberships", "recruitment_campaign_memberships"]) this.db.prepare(`DELETE FROM ${table} WHERE source_observation_id=?`).run(source);
        this.db.prepare("DELETE FROM observation_cluster_assignments WHERE source_observation_id=? AND id NOT IN (SELECT source_assignment_id FROM employer_alias_evidence)").run(source);
        if (preview.retainedSourceIds.includes(source)) this.db.prepare("UPDATE source_observations SET retired_at=? WHERE id=?").run(new Date().toISOString(), source);
        else this.db.prepare("DELETE FROM source_observations WHERE id=?").run(source);
      }
      if (projection) {
        new SqliteCanonicalVacancyRepository(this.db).saveSync(projection);
        this.db.prepare("UPDATE vacancy_cleanup_state SET revision=revision+1 WHERE canonical_vacancy_id=?").run(id);
      }
      for (const source of target) this.db.prepare("DELETE FROM vacancy_cleanup_source_guard WHERE source_observation_id=?").run(source);
      this.db.prepare("DELETE FROM vacancy_cleanup_guard WHERE canonical_vacancy_id=?").run(id);
      return { deletedVacancy: remaining.length === 0 };
    }).immediate();
  }
}
