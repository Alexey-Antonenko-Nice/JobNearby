import { normalizeOrganizationEvidenceName } from "../../domain/evidence/OrganizationEvidence.js";
import { findConfirmedEmployerMemory } from "../recognition/findConfirmedEmployerMemory.js";
import { createObservationClusterAssignment } from "../recognition/createObservationClusterAssignment.js";
import type { EmployerClusterRepository } from "../../domain/recognition/EmployerClusterRepository.js";
import type { ObservationClusterAssignmentRepository } from "../../domain/recognition/ObservationClusterAssignmentRepository.js";
import type { CanonicalVacancy } from "../../domain/vacancies/CanonicalVacancy.js";
import type { EmployerMemoryReviewCandidate } from "../../domain/user/EmployerMemoryReviewCandidate.js";

export interface MemoryReviewDependencies {
  readonly employerClusterRepository: Pick<EmployerClusterRepository, "findById"> & Partial<Pick<EmployerClusterRepository, "findCandidates">>;
  readonly assignmentRepository?: ObservationClusterAssignmentRepository;
}
export const MEMORY_REVIEW_ALGORITHM = "user-employer-memory-review";

export async function getEmployerMemoryReviewCandidates(vacancy: CanonicalVacancy, deps: MemoryReviewDependencies): Promise<readonly EmployerMemoryReviewCandidate[]> {
  const repository = deps.assignmentRepository;
  const findCandidates = deps.employerClusterRepository.findCandidates;
  if (!repository || !findCandidates) return [];
  const effective = (await Promise.all(vacancy.sourceObservationIds.map((id) => repository.findEffectiveByObservationId(id)))).filter((a) => a !== null);
  if (effective.some((a) => a.status === "USER_CONFIRMED")) return [];
  let conflictedState = false;
  const namedNonFinalClusterIds = new Set<string>();
  const clusterIds = new Set([...effective.map((a) => a.employerClusterId), ...vacancy.organizationRelationships.filter((r) => r.role === "EMPLOYER").flatMap((r) => r.employerClusterId ? [r.employerClusterId] : [])]);
  for (const id of clusterIds) {
    const cluster = await deps.employerClusterRepository.findById(id);
    if (!cluster || cluster.status === "RESOLVED" || cluster.status === "PROBABLY_RESOLVED") return [];
    if (cluster.status === "CONFLICTED") conflictedState = true;
    if (cluster.displayLabel && !/^unknown employer(?:\s|$)/iu.test(cluster.displayLabel)) namedNonFinalClusterIds.add(id);
  }
  const memory = await findConfirmedEmployerMemory(vacancy.organizationRelationships, vacancy.sourceObservationIds, { findCandidates: findCandidates.bind(deps.employerClusterRepository) }, repository);
  const proposals = await Promise.all(vacancy.sourceObservationIds.map((id) => repository.findCurrentProposalByObservationId(id)));
  const history = (await Promise.all(vacancy.sourceObservationIds.map((id) => repository.findByObservationId(id)))).flat();
  const reasons: EmployerMemoryReviewCandidate["reasonCodes"][number][] = [];
  if (memory.matches.some((match, index) => memory.matches.some((other, otherIndex) => index !== otherIndex && other.currentOrganizationName === match.currentOrganizationName))) reasons.push("MULTIPLE_CONFIRMED_CLUSTERS");
  if (memory.names.length > 1) reasons.push("MULTIPLE_CURRENT_EMPLOYER_NAMES");
  if (conflictedState || memory.matches.some(({ cluster }) => [...namedNonFinalClusterIds].some((id) => id !== cluster.id))) reasons.push("CONFLICTING_EFFECTIVE_ASSIGNMENT");
  if (proposals.some((p) => p !== null)) reasons.push("RECOGNITION_REVIEW_REQUIRED");
  if (reasons.length === 0) return [];
  return memory.matches.filter(({ cluster }) => !history.some((a) => a.employerClusterId === cluster.id && a.status === "REJECTED" && a.algorithm === MEMORY_REVIEW_ALGORITHM)).map(({ cluster, currentOrganizationName, priorConfirmationCount }) => ({
    employerClusterId: cluster.id, displayLabel: cluster.displayLabel!, status: cluster.status,
    currentOrganizationName, reasonCodes: reasons, priorConfirmationExists: true, priorConfirmationCount,
    explanation: `Previously confirmed employer memory exists for "${currentOrganizationName}". Automatic reuse was not performed: ${reasons.map((r) => ({ MULTIPLE_CONFIRMED_CLUSTERS: "multiple confirmed clusters match", MULTIPLE_CURRENT_EMPLOYER_NAMES: "multiple current employer names exist", CONFLICTING_EFFECTIVE_ASSIGNMENT: "the current assignment conflicts", RECOGNITION_REVIEW_REQUIRED: "recognition requires review" })[r]).join("; ")}.`,
  }));
}

export async function decideEmployerMemoryReview(vacancy: CanonicalVacancy, employerClusterId: string, decision: "CONFIRM" | "REJECT", deps: MemoryReviewDependencies): Promise<void> {
  const repository = deps.assignmentRepository;
  const observationId = vacancy.sourceObservationIds.at(-1);
  if (!repository || !observationId) throw new Error("Employer memory review is unavailable.");
  const history = (await Promise.all(vacancy.sourceObservationIds.map((id) => repository.findByObservationId(id)))).flat();
  if (decision === "REJECT" && history.some((a) => a.employerClusterId === employerClusterId && a.status === "REJECTED" && a.algorithm === MEMORY_REVIEW_ALGORITHM)) return;
  const effective = await repository.findEffectiveByObservationId(observationId);
  if (decision === "CONFIRM" && effective?.status === "USER_CONFIRMED" && effective.employerClusterId === employerClusterId && effective.algorithm === MEMORY_REVIEW_ALGORITHM) return;
  const candidate = (await getEmployerMemoryReviewCandidates(vacancy, deps)).find((c) => c.employerClusterId === employerClusterId);
  if (!candidate) throw new Error("Employer memory candidate is no longer eligible for review.");
  const assignment = createObservationClusterAssignment({ sourceObservationId: observationId, employerClusterId, status: decision === "CONFIRM" ? "USER_CONFIRMED" : "REJECTED", confidence: 1, algorithm: MEMORY_REVIEW_ALGORITHM, algorithmVersion: "1.0.0", explanation: `User ${decision === "CONFIRM" ? "confirmed" : "rejected"} remembered employer "${candidate.displayLabel}". ${candidate.explanation}` }, decision === "REJECT" ? { generateId: () => `employer-memory-rejection:${JSON.stringify([vacancy.id, employerClusterId])}` } : {});
  try {
    if (decision === "CONFIRM" && effective) {
      if (!repository.supersedeEffectiveAssignment) throw new Error("Employer confirmation supersession is unavailable.");
      await repository.supersedeEffectiveAssignment(effective.id, assignment, assignment.evaluatedAt);
    } else await repository.save(assignment);
  } catch (error) {
    // Concurrent retries converge on the same explicit decision.
    if (decision === "REJECT") {
      const saved = await repository.findById(assignment.id);
      if (saved?.status === "REJECTED" && saved.employerClusterId === employerClusterId && saved.algorithm === MEMORY_REVIEW_ALGORITHM) return;
    } else {
      const saved = await repository.findEffectiveByObservationId(observationId);
      if (saved?.status === "USER_CONFIRMED" && saved.employerClusterId === employerClusterId && saved.algorithm === MEMORY_REVIEW_ALGORITHM) return;
    }
    throw error;
  }
}

/** A rejected memory must not return as the generic same-name confirmation prompt. */
export async function hasRejectedEmployerMemory(vacancy: CanonicalVacancy, name: string | null, deps: MemoryReviewDependencies): Promise<boolean> {
  if (!name || !deps.assignmentRepository) return false;
  for (const id of vacancy.sourceObservationIds) {
    for (const assignment of await deps.assignmentRepository.findByObservationId(id)) {
      if (assignment.status !== "REJECTED" || assignment.algorithm !== MEMORY_REVIEW_ALGORITHM) continue;
      const cluster = await deps.employerClusterRepository.findById(assignment.employerClusterId);
      if (cluster?.displayLabel && normalizeOrganizationEvidenceName(cluster.displayLabel) === normalizeOrganizationEvidenceName(name)) return true;
    }
  }
  return false;
}
