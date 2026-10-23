import type Database from "better-sqlite3";
import type { VacancyOrganizationRoleDecision, VacancyOrganizationRoleDecisionRepository } from "../../domain/organizations/VacancyOrganizationRoleDecision.js";
import { humanOrganizationRoles } from "../../domain/organizations/VacancyOrganizationRoleDecision.js";
import { normalizeOrganizationEvidenceName as normalize } from "../../domain/evidence/OrganizationEvidence.js";
import { insertEmployerCluster } from "./SqliteEmployerClusterRepository.js";
import { insertObservationClusterAssignment } from "./SqliteObservationClusterAssignmentRepository.js";
interface Row {
  id: string;
  canonical_vacancy_id: string;
  identity_key: string;
  organization_name: string;
  normalized_name: string;
  role: VacancyOrganizationRoleDecision["role"];
  previous_decision_id: string | null;
  basis_json: string;
  override_acknowledged: number;
  created_at: string;
}
function map(row: Row): VacancyOrganizationRoleDecision {
  return {
    id: row.id,
    canonicalVacancyId: row.canonical_vacancy_id,
    identityKey: row.identity_key,
    organizationName: row.organization_name,
    normalizedName: row.normalized_name,
    role: row.role,
    previousDecisionId: row.previous_decision_id,
    basis: JSON.parse(row.basis_json),
    overrideAcknowledged: row.override_acknowledged === 1,
    createdAt: new Date(row.created_at)
  };
}
export class SqliteVacancyOrganizationRoleDecisionRepository implements VacancyOrganizationRoleDecisionRepository {
  constructor(private readonly db: Database.Database) {}
  listSync(vacancyId: string) {
    return (this.db.prepare("SELECT * FROM vacancy_organization_role_decisions WHERE canonical_vacancy_id=? ORDER BY rowid").all(vacancyId) as Row[]).map(map);
  }
  async listForVacancy(vacancyId: string) {
    return this.listSync(vacancyId);
  }
  async listForIdentity(identityKey: string) {
    return (this.db.prepare("SELECT * FROM vacancy_organization_role_decisions WHERE identity_key=? ORDER BY rowid").all(identityKey) as Row[]).map(map);
  }
  async findById(id: string) {
    const row = this.db.prepare("SELECT * FROM vacancy_organization_role_decisions WHERE id=?").get(id) as Row | undefined;
    return row ? map(row) : null;
  }
  async listLegacyEmployerHistory(normalizedName: string) {
    const rows = this.db.prepare(`SELECT c.display_label, m.canonical_vacancy_id, a.evaluated_at
      FROM observation_cluster_assignments a JOIN employer_clusters c ON c.id=a.employer_cluster_id
      JOIN canonical_vacancy_observation_claims m ON m.source_observation_id=a.source_observation_id
      WHERE a.status='USER_CONFIRMED' AND a.algorithm<>'user-vacancy-organization-role' AND c.display_label IS NOT NULL
      ORDER BY a.rowid`).all() as {
      display_label: string;
      canonical_vacancy_id: string;
      evaluated_at: string;
    }[];
    return rows.filter(r => normalize(r.display_label) === normalizedName).map(r => ({
      role: "EMPLOYER" as const,
      vacancyId: r.canonical_vacancy_id,
      recordedAt: r.evaluated_at
    }));
  }
  forObservation(observationId: string): readonly VacancyOrganizationRoleDecision[] {
    const claim = this.db.prepare("SELECT canonical_vacancy_id FROM canonical_vacancy_observation_claims WHERE source_observation_id=?").get(observationId) as {
      canonical_vacancy_id: string;
    } | undefined;
    if (!claim) return [];
    const decisions = this.listSync(claim.canonical_vacancy_id);
    // Existing agency confirmations already describe a human choice on their
    // source vacancy. Preserve that choice without applying it to other vacancies.
    const legacy = this.db.prepare("SELECT * FROM confirmed_organization_roles WHERE source_vacancy_id=? ORDER BY rowid").all(claim.canonical_vacancy_id) as {
      id: string;
      identity_key: string;
      organization_name: string;
      normalized_name: string;
      role: "RECRUITER" | "STAFFING_AGENCY";
      created_at: string;
    }[];
    return [...legacy.filter(row => !decisions.some(d => d.normalizedName === row.normalized_name)).map(row => ({
      id: row.id,
      canonicalVacancyId: claim.canonical_vacancy_id,
      identityKey: `name:${row.normalized_name}`,
      organizationName: row.organization_name,
      normalizedName: row.normalized_name,
      role: row.role,
      previousDecisionId: null,
      basis: {
        legacyAgencyMemory: true
      },
      overrideAcknowledged: false,
      createdAt: new Date(row.created_at)
    })), ...decisions];
  }
  async commit(input: Parameters<VacancyOrganizationRoleDecisionRepository["commit"]>[0]) {
    const d = input.decision;
    if (!humanOrganizationRoles.includes(d.role) || !d.id.trim() || normalize(d.organizationName) !== d.normalizedName || d.identityKey !== `name:${d.normalizedName}` || !Number.isFinite(d.createdAt.getTime())) throw Error("Invalid organization role decision.");
    this.db.transaction(() => {
      const head = this.listSync(d.canonicalVacancyId).at(-1)?.id ?? null;
      if (head !== d.previousDecisionId) throw Error("Organization role review is stale. Refresh the vacancy.");
      const observations = (this.db.prepare("SELECT source_observation_id FROM canonical_vacancy_source_observations WHERE canonical_vacancy_id=? ORDER BY source_observation_id").all(d.canonicalVacancyId) as {
        source_observation_id: string;
      }[]).map(row => row.source_observation_id);
      if (JSON.stringify(observations) !== JSON.stringify([...input.expectedObservationIds].sort())) throw Error("Organization role review is stale. Refresh the vacancy.");
      for (const expected of input.expectedAssignments) {
        const row = this.db.prepare("SELECT id FROM observation_cluster_assignments WHERE source_observation_id=? AND superseded_at IS NULL AND status IN ('ACCEPTED','USER_CONFIRMED')").get(expected.observationId) as {
          id: string;
        } | undefined;
        if ((row?.id ?? null) !== expected.assignmentId || !observations.includes(expected.observationId)) throw Error("Organization role review is stale. Refresh the vacancy.");
      }
      if (input.expectedAssignments.length !== observations.length || new Set(input.expectedAssignments.map(a => a.observationId)).size !== observations.length) throw Error("Invalid organization role membership basis.");
      if (input.newCluster) insertEmployerCluster(this.db, input.newCluster);
      for (const change of input.assignmentChanges) {
        const expected = input.expectedAssignments.find(a => a.observationId === change.replacement.sourceObservationId);
        if (!expected || expected.assignmentId !== change.expectedId || change.replacement.status !== "USER_CONFIRMED") throw Error("Invalid organization role assignment.");
        if (change.expectedId) this.db.prepare("UPDATE observation_cluster_assignments SET superseded_at=? WHERE id=? AND superseded_at IS NULL").run(d.createdAt.toISOString(), change.expectedId);
        insertObservationClusterAssignment(this.db, change.replacement);
      }
      this.db.prepare("UPDATE observation_cluster_assignments SET superseded_at=? WHERE superseded_at IS NULL AND status='PROPOSED' AND source_observation_id IN (SELECT source_observation_id FROM canonical_vacancy_source_observations WHERE canonical_vacancy_id=?)").run(d.createdAt.toISOString(), d.canonicalVacancyId);
      this.db.prepare(`INSERT INTO vacancy_organization_role_decisions (id,canonical_vacancy_id,identity_key,organization_name,normalized_name,role,previous_decision_id,basis_json,override_acknowledged,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)`).run(d.id, d.canonicalVacancyId, d.identityKey, d.organizationName, d.normalizedName, d.role, d.previousDecisionId, JSON.stringify(d.basis), Number(d.overrideAcknowledged), d.createdAt.toISOString());
      // Retain the existing agency-memory registry as historical knowledge. Each
      // vacancy-specific human action is independently preserved in the new log.
      if (["STAFFING_AGENCY", "RECRUITER"].includes(d.role) && input.agencyEvidenceIds.length) {
        const valid = this.db.prepare("SELECT COUNT(*) AS count FROM canonical_vacancy_evidence_references WHERE canonical_vacancy_id=? AND kind='ORGANIZATION_EVIDENCE' AND evidence_ref_id IN (SELECT value FROM json_each(?))").get(d.canonicalVacancyId, JSON.stringify(input.agencyEvidenceIds)) as {
          count: number;
        };
        if (valid.count !== new Set(input.agencyEvidenceIds).size) throw Error("Invalid organization role evidence.");
        this.db.prepare(`INSERT INTO confirmed_organization_roles (id,identity_key,organization_name,normalized_name,role,source_type,source_vacancy_id,source_observation_id,supporting_evidence_ids_json,created_at) VALUES (?,?,?,?,?,'USER_CONFIRMED',?,?,?,?) ON CONFLICT(identity_key,normalized_name,role) DO NOTHING`).run(d.id, d.identityKey, d.organizationName, d.normalizedName, d.role, d.canonicalVacancyId, input.expectedObservationIds.at(-1), JSON.stringify(input.agencyEvidenceIds), d.createdAt.toISOString());
      }
    })();
  }
}
