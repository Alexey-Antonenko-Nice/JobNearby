import { decideVacancyOrganizationRole, type OrganizationRoleDecisionInput } from "./decideVacancyOrganizationRole.js";
import type { VacancyOrganizationRoleDecisionRepository } from "../../domain/organizations/VacancyOrganizationRoleDecision.js";
import { confirmVacancyRecruitingAgency, getRecruitingAgencyProjection } from "./recruitingAgencyReview.js";
import type { ConfirmedOrganizationRoleRepository } from "../../domain/organizations/ConfirmedOrganizationRole.js";
import { decideEmployerAlias } from "./employerAliasReview.js";
import type { EmployerAliasEvidenceRepository } from "../../domain/recognition/EmployerAliasEvidence.js";
import { decideNamedClientEmployer } from "./namedClientEmployerReview.js";
import type { EmployerReviewDecision } from "../../domain/user/EmployerReviewCandidate.js";
import type { EmployerRecognitionPersistence } from "../../domain/recognition/EmployerRecognitionPersistence.js";
import { decideEmployerMemoryReview } from "./employerMemoryReview.js";
import type { EmployerClusterRepository } from "../../domain/recognition/EmployerClusterRepository.js";
import type { SourceObservationRepository } from "../../domain/capture/SourceObservationRepository.js";
import type { UserVacancyInteractionRepository } from "../../domain/user/UserVacancyInteractionRepository.js";
import type { CanonicalVacancyId } from "../../domain/vacancies/CanonicalVacancy.js";
import type { CanonicalVacancyRepository } from "../../domain/vacancies/CanonicalVacancyRepository.js";
import type { EmployerMemoryPublicDataSource } from "./EmployerMemoryPublicDataSource.js";
import type { ObservationClusterAssignmentRepository } from "../../domain/recognition/ObservationClusterAssignmentRepository.js";
import { confirmVacancyEmployer } from "./confirmVacancyEmployer.js";
import { getUserVacancyHistory } from "./getUserVacancyHistory.js";
import { getVacancyReviewView } from "./getVacancyReviewView.js";
import { getVacancyInbox } from "./getVacancyInbox.js";
import {
  recordUserVacancyInteraction,
  type RecordUserVacancyInteractionDependencies,
  type RecordUserVacancyInteractionInput,
} from "./recordUserVacancyInteraction.js";

export interface VacancyReviewWorkflowDependencies {
  readonly organizationRoleDecisionRepository?: VacancyOrganizationRoleDecisionRepository;
  readonly agencyMemoryRepository?: ConfirmedOrganizationRoleRepository;
  readonly publicationCampaignContextSource?: import("./PublicationCampaignContextSource.js").PublicationCampaignContextSource;
  readonly aliasRepository?: EmployerAliasEvidenceRepository;
  readonly canonicalVacancyRepository: Pick<CanonicalVacancyRepository, "findAll" | "findById">;
  readonly sourceObservationRepository: Pick<SourceObservationRepository, "findById" | "findByIds" | "countCaptureOccurrences">;
  readonly interactionRepository: UserVacancyInteractionRepository;
  readonly employerClusterRepository: Pick<EmployerClusterRepository, "findById"> & Partial<Pick<EmployerClusterRepository, "findCandidates">>;
  readonly recognitionPersistence?: EmployerRecognitionPersistence;
  readonly employerClusterWriter?: EmployerClusterRepository;
  readonly employerMemoryPublicDataSource: EmployerMemoryPublicDataSource;
  readonly assignmentRepository?: ObservationClusterAssignmentRepository;
  readonly now?: RecordUserVacancyInteractionDependencies["now"];
  readonly generateId?: RecordUserVacancyInteractionDependencies["generateId"];
}

export function createVacancyReviewWorkflow(
  dependencies: VacancyReviewWorkflowDependencies,
) {
  const reviewDependencies = {
    ...(dependencies.organizationRoleDecisionRepository ? { organizationRoleDecisionRepository: dependencies.organizationRoleDecisionRepository } : {}),
    ...(dependencies.agencyMemoryRepository ? { agencyMemoryRepository: dependencies.agencyMemoryRepository } : {}),
    ...(dependencies.publicationCampaignContextSource ? { publicationCampaignContextSource: dependencies.publicationCampaignContextSource } : {}),
    ...(dependencies.aliasRepository ? { aliasRepository: dependencies.aliasRepository } : {}),
    canonicalVacancyRepository: dependencies.canonicalVacancyRepository,
    sourceObservationRepository: dependencies.sourceObservationRepository,
    interactionRepository: dependencies.interactionRepository,
    employerClusterRepository: dependencies.employerClusterRepository,
    employerMemoryPublicDataSource: dependencies.employerMemoryPublicDataSource,
    ...(dependencies.assignmentRepository === undefined ? {} : { assignmentRepository: dependencies.assignmentRepository }),
  };
  return {
    decideVacancyOrganizationRole: async (input: OrganizationRoleDecisionInput) => {
      if (!dependencies.organizationRoleDecisionRepository) throw new Error("Organization role review is unavailable.");
      await decideVacancyOrganizationRole(input, { ...dependencies, organizationRoleDecisionRepository: dependencies.organizationRoleDecisionRepository });
      return getVacancyReviewView(input.canonicalVacancyId, reviewDependencies);
    },
    confirmVacancyRecruitingAgency: async (input: { readonly canonicalVacancyId: string; readonly candidateId: string }) => {
      if (dependencies.organizationRoleDecisionRepository) throw new Error("Use the vacancy-specific organization role actions.");
      await confirmVacancyRecruitingAgency(input.canonicalVacancyId, input.candidateId, {
        canonicalVacancyRepository: dependencies.canonicalVacancyRepository,
        ...(dependencies.agencyMemoryRepository ? { agencyMemoryRepository: dependencies.agencyMemoryRepository } : {}),
        ...(dependencies.now ? { now: dependencies.now } : {}), ...(dependencies.generateId ? { generateId: dependencies.generateId } : {}),
      });
      return getVacancyReviewView(input.canonicalVacancyId, reviewDependencies);
    },
    decideEmployerReview: async (input: EmployerReviewDecision & { readonly canonicalVacancyId: string }) => {
      if (dependencies.organizationRoleDecisionRepository) throw new Error("Use the vacancy-specific organization role actions.");
      const vacancy = await dependencies.canonicalVacancyRepository.findById(input.canonicalVacancyId);
      if (!vacancy) throw new Error(`CanonicalVacancy "${input.canonicalVacancyId}" does not exist.`);
      if (input.type === "CONFIRMED_MEMORY") await decideEmployerMemoryReview(vacancy, input.employerClusterId, input.decision, reviewDependencies);
      else if (input.type === "ALIAS_SELECTION") await decideEmployerAlias(vacancy, input.candidateId, input.employerClusterId, input.decision, { ...reviewDependencies, ...(dependencies.recognitionPersistence ? { recognitionPersistence: dependencies.recognitionPersistence } : {}) });
      else await decideNamedClientEmployer((await getRecruitingAgencyProjection(vacancy, dependencies.agencyMemoryRepository)).vacancy, input.candidateId, input.decision, { ...reviewDependencies, ...(dependencies.recognitionPersistence ? { recognitionPersistence: dependencies.recognitionPersistence } : {}) });
      return getVacancyReviewView(input.canonicalVacancyId, reviewDependencies);
    },
    decideEmployerMemoryReview: async (input: { readonly canonicalVacancyId: string; readonly employerClusterId: string; readonly decision: "CONFIRM" | "REJECT" }) => {
      if (dependencies.organizationRoleDecisionRepository) throw new Error("Use the vacancy-specific organization role actions.");
      const vacancy = await dependencies.canonicalVacancyRepository.findById(input.canonicalVacancyId);
      if (!vacancy) throw new Error(`CanonicalVacancy "${input.canonicalVacancyId}" does not exist.`);
      await decideEmployerMemoryReview(vacancy, input.employerClusterId, input.decision, reviewDependencies);
      return getVacancyReviewView(input.canonicalVacancyId, reviewDependencies);
    },
    getVacancyInbox: (input?: { readonly limit?: number }) => getVacancyInbox(input, reviewDependencies),
    getVacancyReview: (canonicalVacancyId: CanonicalVacancyId) =>
      getVacancyReviewView(canonicalVacancyId, reviewDependencies),
    confirmVacancyEmployer: async (input: { readonly canonicalVacancyId: string; readonly candidateName: string }) => {
      if (dependencies.organizationRoleDecisionRepository) throw new Error("Use the vacancy-specific organization role actions.");
      if (dependencies.assignmentRepository === undefined || dependencies.employerClusterWriter === undefined) {
        throw new Error("Employer confirmation is unavailable.");
      }
      await confirmVacancyEmployer(input.canonicalVacancyId, input.candidateName, {
        ...(dependencies.agencyMemoryRepository ? { agencyMemoryRepository: dependencies.agencyMemoryRepository } : {}),
        ...(dependencies.aliasRepository ? { aliasRepository: dependencies.aliasRepository } : {}),
        canonicalVacancyRepository: dependencies.canonicalVacancyRepository,
        employerClusterRepository: dependencies.employerClusterWriter,
        assignmentRepository: dependencies.assignmentRepository,
        ...(dependencies.now === undefined ? {} : { now: dependencies.now }),
        ...(dependencies.generateId === undefined ? {} : { generateId: dependencies.generateId }),
      });
      return getVacancyReviewView(input.canonicalVacancyId, reviewDependencies);
    },
    recordVacancyReviewAction: async (input: RecordUserVacancyInteractionInput) => {
      const recorded = await recordUserVacancyInteraction(input, {
        canonicalVacancyRepository: dependencies.canonicalVacancyRepository,
        interactionRepository: dependencies.interactionRepository,
        ...(dependencies.now === undefined ? {} : { now: dependencies.now }),
        ...(dependencies.generateId === undefined ? {} : { generateId: dependencies.generateId }),
      });
      return {
        event: recorded.event,
        review: await getVacancyReviewView(input.canonicalVacancyId, reviewDependencies),
      };
    },
  };
}

export type VacancyReviewWorkflow = ReturnType<typeof createVacancyReviewWorkflow>;
