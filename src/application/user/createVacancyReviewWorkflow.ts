import { ApplicationDocumentError, type ApplicationDocumentLibrary, type ImportApplicationDocument } from "../../domain/user/ApplicationDocument.js";
import type { ActionRequest } from "../../domain/user/VacancyNextAction.js";
import { setVacancyPriority, addVacancyNote, setVacancyProcessState } from "./vacancyCrm.js";
import type { VacancyCrmRepository, VacancyPriority, VacancyProcessState } from "../../domain/user/VacancyCrm.js";
import { decideEmployerIdentity, searchEmployerIdentityCandidates } from "./employerIdentityReview.js";
import type { EmployerIdentityDecisionInput, EmployerIdentityDecisionStore } from "../../domain/user/EmployerIdentityReview.js";
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
  readonly contactLibrary?: import("./ContactLibrary.js").ContactLibrary;
  readonly documentLibrary?: ApplicationDocumentLibrary;
  readonly crmRepository?: VacancyCrmRepository;
  readonly employerIdentityDecisionStore?: EmployerIdentityDecisionStore;
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
    ...(dependencies.contactLibrary ? {contactLibrary:dependencies.contactLibrary}:{}),
    ...(dependencies.documentLibrary ? {documentLibrary:dependencies.documentLibrary} : {}),
    ...(dependencies.now ? {now:dependencies.now} : {}),
    ...(dependencies.crmRepository ? {crmRepository:dependencies.crmRepository} : {}),
    ...(dependencies.employerIdentityDecisionStore ? { employerIdentityDecisionStore: dependencies.employerIdentityDecisionStore } : {}),
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
  async function actionCommand(input: ActionRequest) {
    if(!dependencies.crmRepository) throw new Error("CRM is unavailable.");
    await dependencies.crmRepository.changeNextAction(input, dependencies.now?.() ?? new Date());
    return getVacancyReviewView(input.canonicalVacancyId,reviewDependencies);
  }
  function documentLibrary() {
    if(!dependencies.documentLibrary) throw new ApplicationDocumentError("Document library unavailable.",500);
    return dependencies.documentLibrary;
  }
  type ActionTarget = {canonicalVacancyId:string;actionId:string;requestId:string};
  return {
    getContacts: () => dependencies.contactLibrary?.list() ?? [],
    contactCommand: (input:unknown) => {
      if(!dependencies.contactLibrary) throw new Error("Contacts unavailable.");
      const resultId=dependencies.contactLibrary.execute(input);
      return {resultId,contacts:dependencies.contactLibrary.list()};
    },
    getApplicationDocuments: () => documentLibrary().list(),
    importLibraryDocument: (input:ImportApplicationDocument) => {documentLibrary().importVersion(input);return documentLibrary().list();},
    renameApplicationDocument: (input:{documentId:string;requestId:string;name:string}) => {documentLibrary().rename(input);return documentLibrary().list();},
    archiveApplicationDocument: (input:{documentId:string;requestId:string}) => {documentLibrary().archive(input);return documentLibrary().list();},
    restoreApplicationDocument: (input:{documentId:string;requestId:string}) => {documentLibrary().restore(input);return documentLibrary().list();},
    importApplicationDocument: async (input: {canonicalVacancyId:string;document:ImportApplicationDocument}) => {
      if(!dependencies.documentLibrary) throw new ApplicationDocumentError("Document library unavailable.",500);
      if(!await dependencies.canonicalVacancyRepository.findById(input.canonicalVacancyId)) throw new ApplicationDocumentError("Vacancy not found.",404);
      dependencies.documentLibrary.importVersion(input.document);
      return getVacancyReviewView(input.canonicalVacancyId,reviewDependencies);
    },
    associateVacancyDocument: async (input:{canonicalVacancyId:string;versionId:string;requestId:string}) => {
      if(!dependencies.documentLibrary) throw new ApplicationDocumentError("Document library unavailable.",500);
      dependencies.documentLibrary.associate(input);
      return getVacancyReviewView(input.canonicalVacancyId,reviewDependencies);
    },
    getApplicationDocumentContent: (versionId:string) => {
      if(!dependencies.documentLibrary) throw new ApplicationDocumentError("Document library unavailable.",500);
      return dependencies.documentLibrary.download(versionId);
    },
    createVacancyNextAction: (input:{canonicalVacancyId:string;requestId:string;description:string;dueAt:string|null;contactId?:string}) =>
      actionCommand({...input,actionId:input.requestId,kind:"CREATE"}),
    completeVacancyNextAction: (input:ActionTarget) => actionCommand({...input,kind:"COMPLETE"}),
    cancelVacancyNextAction: (input:ActionTarget) => actionCommand({...input,kind:"CANCEL"}),
    rescheduleVacancyNextAction: (input:ActionTarget & {dueAt:string|null}) => actionCommand({...input,kind:"RESCHEDULE"}),
    setVacancyActionReminder: (input:ActionTarget & {remindAt:string}) => actionCommand({...input,kind:"SET_REMINDER"}),
    dismissVacancyActionReminder: (input:ActionTarget & {reminderId:string}) => actionCommand({...input,kind:"DISMISS_REMINDER"}),
    setVacancyPriority: async (input: {canonicalVacancyId:string;priority:VacancyPriority}) => {
      if(!dependencies.crmRepository) throw new Error("CRM is unavailable.");
      await setVacancyPriority(input,{...dependencies,crmRepository:dependencies.crmRepository});
      return getVacancyReviewView(input.canonicalVacancyId,reviewDependencies);
    },
    addVacancyNote: async (input: {canonicalVacancyId:string;requestId:string;text:string}) => {
      if(!dependencies.crmRepository) throw new Error("CRM is unavailable.");
      await addVacancyNote(input,{...dependencies,crmRepository:dependencies.crmRepository});
      return getVacancyReviewView(input.canonicalVacancyId,reviewDependencies);
    },
    setVacancyProcessState: async (input: {canonicalVacancyId:string;requestId:string;state:VacancyProcessState}) => {
      if(!dependencies.crmRepository) throw new Error("CRM is unavailable.");
      await setVacancyProcessState(input,{...dependencies,crmRepository:dependencies.crmRepository});
      return getVacancyReviewView(input.canonicalVacancyId,reviewDependencies);
    },
    searchEmployerIdentities: async (input: { readonly canonicalVacancyId: string; readonly query: string }) => {
      if (!dependencies.organizationRoleDecisionRepository) throw Error("Employer identity review is unavailable.");
      return searchEmployerIdentityCandidates(input.canonicalVacancyId, input.query, {...dependencies, organizationRoleDecisionRepository:dependencies.organizationRoleDecisionRepository});
    },
    decideEmployerIdentity: async (input: EmployerIdentityDecisionInput) => {
      if (!dependencies.employerIdentityDecisionStore || !dependencies.organizationRoleDecisionRepository) throw Error("Employer identity review is unavailable.");
      await decideEmployerIdentity(input, {...dependencies, employerIdentityDecisionStore:dependencies.employerIdentityDecisionStore, organizationRoleDecisionRepository:dependencies.organizationRoleDecisionRepository});
      return getVacancyReviewView(input.canonicalVacancyId,reviewDependencies);
    },
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
    getVacancyInbox: (input?: { readonly limit?: number; readonly archived?: boolean }) => getVacancyInbox(input, reviewDependencies),
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
