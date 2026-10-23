import type { EmployerAliasEvidenceRepository } from "../../domain/recognition/EmployerAliasEvidence.js";
import { evidenceExtractionInputFor } from "../vacancies/processVacancyObservation.js";
import { createHash } from "node:crypto";
import { normalizeOrganizationEvidenceName as normalize } from "../../domain/evidence/OrganizationEvidence.js";
import type { VacancyOrganizationRoleDecision, OrganizationRoleReviewItem, VacancyOrganizationRoleDecisionRepository, HumanOrganizationRole } from "../../domain/organizations/VacancyOrganizationRoleDecision.js";
import { humanOrganizationRoles } from "../../domain/organizations/VacancyOrganizationRoleDecision.js";
import type { ConfirmedOrganizationRoleRepository } from "../../domain/organizations/ConfirmedOrganizationRole.js";
import type { SourceObservation } from "../../domain/capture/SourceObservation.js";
import type { CanonicalVacancy } from "../../domain/vacancies/CanonicalVacancy.js";
import type { ObservationClusterAssignmentRepository } from "../../domain/recognition/ObservationClusterAssignmentRepository.js";
import type { EmployerClusterRepository } from "../../domain/recognition/EmployerClusterRepository.js";
import { createVacancyEvidenceExtractor } from "../evidence/createVacancyEvidenceExtractor.js";
export function effectiveRoleDecisions(decisions: readonly VacancyOrganizationRoleDecision[]) {
  const latest = new Map<string, VacancyOrganizationRoleDecision>();
  let employer: string | null = null;
  for (const decision of decisions) {
    latest.set(decision.identityKey, decision);
    if (decision.role === "EMPLOYER") employer = decision.identityKey;else if (employer === decision.identityKey) employer = null;
  }
  return {
    latest,
    employer
  };
}
export function projectOrganizationRoleDecisions(vacancy: CanonicalVacancy, decisions: readonly VacancyOrganizationRoleDecision[]): CanonicalVacancy {
  if (!decisions.length) return vacancy;
  const {
    latest,
    employer
  } = effectiveRoleDecisions(decisions);
  const relationships = vacancy.organizationRelationships.filter(r => {
    if (!r.rawName) return true;
    const key = `name:${normalize(r.rawName)}`;
    if (r.role === "DISPLAYED_COMPANY") return true;
    if (employer && r.role === "EMPLOYER" && key !== employer) return false;
    return !latest.has(key);
  });
  for (const [key, decision] of latest) {
    if (decision.role === "EMPLOYER" && key !== employer) continue;
    const refs = vacancy.organizationRelationships.filter(r => r.rawName && normalize(r.rawName) === decision.normalizedName).flatMap(r => r.supportingEvidenceIds);
    relationships.push({
      rawName: decision.organizationName,
      role: decision.role,
      confidence: 1,
      supportingEvidenceIds: [...new Set(refs)],
      derivation: {
        ...vacancy.derivation,
        algorithm: "vacancy-organization-role-decision",
        algorithmVersion: "1"
      }
    });
  }
  return {
    ...vacancy,
    organizationRelationships: relationships
  };
}
export interface OrganizationRoleReviewDependencies {
  readonly aliasRepository?: Pick<EmployerAliasEvidenceRepository, "findActiveByNormalizedName">;
  readonly organizationRoleDecisionRepository: VacancyOrganizationRoleDecisionRepository;
  readonly agencyMemoryRepository?: ConfirmedOrganizationRoleRepository;
  readonly assignmentRepository?: ObservationClusterAssignmentRepository;
  readonly employerClusterRepository: Pick<EmployerClusterRepository, "findById"> & Partial<Pick<EmployerClusterRepository, "findCandidates">>;
}
export async function buildOrganizationRoleReview(vacancy: CanonicalVacancy, observations: readonly SourceObservation[], deps: OrganizationRoleReviewDependencies): Promise<readonly OrganizationRoleReviewItem[]> {
  const decisions = await deps.organizationRoleDecisionRepository.listForVacancy(vacancy.id);
  const current = effectiveRoleDecisions(decisions);
  const extractor = createVacancyEvidenceExtractor();
  const source = await Promise.all(observations.map(async observation => ({
    observation,
    evidence: await extractor.extract(evidenceExtractionInputFor(observation))
  })));
  const names = new Map<string, string>();
  for (const {
    evidence
  } of source) for (const org of evidence.organizations.filter(o => o.role !== "PUBLISHER")) names.set(`name:${normalize(org.value)}`, org.value);
  if (!names.size) for (const r of vacancy.organizationRelationships) if (r.rawName?.trim()) names.set(`name:${normalize(r.rawName)}`, r.rawName.trim());
  for (const d of decisions) names.set(d.identityKey, d.organizationName);
  const assignments = await Promise.all(observations.map(async o => ({
    observationId: o.id,
    assignment: (await deps.assignmentRepository?.findEffectiveByObservationId(o.id)) ?? null
  })));
  const confirmedNames = await Promise.all(assignments.filter(a => a.assignment?.status === "USER_CONFIRMED").map(async a => (await deps.employerClusterRepository.findById(a.assignment!.employerClusterId))?.displayLabel));
  const basis = [vacancy.sourceObservationIds, decisions.at(-1)?.id ?? null, assignments.map(a => [a.observationId, a.assignment?.id ?? null])];
  const output: OrganizationRoleReviewItem[] = [];
  for (const [identityKey, name] of names) {
    const key = normalize(name);
    const history = await deps.organizationRoleDecisionRepository.listForIdentity(identityKey);
    const legacy = (await deps.agencyMemoryRepository?.findByNormalizedName(key)) ?? [];
    const roles = source.flatMap(({
      observation,
      evidence
    }) => evidence.organizations.filter(o => normalize(o.value) === key && (o.role === "RECRUITMENT_AGENCY" || humanOrganizationRoles.includes(o.role as HumanOrganizationRole))).map(o => ({
      role: o.role === "RECRUITMENT_AGENCY" ? "RECRUITER" as const : o.role as HumanOrganizationRole,
      confidence: o.provenance.confidence,
      observation
    }))).sort((a, b) => b.observation.observedAt.getTime() - a.observation.observedAt.getTime());
    const newest = roles[0]?.observation.observedAt.getTime();
    const candidates = roles.filter(r => r.observation.observedAt.getTime() === newest).sort((a, b) => b.confidence - a.confidence);
    const strongest = candidates[0];
    const tiedRoles = new Set(candidates.filter(r => r.confidence === strongest?.confidence).map(r => r.role));
    let recommendedRole: OrganizationRoleReviewItem["recommendedRole"] = strongest && tiedRoles.size === 1 ? strongest.role : "UNKNOWN";
    let confidence = recommendedRole === "UNKNOWN" ? 0 : strongest!.confidence;
    let evidenceStrength: OrganizationRoleReviewItem["evidenceStrength"] = strongest && recommendedRole !== "UNKNOWN" ? confidence === 1 ? "EXPLICIT" : "CONTEXTUAL" : "UNKNOWN";
    const reasons: string[] = [];
    if (recommendedRole !== "UNKNOWN") {
      if (recommendedRole === "EMPLOYER" && strongest?.observation.source.sourceUrl?.includes("/corporatecareers-kellyservices-com/")) reasons.push("Corporate-careers tenant", "First-person Kelly employer wording", "No recruiting-for-client or staffing-assignment evidence");else reasons.push(`${evidenceStrength === "EXPLICIT" ? "Current vacancy evidence" : "Provider or vacancy context"} supports ${recommendedRole.toLowerCase().replaceAll("_", " ")}.`);
      if (recommendedRole === "STAFFING_AGENCY" || recommendedRole === "RECRUITER") reasons.push("The vacancy identifies a recruiting/intermediary relationship or agency context.");
    } else if (tiedRoles.size > 1) {
      evidenceStrength = strongest!.confidence === 1 ? "EXPLICIT" : "CONTEXTUAL";
      reasons.push("Current source evidence contains conflicting organization roles.");
    }
    const legacyEmployerHistory = (await deps.organizationRoleDecisionRepository.listLegacyEmployerHistory?.(key)) ?? [];
    const historical = [...legacyEmployerHistory, ...history.filter(h => h.canonicalVacancyId !== vacancy.id).map(h => ({
      role: h.role,
      vacancyId: h.canonicalVacancyId,
      recordedAt: h.createdAt.toISOString()
    })), ...legacy.map(h => ({
      role: h.role,
      vacancyId: h.sourceVacancyId,
      recordedAt: h.createdAt.toISOString()
    }))];
    if (!strongest) {
      const prior = new Set(historical.map(h => h.role));
      if (prior.size === 1) {
        recommendedRole = [...prior][0]!;
        confidence = 0.6;
        evidenceStrength = "HISTORY";
        reasons.push("Previously confirmed organization role; current-vacancy role is not explicit.");
      } else reasons.push(prior.size > 1 ? "Historical roles coexist; the current role needs review." : "No reliable organization-role evidence yet.");
    }
    const aliases = await deps.aliasRepository?.findActiveByNormalizedName(key) ?? [];
    const confirmedByAlias = aliases.some(alias => assignments.some(a => a.assignment?.status === "USER_CONFIRMED" && a.assignment.employerClusterId === alias.employerClusterId));
    const decision = current.latest.get(identityKey);
    let confirmedRole = decision ? decision.role === "EMPLOYER" && current.employer !== identityKey ? null : decision.role : null;
    if (!decision && (confirmedByAlias || confirmedNames.some(n => n && normalize(n) === key))) confirmedRole = "EMPLOYER";
    if (!decision && !confirmedRole) confirmedRole = legacy.find(h => h.sourceVacancyId === vacancy.id)?.role ?? null;
    const candidateToken = createHash("sha256").update(JSON.stringify([identityKey, basis, recommendedRole, confidence, reasons, roles.map(r => [r.role, r.confidence])])).digest("hex");
    output.push({
      identityKey,
      name,
      recommendedRole,
      confidence,
      evidenceStrength,
      reasons,
      confirmedRole,
      candidateToken,
      history: [...historical, ...history.filter(h => h.canonicalVacancyId === vacancy.id).map(h => ({
        role: h.role,
        vacancyId: h.canonicalVacancyId,
        recordedAt: h.createdAt.toISOString()
      }))],
      actions: humanOrganizationRoles.map(role => ({
        role,
        warning: tiedRoles.size > 1 ? "Current vacancy evidence contains conflicting roles. Confirm your chosen role for this vacancy." : role !== recommendedRole && (evidenceStrength === "EXPLICIT" || evidenceStrength === "CONTEXTUAL") ? `Current vacancy evidence recommends ${recommendedRole.toLowerCase().replaceAll("_", " ")}. Confirm that you want ${role.toLowerCase().replaceAll("_", " ")} for this vacancy instead.` : role === "EMPLOYER" && confirmedNames.some(n => n && normalize(n) !== key) ? "This replaces the currently confirmed employer for this vacancy. Other vacancies and previous decisions remain unchanged." : confirmedRole && role !== confirmedRole ? "This replaces your role choice for this vacancy. Previous decisions will remain in history." : null
      }))
    });
  }
  return output;
}
