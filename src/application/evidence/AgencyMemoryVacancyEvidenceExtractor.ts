import type { VacancyEvidenceExtractor } from "../../domain/evidence/VacancyEvidenceExtractor.js";
import type { VacancyEvidenceExtractionInput } from "../../domain/evidence/VacancyEvidenceInput.js";
import { createExtractedVacancyEvidence } from "../../domain/evidence/ExtractedVacancyEvidence.js";
import { normalizeOrganizationEvidenceName as normalize, type OrganizationEvidence } from "../../domain/evidence/OrganizationEvidence.js";
import type { ConfirmedOrganizationRoleRepository } from "../../domain/organizations/ConfirmedOrganizationRole.js";

/** Adds derived memory evidence; never changes source evidence or employer decisions. */
export class AgencyMemoryVacancyEvidenceExtractor implements VacancyEvidenceExtractor {
  constructor(private readonly delegate: VacancyEvidenceExtractor, private readonly memory: ConfirmedOrganizationRoleRepository) {}

  async extract(input: VacancyEvidenceExtractionInput) {
    const evidence = await this.delegate.extract(input);
    const additions: OrganizationEvidence[] = [];
    const groups = new Map<string, OrganizationEvidence[]>();
    for (const organization of evidence.organizations) {
      const key = normalize(organization.value);
      groups.set(key, [...groups.get(key) ?? [], organization]);
    }
    for (const [key, organizations] of groups) {
      if (organizations.some((o) => o.role === "EMPLOYER" || o.role === "CLIENT")) continue;
      if (!organizations.some((o) => ["UNKNOWN", "DISPLAYED_COMPANY", "RECRUITER", "STAFFING_AGENCY", "RECRUITMENT_AGENCY"].includes(o.role))) continue;
      const records = await this.memory.findByNormalizedName(key);
      if (new Set(records.map((record) => record.identityKey)).size !== 1) continue;
      const known = records.find((r) => r.role === "STAFFING_AGENCY") ?? records[0]!;
      if (organizations.some((o) => o.role === known.role)) continue;
      const original = organizations[0]!;
      additions.push({ value: original.value, normalizedName: key, role: known.role, provenance: {
        ...original.provenance, extractionMethod: "EXTERNAL_SOURCE", confidence: 1, organizationRoleMemoryId: known.id,
      } });
    }
    return additions.length ? createExtractedVacancyEvidence({ ...evidence, organizations: [...evidence.organizations, ...additions] }) : evidence;
  }
}
