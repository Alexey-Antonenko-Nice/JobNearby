import type { EmployerAliasEvidence, EmployerAliasEvidenceRepository } from "../../domain/recognition/EmployerAliasEvidence.js";
import { normalizeOrganizationEvidenceName as normalize } from "../../domain/evidence/OrganizationEvidence.js";
import type { EmployerCluster } from "../../domain/recognition/EmployerCluster.js";
import type { EmployerClusterRepository } from "../../domain/recognition/EmployerClusterRepository.js";
import type { ObservationClusterAssignmentRepository } from "../../domain/recognition/ObservationClusterAssignmentRepository.js";

/** Exact private memory only; relationship contradictions suppress even advisory matches. */
export async function findConfirmedEmployerMemory(
  organizations: readonly { role: string; rawName?: string }[],
  observationIds: readonly string[],
  clusters: Pick<EmployerClusterRepository, "findCandidates">,
  assignments: ObservationClusterAssignmentRepository,
  aliases?: EmployerAliasEvidenceRepository,
): Promise<{ names: readonly string[]; matches: readonly { cluster: EmployerCluster; currentOrganizationName: string; priorConfirmationCount: number; aliasEvidence?: readonly EmployerAliasEvidence[] }[] }> {
  const empty = { names: [], matches: [] };
  if (assignments.findEffectiveByClusterId === undefined) return empty;
  if (organizations.some(({ role }) => ["STAFFING_AGENCY", "RECRUITER", "CLIENT", "CONSULTANCY"].includes(role))) return empty;
  const names = new Map<string, string>();
  for (const { role, rawName } of organizations) {
    if (!["EMPLOYER", "DISPLAYED_COMPANY"].includes(role) || !rawName?.trim()) continue;
    if (/^unknown employer(?:\s|$)/iu.test(rawName.trim())) continue;
    names.set(normalize(rawName), rawName.trim());
  }
  const explicit = organizations.filter(({ role, rawName }) => role === "EMPLOYER" && rawName?.trim()).map(({ rawName }) => normalize(rawName!));
  const matches = new Map<string, { cluster: EmployerCluster; currentOrganizationName: string; priorConfirmationCount: number; aliasEvidence?: readonly EmployerAliasEvidence[] }>();
  // The existing repository hint filter does not use evidence normalization.
  // Read once, then compare normalized labels exactly (including punctuation spacing).
  const candidateClusters = names.size === 0 ? [] : await clusters.findCandidates({});
  for (const [name, rawName] of names) {
    if (explicit.some((value) => value !== name)) continue;
    const aliasEvidence = aliases ? (await aliases.findActiveByNormalizedName(name)) : [];
    const historicalAliases: EmployerAliasEvidence[] = [];
    for (const evidence of aliasEvidence) {
      const proof = await assignments.findById(evidence.sourceAssignmentId);
      if (proof && !observationIds.includes(proof.sourceObservationId)) historicalAliases.push(evidence);
    }
    for (const cluster of candidateClusters) {
      const supportingAliases = historicalAliases.filter((e) => e.employerClusterId === cluster.id);
      if (cluster.status === "CONFLICTED" || !cluster.displayLabel || (normalize(cluster.displayLabel) !== name && supportingAliases.length === 0)) continue;
      const confirmed = (await assignments.findEffectiveByClusterId(cluster.id)).filter((a) => a.status === "USER_CONFIRMED" && !observationIds.includes(a.sourceObservationId));
      if (confirmed.length > 0) matches.set(cluster.id, { cluster, currentOrganizationName: rawName, ...(supportingAliases.length === 0 ? {} : { aliasEvidence: supportingAliases }), priorConfirmationCount: new Set(confirmed.map((a) => a.sourceObservationId)).size });
    }
  }
  return { names: [...names.keys()], matches: [...matches.values()].sort((a, b) => a.cluster.id < b.cluster.id ? -1 : a.cluster.id > b.cluster.id ? 1 : 0) };
}
