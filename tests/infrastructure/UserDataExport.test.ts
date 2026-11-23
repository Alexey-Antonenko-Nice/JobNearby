import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { EXPORT_FORMAT, EXPORT_FORMAT_VERSION, type UserDataExportPayload } from "../../src/application/export/exportTypes.js";
import { ManagedApplicationDocumentLibrary } from "../../src/application/user/ApplicationDocumentLibrary.js";
import { ContactLibrary } from "../../src/application/user/ContactLibrary.js";
import { createVacancyReviewWorkflow } from "../../src/application/user/createVacancyReviewWorkflow.js";
import { readZipArchive } from "../../src/infrastructure/backup/zipArchive.js";
import { createDatabase } from "../../src/infrastructure/database/createDatabase.js";
import { LocalUserDataExportService } from "../../src/infrastructure/export/LocalUserDataExportService.js";
import { createTestCaptureServer as createBrowserCaptureServer } from "../support/httpAuthorization.js";
import { SqliteApplicationDocumentRepository } from "../../src/infrastructure/persistence/SqliteApplicationDocumentRepository.js";
import { SqliteCanonicalVacancyRepository } from "../../src/infrastructure/persistence/SqliteCanonicalVacancyRepository.js";
import { SqliteConfirmedOrganizationRoleRepository } from "../../src/infrastructure/persistence/SqliteConfirmedOrganizationRoleRepository.js";
import { SqliteContactRepository } from "../../src/infrastructure/persistence/SqliteContactRepository.js";
import { SqliteEmployerAliasEvidenceRepository } from "../../src/infrastructure/persistence/SqliteEmployerAliasEvidenceRepository.js";
import { SqliteEmployerClusterRepository } from "../../src/infrastructure/persistence/SqliteEmployerClusterRepository.js";
import { SqliteEmployerIdentityDecisionStore } from "../../src/infrastructure/persistence/SqliteEmployerIdentityDecisionStore.js";
import { SqliteEmployerMemoryPublicDataSource } from "../../src/infrastructure/persistence/SqliteEmployerMemoryPublicDataSource.js";
import { SqliteEmployerRecognitionPersistence } from "../../src/infrastructure/persistence/SqliteEmployerRecognitionPersistence.js";
import { SqliteObservationClusterAssignmentRepository } from "../../src/infrastructure/persistence/SqliteObservationClusterAssignmentRepository.js";
import { SqlitePublicationCampaignContextSource } from "../../src/infrastructure/persistence/SqlitePublicationCampaignContextSource.js";
import { SqliteSourceObservationRepository } from "../../src/infrastructure/persistence/SqliteSourceObservationRepository.js";
import { SqliteUserVacancyInteractionRepository } from "../../src/infrastructure/persistence/SqliteUserVacancyInteractionRepository.js";
import { SqliteVacancyCleanup } from "../../src/infrastructure/persistence/SqliteVacancyCleanup.js";
import { SqliteVacancyCrmRepository } from "../../src/infrastructure/persistence/SqliteVacancyCrmRepository.js";
import { SqliteVacancyOrganizationRoleDecisionRepository } from "../../src/infrastructure/persistence/SqliteVacancyOrganizationRoleDecisionRepository.js";
import { createCaptureProcessingRuntime } from "../../src/infrastructure/runtime/createCaptureProcessingRuntime.js";
import { LocalManagedDocumentStorage } from "../../src/infrastructure/storage/LocalManagedDocumentStorage.js";

const tempDirs: string[] = [];
const openDbs: Database.Database[] = [];

function makeTempDir(prefix = "jn-export-test-"): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (openDbs.length > 0) {
    const db = openDbs.pop()!;
    if (db.open) db.close();
  }
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop()!, { recursive: true, force: true });
  }
});

function createEnv() {
  const rootDir = makeTempDir();
  const dbPath = join(rootDir, "job-nearby.sqlite");
  const docDir = join(rootDir, "app-data");
  const exportDir = join(rootDir, "exports");
  mkdirSync(docDir, { recursive: true });
  mkdirSync(exportDir, { recursive: true });

  const db = createDatabase(dbPath);
  openDbs.push(db);

  const workflow = createVacancyReviewWorkflow({
    contactLibrary: new ContactLibrary(new SqliteContactRepository(db)),
    documentLibrary: new ManagedApplicationDocumentLibrary(
      new SqliteApplicationDocumentRepository(db),
      new LocalManagedDocumentStorage(docDir),
    ),
    crmRepository: new SqliteVacancyCrmRepository(db),
    employerIdentityDecisionStore: new SqliteEmployerIdentityDecisionStore(db),
    organizationRoleDecisionRepository: new SqliteVacancyOrganizationRoleDecisionRepository(db),
    agencyMemoryRepository: new SqliteConfirmedOrganizationRoleRepository(db),
    publicationCampaignContextSource: new SqlitePublicationCampaignContextSource(db),
    aliasRepository: new SqliteEmployerAliasEvidenceRepository(db),
    canonicalVacancyRepository: new SqliteCanonicalVacancyRepository(db),
    sourceObservationRepository: new SqliteSourceObservationRepository(db),
    interactionRepository: new SqliteUserVacancyInteractionRepository(db),
    employerClusterRepository: new SqliteEmployerClusterRepository(db),
    recognitionPersistence: new SqliteEmployerRecognitionPersistence(db),
    employerClusterWriter: new SqliteEmployerClusterRepository(db),
    employerMemoryPublicDataSource: new SqliteEmployerMemoryPublicDataSource(db),
    assignmentRepository: new SqliteObservationClusterAssignmentRepository(db),
  });

  const service = (overrides?: Partial<ConstructorParameters<typeof LocalUserDataExportService>[0]>) =>
    new LocalUserDataExportService({
      getDatabase: () => db,
      documentDataDir: docDir,
      now: () => new Date("2026-11-22T08:30:00.000Z"),
      ...overrides,
    });

  return { rootDir, dbPath, docDir, exportDir, db, workflow, service };
}

async function seedExportData(env: ReturnType<typeof createEnv>) {
  const runtime = createCaptureProcessingRuntime(env.db);
  const captureResult = await runtime.captureAndProcessBrowserVacancy({
    pageUrl: "https://job-boards.eu.greenhouse.io/agilerobotsse/jobs/4964827101",
    pageTitle: "Manufacturing Engineer",
    visibleText: "Manufacturing Engineer",
    capturedAt: "2026-05-01T10:00:00.000Z",
    html: readFileSync("tests/fixtures/greenhouseSelectedVacancy.html", "utf8"),
  });
  if (captureResult.processing.status !== "PROCESSED") throw new Error("Expected processed vacancy");
  const vacancyId = captureResult.processing.canonicalVacancyId;

  await env.workflow.setVacancyPriority({ canonicalVacancyId: vacancyId, priority: "HIGH" });
  await env.workflow.addVacancyNote({
    canonicalVacancyId: vacancyId,
    requestId: randomUUID(),
    text: 'Line 1: Équipe ingénierie, "Toulouse"\nLine 2: Привет мир',
  });
  await env.workflow.setVacancyProcessState({
    canonicalVacancyId: vacancyId,
    requestId: randomUUID(),
    state: "APPLIED",
  });

  const contactId = env.workflow.contactCommand({
    operation: "CREATE",
    requestId: randomUUID(),
    displayName: "Claire Dupont",
    jobTitle: "Recruiter",
    notes: "Direct contact, France",
  }).resultId;

  env.workflow.contactCommand({
    operation: "ADD_METHOD",
    requestId: randomUUID(),
    contactId,
    type: "PHONE",
    value: " +33 6 12 34 56 78 ",
    label: "Mobile",
  });

  env.workflow.contactCommand({
    operation: "LINK",
    requestId: randomUUID(),
    contactId,
    canonicalVacancyId: vacancyId,
    role: "RECRUITER",
  });

  await env.workflow.recordVacancyReviewAction({
    canonicalVacancyId: vacancyId,
    type: "APPLIED",
    occurredAt: new Date("2026-05-02T09:00:00.000Z"),
    requestId: randomUUID(),
    contactId,
  });

  const actionRes = await env.workflow.createVacancyNextAction({
    canonicalVacancyId: vacancyId,
    requestId: randomUUID(),
    description: "Follow up on application",
    dueAt: "2026-05-10T10:00:00.000Z",
    contactId,
  });
  const actionId = actionRes.nextActions!.actions[0]!.id;
  await env.workflow.setVacancyActionReminder({
    canonicalVacancyId: vacancyId,
    actionId,
    requestId: randomUUID(),
    remindAt: "2026-05-09T09:00:00.000Z",
  });

  const docBytes = Buffer.from("%PDF-1.4\nSecret CV bytes that must NOT be in export\n", "utf8");
  const docLib = env.workflow.importLibraryDocument({
    requestId: randomUUID(),
    kind: "CV",
    name: "Engineering CV",
    originalFileName: "engineering-cv.pdf",
    mediaType: "application/pdf",
    bytes: docBytes,
  });
  const docId = docLib[0]!.id;
  const versionId = docLib[0]!.versions[0]!.id;

  await env.workflow.associateVacancyDocument({
    canonicalVacancyId: vacancyId,
    versionId,
    requestId: randomUUID(),
  });

  // Archive vacancy, contact, and document to verify default export includes archived items
  const cleanup = new SqliteVacancyCleanup(env.db);
  cleanup.setArchived(vacancyId, true, cleanup.state(vacancyId).token);
  env.workflow.contactCommand({ operation: "ARCHIVE", requestId: randomUUID(), contactId });
  env.workflow.archiveApplicationDocument({ documentId: docId, requestId: randomUUID() });

  return { vacancyId, contactId, docId, versionId, actionId };
}

describe("M22.2 User-Data Export Foundation", () => {
  it("exports an empty dataset cleanly in both JSON and CSV formats", () => {
    const env = createEnv();
    const jsonPath = join(env.exportDir, "empty.json");
    const csvPath = join(env.exportDir, "empty.zip");

    const jsonRes = env.service().exportUserData({ format: "json", destinationPath: jsonPath });
    expect(jsonRes.counts.vacancies).toBe(0);
    const parsed = JSON.parse(readFileSync(jsonPath, "utf8")) as UserDataExportPayload;
    expect(parsed).toEqual({
      format: EXPORT_FORMAT,
      formatVersion: EXPORT_FORMAT_VERSION,
      exportedAt: "2026-11-22T08:30:00.000Z",
      vacancies: [],
      contacts: [],
      documents: [],
    });

    const csvRes = env.service().exportUserData({ format: "csv", destinationPath: csvPath });
    expect(csvRes.counts.vacancies).toBe(0);
    const entries = readZipArchive(readFileSync(csvPath));
    expect(entries.has("export-manifest.json")).toBe(true);
    expect(entries.has("vacancies.csv")).toBe(true);
    expect(entries.has("notes.csv")).toBe(true);
    expect(entries.has("actions.csv")).toBe(true);
    expect(entries.has("reminders.csv")).toBe(true);
    expect(entries.has("contacts.csv")).toBe(true);
    expect(entries.has("documents.csv")).toBe(true);
  });

  it("exports rich JSON with deterministic ordering, Unicode/multiline preservation, archived items, and no internal/binary leaks", async () => {
    const env = createEnv();
    const seeded = await seedExportData(env);
    const jsonPath = join(env.exportDir, "export.json");

    const res1 = env.service().exportUserData({ format: "json", destinationPath: jsonPath });
    const raw1 = readFileSync(jsonPath, "utf8");
    const res2 = env.service().exportUserData({ format: "json", destinationPath: jsonPath });
    const raw2 = readFileSync(jsonPath, "utf8");
    expect(raw1).toBe(raw2); // Deterministic output

    const payload = JSON.parse(raw1) as UserDataExportPayload;
    expect(payload.format).toBe(EXPORT_FORMAT);
    expect(payload.formatVersion).toBe(EXPORT_FORMAT_VERSION);
    expect(payload.exportedAt).toBe("2026-11-22T08:30:00.000Z");

    expect(payload.vacancies).toHaveLength(1);
    const v = payload.vacancies[0]!;
    expect(v.id).toBe(seeded.vacancyId);
    expect(v.source.sourceType).toBe("CAPTURED");
    expect(v.crm.priority).toBe("HIGH");
    expect(v.crm.processState).toBe("APPLIED");
    expect(v.crm.archived).toBe(true);
    expect(v.crm.archivedAt).toMatch(/Z$/u);

    expect(v.notes[0]!.text).toBe('Line 1: Équipe ingénierie, "Toulouse"\nLine 2: Привет мир');
    expect(v.processHistory).toHaveLength(1);
    expect(v.processHistory[0]!.fromState).toBe("DISCOVERED");
    expect(v.processHistory[0]!.toState).toBe("APPLIED");

    expect(v.interactions[0]!.contactId).toBe(seeded.contactId);
    expect(v.interactions[0]!.contactDisplayName).toBe("Claire Dupont");
    expect(v.actions[0]!.reminders).toHaveLength(1);
    expect(v.actions[0]!.reminders[0]!.status).toBe("ACTIVE");

    // Document associations say selectedVersionId (not sentCv), and no storage_key or raw bytes leak
    expect(v.documentAssociations[0]!.selectedVersionId).toBe(seeded.versionId);
    expect(raw1).not.toContain("Secret CV bytes");
    expect(raw1).not.toContain("storage_key");
    expect(raw1).not.toContain("storageKey");
    expect(raw1).not.toContain("schema_migrations");
    expect(raw1).not.toContain("request_fingerprint");

    // Contact method preserves exact entered value (with leading/trailing spaces)
    expect(payload.contacts[0]!.methods[0]!.value).toBe(" +33 6 12 34 56 78 ");
    expect(payload.contacts[0]!.archived).toBe(true);
    expect(payload.documents[0]!.archived).toBe(true);
    expect(res1.counts).toEqual(res2.counts);
  });

  it("exports CSV ZIP package with UTF-8 BOM, RFC-4180 escaping, consistent counts, and no DB/store mutation", async () => {
    const env = createEnv();
    const seeded = await seedExportData(env);

    const beforeVacancies = env.db.prepare("SELECT * FROM canonical_vacancies").all();
    const beforeCleanup = new SqliteVacancyCleanup(env.db).state(seeded.vacancyId);

    const jsonRes = env.service().exportUserData({ format: "json" });
    const csvPath = join(env.exportDir, "export.zip");
    const csvRes = env.service().exportUserData({ format: "csv", destinationPath: csvPath });

    expect(csvRes.counts).toEqual(jsonRes.counts);

    const entries = readZipArchive(readFileSync(csvPath));
    const expectedFiles = [
      "export-manifest.json",
      "vacancies.csv",
      "notes.csv",
      "process_transitions.csv",
      "interactions.csv",
      "actions.csv",
      "reminders.csv",
      "contacts.csv",
      "contact_methods.csv",
      "vacancy_contacts.csv",
      "documents.csv",
      "document_versions.csv",
      "document_associations.csv",
    ];
    for (const file of expectedFiles) {
      expect(entries.has(file)).toBe(true);
    }

    const notesCsv = entries.get("notes.csv")!.toString("utf8");
    expect(notesCsv.startsWith("\uFEFF")).toBe(true);
    // Escaped quotes, comma, French accents, Cyrillic, multiline preserved
    expect(notesCsv).toContain('"Line 1: Équipe ingénierie, ""Toulouse""\nLine 2: Привет мир"');

    const vacanciesCsv = entries.get("vacancies.csv")!.toString("utf8");
    expect(vacanciesCsv).toContain(",true,");

    // DB state completely unchanged
    expect(env.db.prepare("SELECT * FROM canonical_vacancies").all()).toEqual(beforeVacancies);
    expect(new SqliteVacancyCleanup(env.db).state(seeded.vacancyId).archived).toBe(beforeCleanup.archived);
  });

  it("leaves no partial final artifact on failure and exposes /export/json and /export/csv HTTP endpoints", async () => {
    const env = createEnv();
    await seedExportData(env);

    const failJson = join(env.exportDir, "should-not-exist.json");
    expect(() =>
      env.service({
        onBeforeWriteDestination: () => {
          throw new Error("Simulated write failure");
        },
      }).exportUserData({ format: "json", destinationPath: failJson }),
    ).toThrow("Simulated write failure");
    expect(existsSync(failJson)).toBe(false);

    const server = createBrowserCaptureServer({
      exportService: env.service(),
      captureAndProcessBrowserVacancy: async () => {
        throw new Error("unused");
      },
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const address = server.address() as { port: number };
    const baseUrl = `http://127.0.0.1:${address.port}`;

    try {
      const jsonHttp = await fetch(`${baseUrl}/export/json`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      expect(jsonHttp.status).toBe(200);
      const jsonBody = (await jsonHttp.json()) as {
        export: { format: string; counts: { vacancies: number } };
        contentBase64: string;
      };
      expect(jsonBody.export.format).toBe("json");
      expect(jsonBody.export.counts.vacancies).toBe(1);
      expect(Buffer.from(jsonBody.contentBase64, "base64").toString("utf8")).toContain("Claire Dupont");

      const csvHttp = await fetch(`${baseUrl}/export/csv`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      expect(csvHttp.status).toBe(200);
      const csvBody = (await csvHttp.json()) as {
        export: { format: string; counts: { contacts: number } };
        contentBase64: string;
      };
      expect(csvBody.export.format).toBe("csv");
      expect(csvBody.export.counts.contacts).toBe(1);
      const zipEntries = readZipArchive(Buffer.from(csvBody.contentBase64, "base64"));
      expect(zipEntries.has("vacancies.csv")).toBe(true);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
