import { LocalBackupService } from "../backup/LocalBackupService.js";
import { LocalUserDataExportService } from "../export/LocalUserDataExportService.js";
import { resolveApplicationDataPaths } from "../storage/applicationDataPaths.js";
import { SqliteDailyWorkQueue } from "../persistence/SqliteDailyWorkQueue.js";
import { ContactLibrary } from "../../application/user/ContactLibrary.js";
import { SqliteContactRepository } from "../persistence/SqliteContactRepository.js";
import { ManagedApplicationDocumentLibrary } from "../../application/user/ApplicationDocumentLibrary.js";
import { SqliteApplicationDocumentRepository } from "../persistence/SqliteApplicationDocumentRepository.js";
import { LocalManagedDocumentStorage } from "../storage/LocalManagedDocumentStorage.js";
import { SqliteVacancyCrmRepository } from "../persistence/SqliteVacancyCrmRepository.js";
import { SqliteVacancyCleanup } from "../persistence/SqliteVacancyCleanup.js";
import { SqliteEmployerIdentityDecisionStore } from "../persistence/SqliteEmployerIdentityDecisionStore.js";
import { SqliteVacancyOrganizationRoleDecisionRepository } from "../persistence/SqliteVacancyOrganizationRoleDecisionRepository.js";
import { SqliteConfirmedOrganizationRoleRepository } from "../persistence/SqliteConfirmedOrganizationRoleRepository.js";
import { SqlitePublicationCampaignContextSource } from "../persistence/SqlitePublicationCampaignContextSource.js";
import { SqliteEmployerAliasEvidenceRepository } from "../persistence/SqliteEmployerAliasEvidenceRepository.js";
import { SqliteEmployerRecognitionPersistence } from "../persistence/SqliteEmployerRecognitionPersistence.js";
import { createDatabase } from "../database/createDatabase.js";
import { createCaptureProcessingRuntime } from "../runtime/createCaptureProcessingRuntime.js";
import { createVacancyReviewWorkflow } from "../../application/user/createVacancyReviewWorkflow.js";
import { SqliteCanonicalVacancyRepository } from "../persistence/SqliteCanonicalVacancyRepository.js";
import { SqliteSourceObservationRepository } from "../persistence/SqliteSourceObservationRepository.js";
import { SqliteEmployerClusterRepository } from "../persistence/SqliteEmployerClusterRepository.js";
import { SqliteEmployerMemoryPublicDataSource } from "../persistence/SqliteEmployerMemoryPublicDataSource.js";
import { SqliteUserVacancyInteractionRepository } from "../persistence/SqliteUserVacancyInteractionRepository.js";
import { SqliteObservationClusterAssignmentRepository } from "../persistence/SqliteObservationClusterAssignmentRepository.js";
import { createBrowserCaptureServer } from "./createBrowserCaptureServer.js";

const host = "127.0.0.1";
const port = 4317;
const dataPaths = resolveApplicationDataPaths();

function openState(databasePath: string, documentDataDir: string) {
  const database = createDatabase(databasePath);
  const runtime = createCaptureProcessingRuntime(database, {
    onProcessingFailure: (sourceObservationId, error) => {
      console.error(`Vacancy processing failed for SourceObservation "${sourceObservationId}".`, error);
    },
  });
  const reviewWorkflow = createVacancyReviewWorkflow({
    contactLibrary: new ContactLibrary(new SqliteContactRepository(database)),
    documentLibrary: new ManagedApplicationDocumentLibrary(
      new SqliteApplicationDocumentRepository(database),
      new LocalManagedDocumentStorage(documentDataDir),
    ),
    crmRepository: new SqliteVacancyCrmRepository(database),
    employerIdentityDecisionStore: new SqliteEmployerIdentityDecisionStore(database),
    organizationRoleDecisionRepository: new SqliteVacancyOrganizationRoleDecisionRepository(database),
    agencyMemoryRepository: new SqliteConfirmedOrganizationRoleRepository(database),
    publicationCampaignContextSource: new SqlitePublicationCampaignContextSource(database),
    aliasRepository: new SqliteEmployerAliasEvidenceRepository(database),
    canonicalVacancyRepository: new SqliteCanonicalVacancyRepository(database),
    sourceObservationRepository: new SqliteSourceObservationRepository(database),
    interactionRepository: new SqliteUserVacancyInteractionRepository(database),
    employerClusterRepository: new SqliteEmployerClusterRepository(database),
    recognitionPersistence: new SqliteEmployerRecognitionPersistence(database),
    employerClusterWriter: new SqliteEmployerClusterRepository(database),
    employerMemoryPublicDataSource: new SqliteEmployerMemoryPublicDataSource(database),
    assignmentRepository: new SqliteObservationClusterAssignmentRepository(database),
  });
  const dailyQueue = new SqliteDailyWorkQueue(database);
  const vacancyCleanup = new SqliteVacancyCleanup(database);
  return { database, runtime, reviewWorkflow, dailyQueue, vacancyCleanup };
}

let state = openState(dataPaths.databasePath, dataPaths.documentDataDir);

const backupService = new LocalBackupService({
  getDatabase: () => state.database,
  databasePath: dataPaths.databasePath,
  documentDataDir: dataPaths.documentDataDir,
  defaultBackupDir: dataPaths.defaultBackupDir,
  beforeSwap: () => {
    state.database.close();
  },
  afterSwap: () => {
    state = openState(dataPaths.databasePath, dataPaths.documentDataDir);
  },
});

const exportService = new LocalUserDataExportService({
  getDatabase: () => state.database,
  documentDataDir: dataPaths.documentDataDir,
});

const server = createBrowserCaptureServer({
  backupService,
  exportService,
  getDailyWorkQueue: timeZone => state.dailyQueue.get({ now: new Date(), timeZone }),
  getContacts: () => state.reviewWorkflow.getContacts(),
  contactCommand: input => state.reviewWorkflow.contactCommand(input),
  getApplicationDocuments: () => state.reviewWorkflow.getApplicationDocuments(),
  importLibraryDocument: input => state.reviewWorkflow.importLibraryDocument(input),
  renameApplicationDocument: input => state.reviewWorkflow.renameApplicationDocument(input),
  archiveApplicationDocument: input => state.reviewWorkflow.archiveApplicationDocument(input),
  restoreApplicationDocument: input => state.reviewWorkflow.restoreApplicationDocument(input),

  importApplicationDocument: input => state.reviewWorkflow.importApplicationDocument(input),
  associateVacancyDocument: input => state.reviewWorkflow.associateVacancyDocument(input),
  getApplicationDocumentContent: id => state.reviewWorkflow.getApplicationDocumentContent(id),
  createVacancyNextAction: input => state.reviewWorkflow.createVacancyNextAction(input),
  completeVacancyNextAction: input => state.reviewWorkflow.completeVacancyNextAction(input),
  cancelVacancyNextAction: input => state.reviewWorkflow.cancelVacancyNextAction(input),
  rescheduleVacancyNextAction: input => state.reviewWorkflow.rescheduleVacancyNextAction(input),
  setVacancyActionReminder: input => state.reviewWorkflow.setVacancyActionReminder(input),
  dismissVacancyActionReminder: input => state.reviewWorkflow.dismissVacancyActionReminder(input),
  setVacancyPriority: input => state.reviewWorkflow.setVacancyPriority(input),
  addVacancyNote: input => state.reviewWorkflow.addVacancyNote(input),
  setVacancyProcessState: input => state.reviewWorkflow.setVacancyProcessState(input),
  vacancyCleanup: {
    state: id => state.vacancyCleanup.state(id),
    preview: (id, observationId) => state.vacancyCleanup.preview(id, observationId),
    setArchived: (id, archived, token) => state.vacancyCleanup.setArchived(id, archived, token),
    delete: input => state.vacancyCleanup.delete(input),
  },
  decideEmployerIdentity: input => state.reviewWorkflow.decideEmployerIdentity(input),
  searchEmployerIdentities: input => state.reviewWorkflow.searchEmployerIdentities(input),
  decideVacancyOrganizationRole: input => state.reviewWorkflow.decideVacancyOrganizationRole(input),
  captureAndProcessBrowserVacancy: payload => state.runtime.captureAndProcessBrowserVacancy(payload),
  getVacancyInbox: options => state.reviewWorkflow.getVacancyInbox(options),
  getVacancyReview: id => state.reviewWorkflow.getVacancyReview(id),
  recordVacancyReviewAction: input => state.reviewWorkflow.recordVacancyReviewAction(input),
  confirmVacancyRecruitingAgency: input => state.reviewWorkflow.confirmVacancyRecruitingAgency(input),
  confirmVacancyEmployer: input => state.reviewWorkflow.confirmVacancyEmployer(input),
  decideEmployerReview: input => state.reviewWorkflow.decideEmployerReview(input),
  decideEmployerMemoryReview: input => state.reviewWorkflow.decideEmployerMemoryReview(input),
});

server.listen(port, host, () => {
  process.stdout.write(`Job Nearby browser capture listening at http://${host}:${port}\n`);
});

function close(): void {
  server.close(() => {
    state.database.close();
    process.exit(0);
  });
}

process.on("SIGINT", close);
process.on("SIGTERM", close);
