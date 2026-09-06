import { hasRejectedEmployerMemory, getEmployerMemoryReviewCandidates } from "./employerMemoryReview.js";
import { createEmployerCluster } from "../recognition/createEmployerCluster.js";
import { createObservationClusterAssignment } from "../recognition/createObservationClusterAssignment.js";
import type { EmployerClusterRepository } from "../../domain/recognition/EmployerClusterRepository.js";
import type { ObservationClusterAssignmentRepository } from "../../domain/recognition/ObservationClusterAssignmentRepository.js";
import type { CanonicalVacancyRepository } from "../../domain/vacancies/CanonicalVacancyRepository.js";
import { employerConfirmationCandidate } from "./employerConfirmation.js";
import { effectiveEmployerClusterId } from "./effectiveEmployerClusterId.js";

export async function confirmVacancyEmployer(
  canonicalVacancyId: string,
  candidateName: string,
  dependencies: {
    readonly canonicalVacancyRepository: Pick<CanonicalVacancyRepository, "findById">;
    readonly employerClusterRepository: EmployerClusterRepository;
    readonly assignmentRepository: ObservationClusterAssignmentRepository;
    readonly now?: () => Date;
    readonly generateId?: () => string;
  },
): Promise<void> {
  const vacancy = await dependencies.canonicalVacancyRepository.findById(canonicalVacancyId);
  if (vacancy === null) throw new Error(`CanonicalVacancy "${canonicalVacancyId}" does not exist.`);
  if ((await getEmployerMemoryReviewCandidates(vacancy, dependencies)).length > 0) throw new Error("Employer memory candidate must be reviewed before direct confirmation.");
  const candidate = employerConfirmationCandidate(vacancy.organizationRelationships);
  if (await hasRejectedEmployerMemory(vacancy, candidate, dependencies)) throw new Error("Employer candidate was rejected in employer memory review.");
  if (candidate === null || candidate !== candidateName.trim()) {
    throw new Error("Employer candidate is no longer eligible for confirmation.");
  }
  const observationId = vacancy.sourceObservationIds.at(-1);
  if (observationId === undefined) throw new Error("Canonical vacancy has no source observation.");
  const existing = await dependencies.assignmentRepository.findEffectiveByObservationId(observationId);
  const currentCluster = existing === null
    ? null
    : await dependencies.employerClusterRepository.findById(existing.employerClusterId);
  if (existing?.status === "USER_CONFIRMED") {
    if (currentCluster?.displayLabel === candidate) return;
    throw new Error("Employer confirmation conflicts with the current employer assignment.");
  }
  if (currentCluster?.status === "RESOLVED" || currentCluster?.status === "CONFLICTED") {
    throw new Error("Employer confirmation conflicts with the current employer state.");
  }
  const currentNamedCluster = currentCluster?.status === "PROBABLY_RESOLVED" && usableName(currentCluster.displayLabel);
  if (typeof currentNamedCluster === "string" && currentNamedCluster !== candidate) {
    throw new Error("Employer confirmation conflicts with the current employer identity.");
  }
  if (currentCluster?.status === "UNRESOLVED" && usableName(currentCluster.displayLabel) !== undefined) {
    throw new Error("Employer confirmation conflicts with the current employer identity.");
  }
  const cluster = currentNamedCluster === candidate
    ? currentCluster!
    : createEmployerCluster({ status: "PROBABLY_RESOLVED", displayLabel: candidate }, {
      ...(dependencies.now === undefined ? {} : { now: dependencies.now }),
      ...(dependencies.generateId === undefined ? {} : { generateId: dependencies.generateId }),
    });
  if (cluster !== currentCluster) await dependencies.employerClusterRepository.save(cluster);
  const replacement = createObservationClusterAssignment({
    sourceObservationId: observationId,
    employerClusterId: cluster.id,
    confidence: 1,
    status: "USER_CONFIRMED",
    algorithm: "user-employer-confirmation",
    algorithmVersion: "1.0.0",
    explanation: `User confirmed displayed company "${candidate}" as the employer.`,
  }, {
    ...(dependencies.now === undefined ? {} : { now: dependencies.now }),
    ...(dependencies.generateId === undefined ? {} : { generateId: dependencies.generateId }),
  });
  if (existing === null) {
    await dependencies.assignmentRepository.save(replacement);
  } else {
    if (dependencies.assignmentRepository.supersedeEffectiveAssignment === undefined) {
      throw new Error("Employer confirmation supersession is unavailable.");
    }
    await dependencies.assignmentRepository.supersedeEffectiveAssignment(existing.id, replacement, dependencies.now?.() ?? new Date());
  }
}

function usableName(value: string | undefined): string | undefined {
  if (value === undefined || /^(?:unknown\s+employer)(?:\s*[—-].*)?$/iu.test(value.trim())) return undefined;
  return value.trim().length === 0 ? undefined : value.trim();
}
