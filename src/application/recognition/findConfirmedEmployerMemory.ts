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
): Promise<{ names: readonly string[]; matches: readonly { cluster: EmployerCluster; currentOrganizationName: string; priorConfirmationCount: number }[] }> {
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
  const matches = new Map<string, { cluster: EmployerCluster; currentOrganizationName: string; priorConfirmationCount: number }>();
  // The existing repository hint filter does not use evidence normalization.
  // Read once, then compare normalized labels exactly (including punctuation spacing).
  const candidateClusters = names.size === 0 ? [] : await clusters.findCandidates({});
  for (const [name, rawName] of names) {
    if (explicit.some((value) => value !== name)) continue;
    for (const cluster of candidateClusters) {
      if (cluster.status === "CONFLICTED" || !cluster.displayLabel || normalize(cluster.displayLabel) !== name) continue;
      const confirmed = (await assignments.findEffectiveByClusterId(cluster.id)).filter((a) => a.status === "USER_CONFIRMED" && !observationIds.includes(a.sourceObservationId));
      if (confirmed.length > 0) matches.set(cluster.id, { cluster, currentOrganizationName: rawName, priorConfirmationCount: new Set(confirmed.map((a) => a.sourceObservationId)).size });
    }
  }
  return { names: [...names.keys()], matches: [...matches.values()].sort((a, b) => a.cluster.id < b.cluster.id ? -1 : a.cluster.id > b.cluster.id ? 1 : 0) };
}
