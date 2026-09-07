import { createVacancyReviewWorkflow } from "../../src/application/user/createVacancyReviewWorkflow.js";
import { createObservationClusterAssignment } from "../../src/application/recognition/createObservationClusterAssignment.js";
import { InMemoryEmployerClusterRepository } from "../../src/infrastructure/persistence/InMemoryEmployerClusterRepository.js";
import { InMemoryObservationClusterAssignmentRepository } from "../../src/infrastructure/persistence/InMemoryObservationClusterAssignmentRepository.js";
import { InMemoryEmployerRecognitionPersistence } from "../../src/infrastructure/persistence/InMemoryEmployerRecognitionPersistence.js";
import { InMemoryUserVacancyInteractionRepository } from "../../src/infrastructure/persistence/InMemoryUserVacancyInteractionRepository.js";
import type { CanonicalVacancy, VacancyOrganizationRole } from "../../src/domain/vacancies/CanonicalVacancy.js";
import type { EmployerClusterStatus } from "../../src/domain/recognition/EmployerCluster.js";
import { heuftVacancy } from "../vacancies/CanonicalVacancyRepository.contract.js";

export const reviewDate = new Date("2026-09-07T00:00:00Z");
export function namedClientVacancy(): CanonicalVacancy {
  const base = heuftVacancy();
  const organizations: { role: VacancyOrganizationRole; rawName: string }[] = [
    { role: "DISPLAYED_COMPANY", rawName: "ACTUA SAVERNE" },
    { role: "RECRUITER", rawName: "ACTUA Saverne" },
    { role: "CLIENT", rawName: "HEUFT France" },
  ];
  return { ...base, id: "actua-heuft", sourceObservationIds: ["current"],
    evidenceReferences: [...base.evidenceReferences.map((e) => ({ ...e, sourceObservationId: "current" })), ...organizations.map((r) => ({ id: `org-${r.role}`, kind: "ORGANIZATION_EVIDENCE", sourceObservationId: "current" }))],
    organizationRelationships: organizations.map((r) => ({ ...r, confidence: 0.98, supportingEvidenceIds: [`org-${r.role}`], derivation: base.derivation })),
  };
}

export async function namedClientFixture(vacancy = namedClientVacancy()) {
  const clusters = new InMemoryEmployerClusterRepository();
  const assignments = new InMemoryObservationClusterAssignmentRepository();
  const persistence = new InMemoryEmployerRecognitionPersistence(clusters, assignments);
  await clusters.save({ id: "anonymous", status: "UNRESOLVED", displayLabel: "Unknown employer", createdAt: reviewDate, updatedAt: reviewDate });
  const accepted = createObservationClusterAssignment({ sourceObservationId: "current", employerClusterId: "anonymous", status: "ACCEPTED", confidence: 1, algorithm: "new-employer-cluster", algorithmVersion: "1" });
  await assignments.save(accepted);
  const deps = { canonicalVacancyRepository: { findById: async () => vacancy, findAll: async () => [vacancy] }, sourceObservationRepository: { findById: async (id: string) => ({ id, source: { sourceType: "JOB_BOARD" as const, sourceName: "Indeed" }, observedAt: reviewDate, metadata: {} }) }, employerClusterRepository: clusters, employerClusterWriter: clusters, assignmentRepository: assignments, recognitionPersistence: persistence, employerMemoryPublicDataSource: { findByEmployerClusterId: async () => [] }, interactionRepository: new InMemoryUserVacancyInteractionRepository() };
  const workflow = createVacancyReviewWorkflow(deps);
  const candidate = async () => (await workflow.getVacancyReview(vacancy.id)).employerReview?.candidates.find((c) => c.type === "NAMED_CLIENT");
  async function addHistory(id = "heuft", status: EmployerClusterStatus = "PROBABLY_RESOLVED", name = "HEUFT France") {
    await clusters.save({ id, displayLabel: name, status, ...(status === "RESOLVED" ? { resolvedEmployerId: "existing-legal-id" } : {}), createdAt: reviewDate, updatedAt: reviewDate });
    await assignments.save(createObservationClusterAssignment({ sourceObservationId: `prior-${id}`, employerClusterId: id, status: "USER_CONFIRMED", confidence: 1, algorithm: "user-employer-confirmation", algorithmVersion: "1" }));
  }
  return { vacancy, clusters, assignments, persistence, deps, workflow, accepted, candidate, addHistory };
}
