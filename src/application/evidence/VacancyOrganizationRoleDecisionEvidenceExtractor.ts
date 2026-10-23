import type { VacancyEvidenceExtractor } from "../../domain/evidence/VacancyEvidenceExtractor.js";
import type { VacancyEvidenceExtractionInput } from "../../domain/evidence/VacancyEvidenceInput.js";
import type { VacancyOrganizationRoleDecision } from "../../domain/organizations/VacancyOrganizationRoleDecision.js";
import { normalizeOrganizationEvidenceName as normalize } from "../../domain/evidence/OrganizationEvidence.js";
import { createExtractedVacancyEvidence } from "../../domain/evidence/ExtractedVacancyEvidence.js";
import { effectiveRoleDecisions } from "../user/vacancyOrganizationRoles.js";
/** Human choices apply to this canonical vacancy, including its later captures. */
export class VacancyOrganizationRoleDecisionEvidenceExtractor implements VacancyEvidenceExtractor {
  constructor(private readonly delegate: VacancyEvidenceExtractor, private readonly decisionsForObservation: (id: string) => readonly VacancyOrganizationRoleDecision[]) {}
  async extract(input: VacancyEvidenceExtractionInput) {
    const evidence = await this.delegate.extract(input),
      decisions = this.decisionsForObservation(input.id);
    if (!decisions.length) return evidence;
    const {
      latest,
      employer
    } = effectiveRoleDecisions(decisions);
    const organizations = evidence.organizations.filter(o => o.role === "DISPLAYED_COMPANY" || !latest.has(`name:${normalize(o.value)}`) && !(employer && o.role === "EMPLOYER"));
    for (const [key, d] of latest) if (d.role !== "EMPLOYER" || key === employer) organizations.push({
      value: d.organizationName,
      role: d.role,
      provenance: {
        sourceObservationId: input.id,
        confidence: 1,
        ...(d.basis.legacyAgencyMemory ? {
          extractionMethod: "EXTERNAL_SOURCE" as const,
          organizationRoleMemoryId: d.id
        } : {
          extractionMethod: "USER_CONFIRMED" as const,
          organizationRoleDecisionId: d.id
        })
      }
    });
    return createExtractedVacancyEvidence({
      ...evidence,
      organizations
    });
  }
}
