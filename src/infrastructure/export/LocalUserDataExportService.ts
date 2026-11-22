import { closeSync, fsyncSync, mkdirSync, mkdtempSync, openSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type Database from "better-sqlite3";

import {
  EXPORT_FORMAT,
  EXPORT_FORMAT_VERSION,
  type ExportAction,
  type ExportContact,
  type ExportCounts,
  type ExportDocument,
  type ExportEmployerConfirmationStatus,
  type ExportInteraction,
  type ExportProcessTransition,
  type ExportReminder,
  type ExportUserDataResult,
  type ExportVacancy,
  type ExportVacancyContactLink,
  type ExportVacancyDocumentAssociation,
  type ExportVacancyNote,
  type UserDataExportPayload,
  type UserDataExportService,
} from "../../application/export/exportTypes.js";
import type { ApplicationDocumentKind } from "../../domain/user/ApplicationDocument.js";
import type { ContactMethodType, VacancyContact } from "../../domain/user/Contact.js";
import type { EmployerDisplayState } from "../../domain/user/EmployerDisplayState.js";
import type { UserVacancyInteractionType } from "../../domain/user/UserVacancyInteractionEvent.js";
import type { VacancyPriority, VacancyProcessState } from "../../domain/user/VacancyCrm.js";
import { createZipArchive } from "../backup/zipArchive.js";
import { readNextActions } from "../persistence/sqliteVacancyNextActions.js";
import { assertSafeBackupDestination } from "../storage/applicationDataPaths.js";
import { serializeCsv, type CsvCell } from "./csvSerializer.js";

export interface LocalUserDataExportServiceConfig {
  readonly getDatabase: () => Database.Database;
  readonly documentDataDir: string;
  readonly temporaryRoot?: string;
  readonly now?: () => Date;
  readonly onBeforeWriteDestination?: () => void;
}

export class ExportError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 500 = 400,
  ) {
    super(message);
  }
}

function writeFileAtomically(targetPath: string, bytes: Uint8Array): void {
  const targetDir = dirname(targetPath);
  mkdirSync(targetDir, { recursive: true, mode: 0o700 });
  const stageDir = mkdtempSync(join(targetDir, ".export-stage-"));
  const stagedFile = join(stageDir, "payload.tmp");
  try {
    const fd = openSync(stagedFile, "wx", 0o600);
    try {
      writeFileSync(fd, bytes);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(stagedFile, targetPath);
  } finally {
    rmSync(stageDir, { recursive: true, force: true });
  }
}

function toIsoUtc(value: string | Date | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
}

function sanitizePublicSourceUrl(rawUrl: string | null): string | null {
  if (!rawUrl) return null;
  try {
    const parsed = new URL(rawUrl);
    if (parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost") {
      return null;
    }
    return rawUrl;
  } catch {
    return rawUrl;
  }
}

function parseFieldValue(fieldName: string, valueJson: string | null): string | null {
  if (!valueJson) return null;
  try {
    const parsed = JSON.parse(valueJson) as Record<string, unknown>;
    if (fieldName === "role") {
      return typeof parsed.title === "string" ? parsed.title : null;
    }
    if (fieldName === "location") {
      if (typeof parsed.label === "string" && parsed.label.trim()) return parsed.label;
      const parts = [parsed.city, parsed.region, parsed.country].filter(
        (p): p is string => typeof p === "string" && p.trim().length > 0,
      );
      return parts.length > 0 ? parts.join(", ") : null;
    }
    if (fieldName === "workMode") {
      return typeof parsed.mode === "string" ? parsed.mode : typeof parsed === "string" ? parsed : null;
    }
    if (fieldName === "engagement") {
      if (typeof parsed.contractType === "string") return parsed.contractType;
      if (typeof parsed.label === "string") return parsed.label;
      return JSON.stringify(parsed);
    }
    if (fieldName === "compensation") {
      if (typeof parsed.rawText === "string" && parsed.rawText.trim()) return parsed.rawText;
      if (parsed.minAmount !== undefined || parsed.maxAmount !== undefined) {
        const min = parsed.minAmount ?? "";
        const max = parsed.maxAmount ?? "";
        const cur = typeof parsed.currency === "string" ? ` ${parsed.currency}` : "";
        return `${min}${max && max !== min ? `-${max}` : ""}${cur}`.trim() || null;
      }
      return null;
    }
    return typeof parsed === "string" ? parsed : JSON.stringify(parsed);
  } catch {
    return null;
  }
}

function validateExportPayload(payload: UserDataExportPayload): void {
  if (payload.format !== EXPORT_FORMAT || payload.formatVersion !== EXPORT_FORMAT_VERSION) {
    throw new ExportError("Invalid export format metadata.", 500);
  }
  if (Number.isNaN(Date.parse(payload.exportedAt))) {
    throw new ExportError("Invalid export timestamp.", 500);
  }
  if (!Array.isArray(payload.vacancies) || !Array.isArray(payload.contacts) || !Array.isArray(payload.documents)) {
    throw new ExportError("Export payload collections must be arrays.", 500);
  }
}

export class LocalUserDataExportService implements UserDataExportService {
  private readonly temporaryRoot: string;
  private readonly now: () => Date;

  constructor(private readonly config: LocalUserDataExportServiceConfig) {
    this.temporaryRoot = resolve(config.temporaryRoot ?? tmpdir());
    this.now = config.now ?? (() => new Date());
  }

  buildExportPayload(options: { readonly includeArchived?: boolean } = {}): UserDataExportPayload {
    const includeArchived = options.includeArchived ?? true;
    const db = this.config.getDatabase();
    const exportedAt = this.now().toISOString();

    return db
      .transaction(() => {
        const vacancyRows = db
          .prepare(
            `SELECT v.id, v.canonicalization_status, v.created_at, v.updated_at, c.archived_at
             FROM canonical_vacancies v
             LEFT JOIN vacancy_cleanup_state c ON c.canonical_vacancy_id = v.id
             ORDER BY v.created_at ASC, v.id ASC`,
          )
          .all() as {
          id: string;
          canonicalization_status: string;
          created_at: string;
          updated_at: string;
          archived_at: string | null;
        }[];

        const filteredVacancyRows = includeArchived
          ? vacancyRows
          : vacancyRows.filter((v) => v.archived_at === null);

        // Preload canonical fields
        const fieldRows = db
          .prepare(
            `SELECT canonical_vacancy_id, field_name, value_json
             FROM canonical_vacancy_fields
             WHERE field_name IN ('role', 'location', 'workMode', 'engagement', 'compensation')`,
          )
          .all() as { canonical_vacancy_id: string; field_name: string; value_json: string | null }[];
        const fieldsByVacancy = new Map<string, Map<string, string | null>>();
        for (const row of fieldRows) {
          let map = fieldsByVacancy.get(row.canonical_vacancy_id);
          if (!map) {
            map = new Map();
            fieldsByVacancy.set(row.canonical_vacancy_id, map);
          }
          map.set(row.field_name, parseFieldValue(row.field_name, row.value_json));
        }

        // Preload latest source observation per vacancy
        const obsRows = db
          .prepare(
            `SELECT l.canonical_vacancy_id, o.source_name, o.source_url, o.external_id,
                    o.displayed_company_name, o.observed_at, o.published_at
             FROM canonical_vacancy_source_observations l
             JOIN source_observations o ON o.id = l.source_observation_id
             ORDER BY l.canonical_vacancy_id, l.observation_order DESC, o.observed_at DESC`,
          )
          .all() as {
          canonical_vacancy_id: string;
          source_name: string | null;
          source_url: string | null;
          external_id: string | null;
          displayed_company_name: string | null;
          observed_at: string | null;
          published_at: string | null;
        }[];
        const latestObsByVacancy = new Map<string, (typeof obsRows)[number]>();
        for (const row of obsRows) {
          if (!latestObsByVacancy.has(row.canonical_vacancy_id)) {
            latestObsByVacancy.set(row.canonical_vacancy_id, row);
          }
        }

        // Preload employer presentation (human role decisions -> cluster assignment -> org relationships)
        const roleDecisionRows = db
          .prepare(
            `SELECT canonical_vacancy_id, role, organization_name
             FROM vacancy_organization_role_decisions
             ORDER BY rowid ASC`,
          )
          .all() as { canonical_vacancy_id: string; role: string; organization_name: string | null }[];
        const humanEmployerByVacancy = new Map<string, string>();
        for (const row of roleDecisionRows) {
          if (row.role === "EMPLOYER" && row.organization_name) {
            humanEmployerByVacancy.set(row.canonical_vacancy_id, row.organization_name);
          } else if (row.role !== "EMPLOYER") {
            // Latest decision for that identity might override
          }
        }

        const clusterRows = db
          .prepare(
            `SELECT l.canonical_vacancy_id, ec.display_label, ec.status
             FROM canonical_vacancy_source_observations l
             JOIN observation_cluster_assignments oca ON oca.source_observation_id = l.source_observation_id
             JOIN employer_clusters ec ON ec.id = oca.employer_cluster_id
             ORDER BY oca.rowid DESC`,
          )
          .all() as { canonical_vacancy_id: string; display_label: string | null; status: string }[];
        const clusterByVacancy = new Map<string, { displayLabel: string | null; status: string }>();
        for (const row of clusterRows) {
          if (!clusterByVacancy.has(row.canonical_vacancy_id)) {
            clusterByVacancy.set(row.canonical_vacancy_id, {
              displayLabel: row.display_label,
              status: row.status,
            });
          }
        }

        // Preload CRM priority & process state
        const priorityRows = db
          .prepare("SELECT canonical_vacancy_id, priority FROM vacancy_crm_priority")
          .all() as { canonical_vacancy_id: string; priority: VacancyPriority }[];
        const priorityByVacancy = new Map(priorityRows.map((r) => [r.canonical_vacancy_id, r.priority]));

        const processStateRows = db
          .prepare("SELECT canonical_vacancy_id, state FROM vacancy_crm_process_state")
          .all() as { canonical_vacancy_id: string; state: VacancyProcessState }[];
        const processStateByVacancy = new Map(processStateRows.map((r) => [r.canonical_vacancy_id, r.state]));

        const noteRows = db
          .prepare(
            "SELECT id, canonical_vacancy_id, text, created_at FROM vacancy_notes ORDER BY created_at ASC, id ASC",
          )
          .all() as { id: string; canonical_vacancy_id: string; text: string; created_at: string }[];
        const notesByVacancy = new Map<string, ExportVacancyNote[]>();
        for (const row of noteRows) {
          const list = notesByVacancy.get(row.canonical_vacancy_id) ?? [];
          list.push({
            id: row.id,
            vacancyId: row.canonical_vacancy_id,
            text: row.text,
            createdAt: toIsoUtc(row.created_at)!,
          });
          notesByVacancy.set(row.canonical_vacancy_id, list);
        }

        const transitionRows = db
          .prepare(
            "SELECT id, canonical_vacancy_id, from_state, to_state, created_at FROM vacancy_process_transitions ORDER BY created_at ASC, id ASC",
          )
          .all() as {
          id: string;
          canonical_vacancy_id: string;
          from_state: VacancyProcessState | null;
          to_state: VacancyProcessState;
          created_at: string;
        }[];
        const transitionsByVacancy = new Map<string, ExportProcessTransition[]>();
        for (const row of transitionRows) {
          const list = transitionsByVacancy.get(row.canonical_vacancy_id) ?? [];
          list.push({
            id: row.id,
            vacancyId: row.canonical_vacancy_id,
            fromState: row.from_state,
            toState: row.to_state,
            createdAt: toIsoUtc(row.created_at)!,
          });
          transitionsByVacancy.set(row.canonical_vacancy_id, list);
        }

        // Preload interactions
        const interactionRows = db
          .prepare(
            `SELECT e.id, e.canonical_vacancy_id, e.event_type, e.occurred_at, e.recorded_at, e.metadata_json,
                    r.contact_id, c.display_name AS contact_display_name
             FROM user_vacancy_interaction_events e
             LEFT JOIN interaction_contact_references r ON r.event_id = e.id
             LEFT JOIN contacts c ON c.id = r.contact_id
             ORDER BY e.occurred_at ASC, e.recorded_at ASC, e.id ASC`,
          )
          .all() as {
          id: string;
          canonical_vacancy_id: string;
          event_type: UserVacancyInteractionType;
          occurred_at: string;
          recorded_at: string;
          metadata_json: string | null;
          contact_id: string | null;
          contact_display_name: string | null;
        }[];
        const interactionsByVacancy = new Map<string, ExportInteraction[]>();
        for (const row of interactionRows) {
          const list = interactionsByVacancy.get(row.canonical_vacancy_id) ?? [];
          list.push({
            id: row.id,
            vacancyId: row.canonical_vacancy_id,
            type: row.event_type,
            occurredAt: toIsoUtc(row.occurred_at)!,
            recordedAt: toIsoUtc(row.recorded_at)!,
            contactId: row.contact_id,
            contactDisplayName: row.contact_display_name,
            metadata: row.metadata_json ? (JSON.parse(row.metadata_json) as Record<string, unknown>) : null,
          });
          interactionsByVacancy.set(row.canonical_vacancy_id, list);
        }

        // Preload actions & reminders via readNextActions
        const allActions = readNextActions(db);
        const actionsByVacancy = new Map<string, ExportAction[]>();
        for (const action of allActions) {
          const status: ExportAction["status"] = action.completedAt
            ? "COMPLETED"
            : action.cancelledAt
              ? "CANCELLED"
              : "ACTIVE";
          const reminders: ExportReminder[] = action.reminders.map((r) => ({
            id: r.id,
            actionId: r.actionId,
            remindAt: r.remindAt.toISOString(),
            createdAt: r.createdAt.toISOString(),
            dismissedAt: r.dismissedAt ? r.dismissedAt.toISOString() : null,
            supersededAt: r.supersededAt ? r.supersededAt.toISOString() : null,
            status: r.dismissedAt ? "DISMISSED" : r.supersededAt ? "SUPERSEDED" : "ACTIVE",
          }));
          const changes = action.changes.map((c) => ({
            id: c.id,
            kind: c.kind,
            createdAt: c.createdAt.toISOString(),
            dueAt: c.dueAt ? c.dueAt.toISOString() : null,
            remindAt: c.remindAt ? c.remindAt.toISOString() : null,
            reminderId: c.reminderId,
          }));
          const list = actionsByVacancy.get(action.canonicalVacancyId) ?? [];
          list.push({
            id: action.id,
            vacancyId: action.canonicalVacancyId,
            description: action.description,
            status,
            createdAt: action.createdAt.toISOString(),
            dueAt: action.dueAt ? action.dueAt.toISOString() : null,
            completedAt: action.completedAt ? action.completedAt.toISOString() : null,
            cancelledAt: action.cancelledAt ? action.cancelledAt.toISOString() : null,
            contactId: action.contactId ?? null,
            contactDisplayName: action.contact?.displayName ?? null,
            reminders,
            changes,
          });
          actionsByVacancy.set(action.canonicalVacancyId, list);
        }
        for (const list of actionsByVacancy.values()) {
          list.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
        }

        // Preload contacts & methods
        const contactRows = db
          .prepare(
            "SELECT id, display_name, job_title, notes, created_at, archived_at FROM contacts ORDER BY created_at ASC, id ASC",
          )
          .all() as {
          id: string;
          display_name: string;
          job_title: string;
          notes: string;
          created_at: string;
          archived_at: string | null;
        }[];
        const filteredContacts = includeArchived
          ? contactRows
          : contactRows.filter((c) => c.archived_at === null);

        const methodRows = db
          .prepare(
            "SELECT id, contact_id, type, value, label, created_at FROM contact_methods ORDER BY created_at ASC, id ASC",
          )
          .all() as {
          id: string;
          contact_id: string;
          type: ContactMethodType;
          value: string;
          label: string;
          created_at: string;
        }[];
        const methodsByContact = new Map<string, ExportContact["methods"][number][]>();
        for (const row of methodRows) {
          const list = methodsByContact.get(row.contact_id) ?? [];
          list.push({
            id: row.id,
            contactId: row.contact_id,
            type: row.type,
            value: row.value,
            label: row.label,
            createdAt: toIsoUtc(row.created_at)!,
          });
          methodsByContact.set(row.contact_id, list);
        }

        const contacts: ExportContact[] = filteredContacts.map((c) => ({
          id: c.id,
          displayName: c.display_name,
          jobTitle: c.job_title,
          notes: c.notes,
          archived: c.archived_at !== null,
          archivedAt: toIsoUtc(c.archived_at),
          createdAt: toIsoUtc(c.created_at)!,
          methods: methodsByContact.get(c.id) ?? [],
        }));

        // Preload vacancy-contact relationships
        const linkRows = db
          .prepare(
            `SELECT vc.id, vc.canonical_vacancy_id, vc.contact_id, c.display_name AS contact_display_name,
                    vc.role, vc.created_at, vc.ended_at
             FROM vacancy_contacts vc
             JOIN contacts c ON c.id = vc.contact_id
             ORDER BY vc.created_at ASC, vc.id ASC`,
          )
          .all() as {
          id: string;
          canonical_vacancy_id: string;
          contact_id: string;
          contact_display_name: string;
          role: VacancyContact["role"];
          created_at: string;
          ended_at: string | null;
        }[];
        const linksByVacancy = new Map<string, ExportVacancyContactLink[]>();
        for (const row of linkRows) {
          const list = linksByVacancy.get(row.canonical_vacancy_id) ?? [];
          list.push({
            id: row.id,
            vacancyId: row.canonical_vacancy_id,
            contactId: row.contact_id,
            contactDisplayName: row.contact_display_name,
            role: row.role,
            createdAt: toIsoUtc(row.created_at)!,
            endedAt: toIsoUtc(row.ended_at),
          });
          linksByVacancy.set(row.canonical_vacancy_id, list);
        }

        // Preload application documents, lifecycle, versions, associations (no storage_key or bytes)
        const docRows = db
          .prepare("SELECT id, kind, name, created_at FROM application_documents ORDER BY created_at ASC, id ASC")
          .all() as { id: string; kind: ApplicationDocumentKind; name: string; created_at: string }[];
        const docChanges = db
          .prepare("SELECT document_id, operation, name, created_at FROM application_document_changes ORDER BY rowid ASC")
          .all() as { document_id: string; operation: string; name: string | null; created_at: string }[];

        const docStateMap = new Map<
          string,
          { id: string; kind: ApplicationDocumentKind; name: string; createdAt: string; archivedAt: string | null }
        >();
        for (const d of docRows) {
          docStateMap.set(d.id, {
            id: d.id,
            kind: d.kind,
            name: d.name,
            createdAt: toIsoUtc(d.created_at)!,
            archivedAt: null,
          });
        }
        for (const ch of docChanges) {
          const doc = docStateMap.get(ch.document_id);
          if (!doc) continue;
          if (ch.operation === "RENAME" && ch.name) doc.name = ch.name;
          else if (ch.operation === "ARCHIVE") doc.archivedAt ??= toIsoUtc(ch.created_at);
          else if (ch.operation === "RESTORE") doc.archivedAt = null;
        }

        const versionRows = db
          .prepare(
            `SELECT id, document_id, version_number, original_file_name, media_type, size_bytes, content_hash, created_at
             FROM application_document_versions
             ORDER BY document_id ASC, version_number ASC, id ASC`,
          )
          .all() as {
          id: string;
          document_id: string;
          version_number: number;
          original_file_name: string;
          media_type: string | null;
          size_bytes: number;
          content_hash: string;
          created_at: string;
        }[];
        const versionsByDoc = new Map<string, ExportDocument["versions"][number][]>();
        for (const v of versionRows) {
          const list = versionsByDoc.get(v.document_id) ?? [];
          list.push({
            id: v.id,
            documentId: v.document_id,
            versionNumber: v.version_number,
            originalFileName: v.original_file_name,
            mediaType: v.media_type,
            sizeBytes: v.size_bytes,
            contentHash: v.content_hash,
            createdAt: toIsoUtc(v.created_at)!,
          });
          versionsByDoc.set(v.document_id, list);
        }

        const documents: ExportDocument[] = Array.from(docStateMap.values())
          .filter((d) => includeArchived || d.archivedAt === null)
          .map((d) => ({
            id: d.id,
            kind: d.kind,
            name: d.name,
            archived: d.archivedAt !== null,
            archivedAt: d.archivedAt,
            createdAt: d.createdAt,
            versions: versionsByDoc.get(d.id) ?? [],
          }));

        const assocRows = db
          .prepare(
            `SELECT a.id, a.canonical_vacancy_id, a.document_version_id, a.created_at,
                    v.document_id, v.version_number, v.original_file_name, d.kind
             FROM vacancy_application_documents a
             JOIN application_document_versions v ON v.id = a.document_version_id
             JOIN application_documents d ON d.id = v.document_id
             ORDER BY a.created_at ASC, a.id ASC`,
          )
          .all() as {
          id: string;
          canonical_vacancy_id: string;
          document_version_id: string;
          created_at: string;
          document_id: string;
          version_number: number;
          original_file_name: string;
          kind: ApplicationDocumentKind;
        }[];

        // Determine latest association per (vacancy, kind)
        const latestAssocByVacancyKind = new Map<string, string>();
        for (const row of assocRows) {
          latestAssocByVacancyKind.set(`${row.canonical_vacancy_id}:${row.kind}`, row.id);
        }
        const associationsByVacancy = new Map<string, ExportVacancyDocumentAssociation[]>();
        for (const row of assocRows) {
          const docState = docStateMap.get(row.document_id);
          const list = associationsByVacancy.get(row.canonical_vacancy_id) ?? [];
          list.push({
            id: row.id,
            vacancyId: row.canonical_vacancy_id,
            documentId: row.document_id,
            documentName: docState?.name ?? "",
            documentKind: row.kind,
            selectedVersionId: row.document_version_id,
            versionNumber: row.version_number,
            originalFileName: row.original_file_name,
            createdAt: toIsoUtc(row.created_at)!,
            current: latestAssocByVacancyKind.get(`${row.canonical_vacancy_id}:${row.kind}`) === row.id,
          });
          associationsByVacancy.set(row.canonical_vacancy_id, list);
        }

        const vacancies: ExportVacancy[] = filteredVacancyRows.map((v) => {
          const fields = fieldsByVacancy.get(v.id);
          const obs = latestObsByVacancy.get(v.id);
          const humanEmployer = humanEmployerByVacancy.get(v.id);
          const cluster = clusterByVacancy.get(v.id);

          let displayName: string | null = null;
          let displayState: EmployerDisplayState = "UNRESOLVED";
          let confirmationStatus: ExportEmployerConfirmationStatus = "unresolved";

          if (humanEmployer) {
            displayName = humanEmployer;
            displayState = "HUMAN_CONFIRMED";
            confirmationStatus = "confirmed_for_vacancy";
          } else if (cluster?.displayLabel && cluster.status === "CONFIRMED") {
            displayName = cluster.displayLabel;
            displayState = "MEMORY_REUSED";
            confirmationStatus = "recognized_from_prior_knowledge";
          } else if (cluster?.displayLabel) {
            displayName = cluster.displayLabel;
            displayState = "INFERRED";
            confirmationStatus = "automatically_recognized_not_confirmed";
          }

          return {
            id: v.id,
            canonical: {
              title: fields?.get("role") ?? null,
              location: fields?.get("location") ?? null,
              workMode: fields?.get("workMode") ?? null,
              engagement: fields?.get("engagement") ?? null,
              compensation: fields?.get("compensation") ?? null,
              status: v.canonicalization_status,
              createdAt: toIsoUtc(v.created_at)!,
              updatedAt: toIsoUtc(v.updated_at)!,
            },
            source: {
              sourceType: "CAPTURED",
              provider: obs?.source_name ?? null,
              url: sanitizePublicSourceUrl(obs?.source_url ?? null),
              externalId: obs?.external_id ?? null,
              displayedCompanyName: obs?.displayed_company_name ?? null,
              observedAt: toIsoUtc(obs?.observed_at ?? null),
              publishedAt: toIsoUtc(obs?.published_at ?? null),
            },
            employer: {
              displayName,
              displayState,
              confirmationStatus,
            },
            crm: {
              priority: priorityByVacancy.get(v.id) ?? "NONE",
              processState: processStateByVacancy.get(v.id) ?? "DISCOVERED",
              archived: v.archived_at !== null,
              archivedAt: toIsoUtc(v.archived_at),
            },
            notes: notesByVacancy.get(v.id) ?? [],
            processHistory: transitionsByVacancy.get(v.id) ?? [],
            interactions: interactionsByVacancy.get(v.id) ?? [],
            actions: actionsByVacancy.get(v.id) ?? [],
            contacts: linksByVacancy.get(v.id) ?? [],
            documentAssociations: associationsByVacancy.get(v.id) ?? [],
          };
        });

        const payload: UserDataExportPayload = {
          format: EXPORT_FORMAT,
          formatVersion: EXPORT_FORMAT_VERSION,
          exportedAt,
          vacancies,
          contacts,
          documents,
        };
        validateExportPayload(payload);
        return payload;
      })
      .deferred();
  }

  private computeCounts(payload: UserDataExportPayload): ExportCounts {
    let notes = 0;
    let processTransitions = 0;
    let interactions = 0;
    let actions = 0;
    let reminders = 0;
    let vacancyContacts = 0;
    let documentAssociations = 0;
    for (const v of payload.vacancies) {
      notes += v.notes.length;
      processTransitions += v.processHistory.length;
      interactions += v.interactions.length;
      actions += v.actions.length;
      for (const a of v.actions) reminders += a.reminders.length;
      vacancyContacts += v.contacts.length;
      documentAssociations += v.documentAssociations.length;
    }
    let contactMethods = 0;
    for (const c of payload.contacts) contactMethods += c.methods.length;
    let documentVersions = 0;
    for (const d of payload.documents) documentVersions += d.versions.length;
    return {
      vacancies: payload.vacancies.length,
      notes,
      processTransitions,
      interactions,
      actions,
      reminders,
      contacts: payload.contacts.length,
      contactMethods,
      vacancyContacts,
      documents: payload.documents.length,
      documentVersions,
      documentAssociations,
    };
  }

  private buildCsvPackageBytes(payload: UserDataExportPayload, counts: ExportCounts): Buffer {
    const manifest = {
      format: payload.format,
      formatVersion: payload.formatVersion,
      exportedAt: payload.exportedAt,
      encoding: "UTF-8 with BOM",
      note: "Human-readable CRM export. Cannot be used as a Job Nearby backup.",
      counts,
    };

    const vacancyRows: CsvCell[][] = payload.vacancies.map((v) => [
      v.id,
      v.canonical.title,
      v.source.displayedCompanyName,
      v.employer.displayName,
      v.employer.displayState,
      v.employer.confirmationStatus,
      v.canonical.location,
      v.canonical.workMode,
      v.canonical.engagement,
      v.canonical.compensation,
      v.source.sourceType,
      v.source.provider,
      v.source.url,
      v.source.externalId,
      v.source.observedAt,
      v.source.publishedAt,
      v.crm.priority,
      v.crm.processState,
      v.crm.archived,
      v.crm.archivedAt,
      v.canonical.createdAt,
      v.canonical.updatedAt,
    ]);

    const noteRows: CsvCell[][] = [];
    const transitionRows: CsvCell[][] = [];
    const interactionRows: CsvCell[][] = [];
    const actionRows: CsvCell[][] = [];
    const reminderRows: CsvCell[][] = [];
    const vacancyContactRows: CsvCell[][] = [];
    const associationRows: CsvCell[][] = [];

    for (const v of payload.vacancies) {
      for (const n of v.notes) {
        noteRows.push([n.id, v.id, v.canonical.title, n.text, n.createdAt]);
      }
      for (const t of v.processHistory) {
        transitionRows.push([t.id, v.id, v.canonical.title, t.fromState, t.toState, t.createdAt]);
      }
      for (const i of v.interactions) {
        interactionRows.push([
          i.id,
          v.id,
          v.canonical.title,
          i.type,
          i.occurredAt,
          i.recordedAt,
          i.contactId,
          i.contactDisplayName,
          i.metadata ? JSON.stringify(i.metadata) : null,
        ]);
      }
      for (const a of v.actions) {
        actionRows.push([
          a.id,
          v.id,
          v.canonical.title,
          a.description,
          a.status,
          a.createdAt,
          a.dueAt,
          a.completedAt,
          a.cancelledAt,
          a.contactId,
          a.contactDisplayName,
        ]);
        for (const r of a.reminders) {
          reminderRows.push([
            r.id,
            a.id,
            v.id,
            r.remindAt,
            r.status,
            r.createdAt,
            r.dismissedAt,
            r.supersededAt,
          ]);
        }
      }
      for (const vc of v.contacts) {
        vacancyContactRows.push([
          vc.id,
          v.id,
          v.canonical.title,
          vc.contactId,
          vc.contactDisplayName,
          vc.role,
          vc.createdAt,
          vc.endedAt,
        ]);
      }
      for (const da of v.documentAssociations) {
        associationRows.push([
          da.id,
          v.id,
          v.canonical.title,
          da.documentId,
          da.documentName,
          da.documentKind,
          da.selectedVersionId,
          da.versionNumber,
          da.originalFileName,
          da.current,
          da.createdAt,
        ]);
      }
    }

    const contactRows: CsvCell[][] = [];
    const contactMethodRows: CsvCell[][] = [];
    for (const c of payload.contacts) {
      contactRows.push([c.id, c.displayName, c.jobTitle, c.notes, c.archived, c.archivedAt, c.createdAt]);
      for (const m of c.methods) {
        contactMethodRows.push([m.id, c.id, c.displayName, m.type, m.value, m.label, m.createdAt]);
      }
    }

    const documentRows: CsvCell[][] = [];
    const documentVersionRows: CsvCell[][] = [];
    for (const d of payload.documents) {
      documentRows.push([d.id, d.kind, d.name, d.archived, d.archivedAt, d.createdAt]);
      for (const dv of d.versions) {
        documentVersionRows.push([
          dv.id,
          d.id,
          d.name,
          dv.versionNumber,
          dv.originalFileName,
          dv.mediaType,
          dv.sizeBytes,
          dv.contentHash,
          dv.createdAt,
        ]);
      }
    }

    return createZipArchive([
      { name: "export-manifest.json", data: Buffer.from(JSON.stringify(manifest, null, 2), "utf8") },
      {
        name: "vacancies.csv",
        data: serializeCsv(
          [
            "id",
            "title",
            "displayed_company_name",
            "employer_display_name",
            "employer_display_state",
            "employer_confirmation_status",
            "location",
            "work_mode",
            "engagement",
            "compensation",
            "source_type",
            "source_provider",
            "source_url",
            "source_external_id",
            "observed_at",
            "published_at",
            "priority",
            "process_state",
            "archived",
            "archived_at",
            "created_at",
            "updated_at",
          ],
          vacancyRows,
        ),
      },
      {
        name: "notes.csv",
        data: serializeCsv(["id", "vacancy_id", "vacancy_title", "text", "created_at"], noteRows),
      },
      {
        name: "process_transitions.csv",
        data: serializeCsv(
          ["id", "vacancy_id", "vacancy_title", "from_state", "to_state", "created_at"],
          transitionRows,
        ),
      },
      {
        name: "interactions.csv",
        data: serializeCsv(
          [
            "id",
            "vacancy_id",
            "vacancy_title",
            "type",
            "occurred_at",
            "recorded_at",
            "contact_id",
            "contact_display_name",
            "metadata_json",
          ],
          interactionRows,
        ),
      },
      {
        name: "actions.csv",
        data: serializeCsv(
          [
            "id",
            "vacancy_id",
            "vacancy_title",
            "description",
            "status",
            "created_at",
            "due_at",
            "completed_at",
            "cancelled_at",
            "contact_id",
            "contact_display_name",
          ],
          actionRows,
        ),
      },
      {
        name: "reminders.csv",
        data: serializeCsv(
          ["id", "action_id", "vacancy_id", "remind_at", "status", "created_at", "dismissed_at", "superseded_at"],
          reminderRows,
        ),
      },
      {
        name: "contacts.csv",
        data: serializeCsv(
          ["id", "display_name", "job_title", "notes", "archived", "archived_at", "created_at"],
          contactRows,
        ),
      },
      {
        name: "contact_methods.csv",
        data: serializeCsv(
          ["id", "contact_id", "contact_display_name", "type", "value", "label", "created_at"],
          contactMethodRows,
        ),
      },
      {
        name: "vacancy_contacts.csv",
        data: serializeCsv(
          ["id", "vacancy_id", "vacancy_title", "contact_id", "contact_display_name", "role", "created_at", "ended_at"],
          vacancyContactRows,
        ),
      },
      {
        name: "documents.csv",
        data: serializeCsv(["id", "kind", "name", "archived", "archived_at", "created_at"], documentRows),
      },
      {
        name: "document_versions.csv",
        data: serializeCsv(
          [
            "id",
            "document_id",
            "document_name",
            "version_number",
            "original_file_name",
            "media_type",
            "size_bytes",
            "content_hash",
            "created_at",
          ],
          documentVersionRows,
        ),
      },
      {
        name: "document_associations.csv",
        data: serializeCsv(
          [
            "id",
            "vacancy_id",
            "vacancy_title",
            "document_id",
            "document_name",
            "document_kind",
            "selected_version_id",
            "version_number",
            "original_file_name",
            "current",
            "created_at",
          ],
          associationRows,
        ),
      },
    ]);
  }

  exportUserData(input: {
    readonly format: "json" | "csv";
    readonly destinationPath?: string;
    readonly includeArchived?: boolean;
  }): ExportUserDataResult {
    const payload = this.buildExportPayload(
      input.includeArchived === undefined ? {} : { includeArchived: input.includeArchived },
    );
    const counts = this.computeCounts(payload);
    const dateStamp = payload.exportedAt.slice(0, 10);

    const fileName =
      input.format === "json"
        ? `job-nearby-export-${dateStamp}.json`
        : `job-nearby-export-${dateStamp}.zip`;
    const mimeType = input.format === "json" ? "application/json; charset=utf-8" : "application/zip";

    const bytes =
      input.format === "json"
        ? Buffer.from(JSON.stringify(payload, null, 2) + "\n", "utf8")
        : this.buildCsvPackageBytes(payload, counts);

    let destinationPath: string | null = null;
    if (input.destinationPath !== undefined) {
      try {
        destinationPath = assertSafeBackupDestination(input.destinationPath, this.config.documentDataDir);
      } catch (error) {
        throw new ExportError(error instanceof Error ? error.message : String(error), 400);
      }
      this.config.onBeforeWriteDestination?.();
      writeFileAtomically(destinationPath, bytes);
    }

    return {
      format: input.format,
      formatVersion: EXPORT_FORMAT_VERSION,
      exportedAt: payload.exportedAt,
      destinationPath,
      fileName,
      mimeType,
      counts,
      ...(destinationPath === null ? { contentBytes: bytes } : {}),
    };
  }
}
