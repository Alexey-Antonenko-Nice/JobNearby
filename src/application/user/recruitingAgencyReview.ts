import { createHash, randomUUID } from "node:crypto";
import { normalizeOrganizationEvidenceName as normalize } from "../../domain/evidence/OrganizationEvidence.js";
import type { AgencyReviewContext, AgencyRole, ConfirmedOrganizationRoleRepository } from "../../domain/organizations/ConfirmedOrganizationRole.js";
import type { CanonicalVacancy, VacancyOrganizationRelationship } from "../../domain/vacancies/CanonicalVacancy.js";
import type { CanonicalVacancyRepository } from "../../domain/vacancies/CanonicalVacancyRepository.js";

export const AGENCY_CONFIRMATION_STALE = "Recruiting agency candidate is no longer eligible for confirmation.";
interface Candidate { candidateId: string; name: string; role: AgencyRole; identityKey: string; organizationId?: string; evidenceIds: string[]; sourceObservationId: string }

/** Additional read-only role context. Does not persist or rewrite canonical relationships. */
export async function getRecruitingAgencyProjection(vacancy: CanonicalVacancy, repository?: ConfirmedOrganizationRoleRepository) {
  const context: { candidates: Candidate[]; known: AgencyReviewContext["known"][number][]; ambiguousNames: string[] } = { candidates: [], known: [], ambiguousNames: [] };
  if (!repository) return { vacancy, context };
  const groups = new Map<string, VacancyOrganizationRelationship[]>();
  for (const relationship of vacancy.organizationRelationships) {
    if (!relationship.rawName?.trim() || !["DISPLAYED_COMPANY", "RECRUITER", "STAFFING_AGENCY", "EMPLOYER", "CLIENT"].includes(relationship.role)) continue;
    const key = normalize(relationship.rawName);
    groups.set(key, [...groups.get(key) ?? [], relationship]);
  }
  const derived: VacancyOrganizationRelationship[] = [];
  for (const [key, relationships] of groups) {
    // Contextual direct-employer/client evidence wins over global agency knowledge.
    // A known agency is allowed to be the employer of its own internal vacancy.
    if (relationships.some((r) => r.role === "EMPLOYER" || r.role === "CLIENT")) continue;
    const name = relationships[0]!.rawName!.trim();
    const organizationIds = [...new Set(relationships.flatMap((r) => r.organizationId ? [r.organizationId] : []))];
    if (organizationIds.length > 1) { context.ambiguousNames.push(name); continue; }
    const organizationId = organizationIds[0];
    const rows = (await repository.findByNormalizedName(key)).filter((r) => organizationId === undefined || r.organizationId === undefined || r.organizationId === organizationId);
    const identities = new Set(rows.map((r) => r.identityKey));
    if (identities.size > 1) { context.ambiguousNames.push(name); continue; }
    if (rows.length > 0) {
      const known = rows.find((r) => r.role === "STAFFING_AGENCY") ?? rows[0]!;
      context.known.push({ name, role: known.role, memoryId: known.id,
        source: known.sourceVacancyId === vacancy.id ? "USER_CONFIRMED" : "AGENCY_MEMORY" });
      if (!relationships.some((r) => r.role === known.role)) derived.push({ rawName: name, ...(organizationId ? { organizationId } : {}),
        role: known.role, confidence: 1, supportingEvidenceIds: [...new Set(relationships.flatMap((r) => r.supportingEvidenceIds))],
        derivation: { ...vacancy.derivation, algorithm: "human-confirmed-agency-memory", algorithmVersion: "1" } });
      continue;
    }
    const plausible = relationships.filter((r) => r.role === "RECRUITER" || r.role === "STAFFING_AGENCY");
    if (plausible.length === 0) continue;
    const evidenceIds = [...new Set(plausible.flatMap((r) => r.supportingEvidenceIds))].filter((id) => vacancy.evidenceReferences.some((e) =>
      e.id === id && e.kind === "ORGANIZATION_EVIDENCE" && vacancy.sourceObservationIds.includes(e.sourceObservationId))).sort();
    const sourceObservationId = vacancy.evidenceReferences.find((e) => evidenceIds.includes(e.id))?.sourceObservationId;
    if (!sourceObservationId || evidenceIds.length === 0) continue;
    const role = plausible.some((r) => r.role === "STAFFING_AGENCY") ? "STAFFING_AGENCY" as const : "RECRUITER" as const;
    const identityKey = organizationId === undefined ? `name:${key}` : `organization:${organizationId}`;
    const candidateId = createHash("sha256").update(JSON.stringify([vacancy.id, vacancy.sourceObservationIds, identityKey, role, evidenceIds])).digest("hex");
    context.candidates.push({ candidateId, name, role, identityKey, ...(organizationId ? { organizationId } : {}), evidenceIds, sourceObservationId });
  }
  return { vacancy: derived.length ? { ...vacancy, organizationRelationships: [...vacancy.organizationRelationships, ...derived] } : vacancy, context };
}

export async function confirmVacancyRecruitingAgency(vacancyId: string, candidateId: string, deps: {
  readonly canonicalVacancyRepository: Pick<CanonicalVacancyRepository, "findById">;
  readonly agencyMemoryRepository?: ConfirmedOrganizationRoleRepository;
  readonly now?: () => Date; readonly generateId?: () => string;
}): Promise<void> {
  const vacancy = await deps.canonicalVacancyRepository.findById(vacancyId);
  if (!vacancy) throw new Error(`CanonicalVacancy "${vacancyId}" does not exist.`);
  if (!deps.agencyMemoryRepository) throw new Error("Recruiting agency confirmation is unavailable.");
  const candidate = (await getRecruitingAgencyProjection(vacancy, deps.agencyMemoryRepository)).context.candidates.find((c) => c.candidateId === candidateId);
  if (!candidate) throw new Error(AGENCY_CONFIRMATION_STALE);
  const inserted = await deps.agencyMemoryRepository.append({ id: deps.generateId?.() ?? randomUUID(),
    identityKey: candidate.identityKey, ...(candidate.organizationId ? { organizationId: candidate.organizationId } : {}),
    organizationName: candidate.name, normalizedName: normalize(candidate.name), role: candidate.role, source: "USER_CONFIRMED",
    sourceVacancyId: vacancy.id, sourceObservationId: candidate.sourceObservationId, supportingEvidenceIds: candidate.evidenceIds,
    createdAt: deps.now?.() ?? new Date() });
  if (!inserted) throw new Error(AGENCY_CONFIRMATION_STALE);
}
