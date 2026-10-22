import type Database from "better-sqlite3";
import type { ConfirmedOrganizationRole, ConfirmedOrganizationRoleRepository } from "../../domain/organizations/ConfirmedOrganizationRole.js";
import { normalizeOrganizationEvidenceName } from "../../domain/evidence/OrganizationEvidence.js";

interface Row {
  id: string; identity_key: string; organization_id: string | null; organization_name: string; normalized_name: string;
  role: ConfirmedOrganizationRole["role"]; source_type: "USER_CONFIRMED"; source_vacancy_id: string;
  source_observation_id: string; supporting_evidence_ids_json: string; created_at: string;
}

export class SqliteConfirmedOrganizationRoleRepository implements ConfirmedOrganizationRoleRepository {
  constructor(private readonly db: Database.Database) {}

  async findByNormalizedName(name: string): Promise<readonly ConfirmedOrganizationRole[]> {
    return (this.db.prepare("SELECT * FROM confirmed_organization_roles WHERE normalized_name = ? ORDER BY created_at, id").all(name) as Row[]).map((row) => ({
      id: row.id, identityKey: row.identity_key, ...(row.organization_id === null ? {} : { organizationId: row.organization_id }),
      organizationName: row.organization_name, normalizedName: row.normalized_name, role: row.role, source: row.source_type,
      sourceVacancyId: row.source_vacancy_id, sourceObservationId: row.source_observation_id,
      supportingEvidenceIds: JSON.parse(row.supporting_evidence_ids_json) as string[], createdAt: new Date(row.created_at),
    }));
  }

  async append(record: ConfirmedOrganizationRole): Promise<boolean> {
    if (normalizeOrganizationEvidenceName(record.organizationName) !== record.normalizedName
      || record.identityKey !== (record.organizationId === undefined ? `name:${record.normalizedName}` : `organization:${record.organizationId}`)
      || record.supportingEvidenceIds.length === 0 || record.supportingEvidenceIds.some((id) => !id.trim())
      || !Number.isFinite(record.createdAt.getTime())) throw new Error("Agency memory record is invalid.");
    return this.db.transaction(() => {
      const membership = this.db.prepare(`SELECT 1 FROM canonical_vacancy_source_observations
        WHERE canonical_vacancy_id = ? AND source_observation_id = ?`).get(record.sourceVacancyId, record.sourceObservationId);
      const proof = this.db.prepare(`SELECT COUNT(*) AS count FROM canonical_vacancy_evidence_references
        WHERE canonical_vacancy_id = ? AND kind = 'ORGANIZATION_EVIDENCE'
        AND evidence_ref_id IN (SELECT value FROM json_each(?))`).get(record.sourceVacancyId, JSON.stringify(record.supportingEvidenceIds)) as { count: number };
      if (!membership || proof.count !== new Set(record.supportingEvidenceIds).size) throw new Error("Agency memory source evidence is invalid.");
      return this.db.prepare(`INSERT INTO confirmed_organization_roles
      (id, identity_key, organization_id, organization_name, normalized_name, role, source_type,
       source_vacancy_id, source_observation_id, supporting_evidence_ids_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(identity_key, normalized_name, role) DO NOTHING`).run(record.id, record.identityKey, record.organizationId ?? null,
      record.organizationName, record.normalizedName, record.role, record.source, record.sourceVacancyId,
        record.sourceObservationId, JSON.stringify(record.supportingEvidenceIds), record.createdAt.toISOString()).changes === 1;
    })();
  }
}
