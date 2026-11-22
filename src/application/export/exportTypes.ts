import type { EmployerDisplayState } from "../../domain/user/EmployerDisplayState.js";
import type { ApplicationDocumentKind } from "../../domain/user/ApplicationDocument.js";
import type { ContactMethodType, VacancyContact } from "../../domain/user/Contact.js";
import type { UserVacancyInteractionType } from "../../domain/user/UserVacancyInteractionEvent.js";
import type { VacancyPriority, VacancyProcessState } from "../../domain/user/VacancyCrm.js";

export const EXPORT_FORMAT = "job-nearby-export" as const;
export const EXPORT_FORMAT_VERSION = 1 as const;

export type ExportFormatKind = "json" | "csv";

export type ExportEmployerConfirmationStatus =
  | "confirmed_for_vacancy"
  | "recognized_from_prior_knowledge"
  | "automatically_recognized_not_confirmed"
  | "unresolved";

export interface ExportVacancySource {
  readonly sourceType: "CAPTURED";
  readonly provider: string | null;
  readonly url: string | null;
  readonly externalId: string | null;
  readonly displayedCompanyName: string | null;
  readonly observedAt: string | null;
  readonly publishedAt: string | null;
}

export interface ExportVacancyCanonical {
  readonly title: string | null;
  readonly location: string | null;
  readonly workMode: string | null;
  readonly engagement: string | null;
  readonly compensation: string | null;
  readonly status: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ExportVacancyEmployerPresentation {
  readonly displayName: string | null;
  readonly displayState: EmployerDisplayState;
  readonly confirmationStatus: ExportEmployerConfirmationStatus;
}

export interface ExportVacancyNote {
  readonly id: string;
  readonly vacancyId: string;
  readonly text: string;
  readonly createdAt: string;
}

export interface ExportProcessTransition {
  readonly id: string;
  readonly vacancyId: string;
  readonly fromState: VacancyProcessState | null;
  readonly toState: VacancyProcessState;
  readonly createdAt: string;
}

export interface ExportInteraction {
  readonly id: string;
  readonly vacancyId: string;
  readonly type: UserVacancyInteractionType;
  readonly occurredAt: string;
  readonly recordedAt: string;
  readonly contactId: string | null;
  readonly contactDisplayName: string | null;
  readonly metadata: Readonly<Record<string, unknown>> | null;
}

export interface ExportReminder {
  readonly id: string;
  readonly actionId: string;
  readonly remindAt: string;
  readonly createdAt: string;
  readonly dismissedAt: string | null;
  readonly supersededAt: string | null;
  readonly status: "ACTIVE" | "DISMISSED" | "SUPERSEDED";
}

export interface ExportActionChange {
  readonly id: string;
  readonly kind: string;
  readonly createdAt: string;
  readonly dueAt: string | null;
  readonly remindAt: string | null;
  readonly reminderId: string | null;
}

export interface ExportAction {
  readonly id: string;
  readonly vacancyId: string;
  readonly description: string;
  readonly status: "ACTIVE" | "COMPLETED" | "CANCELLED";
  readonly createdAt: string;
  readonly dueAt: string | null;
  readonly completedAt: string | null;
  readonly cancelledAt: string | null;
  readonly contactId: string | null;
  readonly contactDisplayName: string | null;
  readonly reminders: readonly ExportReminder[];
  readonly changes: readonly ExportActionChange[];
}

export interface ExportVacancyContactLink {
  readonly id: string;
  readonly vacancyId: string;
  readonly contactId: string;
  readonly contactDisplayName: string;
  readonly role: VacancyContact["role"];
  readonly createdAt: string;
  readonly endedAt: string | null;
}

export interface ExportVacancyDocumentAssociation {
  readonly id: string;
  readonly vacancyId: string;
  readonly documentId: string;
  readonly documentName: string;
  readonly documentKind: ApplicationDocumentKind;
  readonly selectedVersionId: string;
  readonly versionNumber: number;
  readonly originalFileName: string;
  readonly createdAt: string;
  readonly current: boolean;
}

export interface ExportVacancyCrm {
  readonly priority: VacancyPriority;
  readonly processState: VacancyProcessState;
  readonly archived: boolean;
  readonly archivedAt: string | null;
}

export interface ExportVacancy {
  readonly id: string;
  readonly canonical: ExportVacancyCanonical;
  readonly source: ExportVacancySource;
  readonly employer: ExportVacancyEmployerPresentation;
  readonly crm: ExportVacancyCrm;
  readonly notes: readonly ExportVacancyNote[];
  readonly processHistory: readonly ExportProcessTransition[];
  readonly interactions: readonly ExportInteraction[];
  readonly actions: readonly ExportAction[];
  readonly contacts: readonly ExportVacancyContactLink[];
  readonly documentAssociations: readonly ExportVacancyDocumentAssociation[];
}

export interface ExportContactMethod {
  readonly id: string;
  readonly contactId: string;
  readonly type: ContactMethodType;
  readonly value: string;
  readonly label: string;
  readonly createdAt: string;
}

export interface ExportContact {
  readonly id: string;
  readonly displayName: string;
  readonly jobTitle: string;
  readonly notes: string;
  readonly archived: boolean;
  readonly archivedAt: string | null;
  readonly createdAt: string;
  readonly methods: readonly ExportContactMethod[];
}

export interface ExportDocumentVersion {
  readonly id: string;
  readonly documentId: string;
  readonly versionNumber: number;
  readonly originalFileName: string;
  readonly mediaType: string | null;
  readonly sizeBytes: number;
  readonly contentHash: string;
  readonly createdAt: string;
}

export interface ExportDocument {
  readonly id: string;
  readonly kind: ApplicationDocumentKind;
  readonly name: string;
  readonly archived: boolean;
  readonly archivedAt: string | null;
  readonly createdAt: string;
  readonly versions: readonly ExportDocumentVersion[];
}

export interface UserDataExportPayload {
  readonly format: typeof EXPORT_FORMAT;
  readonly formatVersion: typeof EXPORT_FORMAT_VERSION;
  readonly exportedAt: string;
  readonly vacancies: readonly ExportVacancy[];
  readonly contacts: readonly ExportContact[];
  readonly documents: readonly ExportDocument[];
}

export interface ExportCounts {
  readonly vacancies: number;
  readonly notes: number;
  readonly processTransitions: number;
  readonly interactions: number;
  readonly actions: number;
  readonly reminders: number;
  readonly contacts: number;
  readonly contactMethods: number;
  readonly vacancyContacts: number;
  readonly documents: number;
  readonly documentVersions: number;
  readonly documentAssociations: number;
}

export interface ExportUserDataResult {
  readonly format: ExportFormatKind;
  readonly formatVersion: typeof EXPORT_FORMAT_VERSION;
  readonly exportedAt: string;
  readonly destinationPath: string | null;
  readonly fileName: string;
  readonly mimeType: string;
  readonly counts: ExportCounts;
  readonly contentBytes?: Uint8Array;
}

export interface UserDataExportService {
  buildExportPayload(options?: { readonly includeArchived?: boolean }): UserDataExportPayload;
  exportUserData(input: {
    readonly format: ExportFormatKind;
    readonly destinationPath?: string;
    readonly includeArchived?: boolean;
  }): ExportUserDataResult;
}
