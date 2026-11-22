import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { ManagedApplicationDocumentLibrary } from "../../src/application/user/ApplicationDocumentLibrary.js";
import { ContactLibrary } from "../../src/application/user/ContactLibrary.js";
import { createVacancyReviewWorkflow } from "../../src/application/user/createVacancyReviewWorkflow.js";
import { LocalBackupService } from "../../src/infrastructure/backup/LocalBackupService.js";
import { createZipArchive, readZipArchive, validateArchiveEntryPath } from "../../src/infrastructure/backup/zipArchive.js";
import { createDatabase } from "../../src/infrastructure/database/createDatabase.js";
import { CURRENT_SCHEMA_VERSION } from "../../src/infrastructure/database/migrateDatabase.js";
import { createBrowserCaptureServer } from "../../src/infrastructure/http/createBrowserCaptureServer.js";
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
const openEnvs: TestEnv[] = [];

function makeTempDir(prefix = "jn-backup-test-"): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (openEnvs.length > 0) {
    openEnvs.pop()!.close();
  }
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()!;
    rmSync(dir, { recursive: true, force: true });
  }
});

interface TestEnv {
  readonly rootDir: string;
  readonly dbPath: string;
  readonly docDir: string;
  readonly backupDir: string;
  readonly stagingTempDir: string;
  db: Database.Database;
  close(): void;
  reopen(): void;
  service(overrides?: Partial<ConstructorParameters<typeof LocalBackupService>[0]>): LocalBackupService;
}

function createTestEnv(prefix = "jn-env-"): TestEnv {
  const rootDir = makeTempDir(prefix);
  const dbPath = join(rootDir, "job-nearby.sqlite");
  const docDir = join(rootDir, "app-data");
  const backupDir = join(rootDir, "backups");
  const stagingTempDir = join(rootDir, "tmp-stage");
  mkdirSync(docDir, { recursive: true });
  mkdirSync(backupDir, { recursive: true });
  mkdirSync(stagingTempDir, { recursive: true });

  const env: TestEnv = {
    rootDir,
    dbPath,
    docDir,
    backupDir,
    stagingTempDir,
    db: createDatabase(dbPath),
    close() {
      if (this.db.open) this.db.close();
    },
    reopen() {
      if (this.db.open) this.db.close();
      this.db = createDatabase(dbPath);
    },
    service(overrides = {}) {
      return new LocalBackupService({
        getDatabase: () => this.db,
        databasePath: dbPath,
        documentDataDir: docDir,
        defaultBackupDir: backupDir,
        temporaryRoot: stagingTempDir,
        beforeSwap: () => {
          if (this.db.open) this.db.close();
        },
        afterSwap: () => {
          this.db = createDatabase(dbPath);
        },
        ...overrides,
      });
    },
  };
  openEnvs.push(env);
  return env;
}

function createWorkflow(db: Database.Database, docDir: string) {
  return createVacancyReviewWorkflow({
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
}

async function seedRichUserState(env: TestEnv) {
  const runtime = createCaptureProcessingRuntime(env.db);
  const captureResult = await runtime.captureAndProcessBrowserVacancy({
    pageUrl: "https://job-boards.eu.greenhouse.io/agilerobotsse/jobs/4964827101",
    pageTitle: "Senior Engineer at Agile Robots",
    visibleText: "Senior Engineer\nAgile Robots\nToulouse, France",
    capturedAt: "2026-05-01T10:00:00.000Z",
    html: readFileSync("tests/fixtures/greenhouseSelectedVacancy.html", "utf8"),
  });
  expect(captureResult.processing.status).toBe("PROCESSED");
  if (captureResult.processing.status !== "PROCESSED") throw new Error("Expected processed vacancy");
  const vacancyId = captureResult.processing.canonicalVacancyId;

  const workflow = createWorkflow(env.db, env.docDir);
  await workflow.setVacancyPriority({ canonicalVacancyId: vacancyId, priority: "HIGH" });
  await workflow.addVacancyNote({
    canonicalVacancyId: vacancyId,
    requestId: randomUUID(),
    text: "Great engineering team in Toulouse.",
  });
  await workflow.setVacancyProcessState({
    canonicalVacancyId: vacancyId,
    requestId: randomUUID(),
    state: "APPLIED",
  });
  await workflow.recordVacancyReviewAction({
    canonicalVacancyId: vacancyId,
    type: "APPLIED",
    occurredAt: new Date("2026-05-02T09:00:00.000Z"),
    requestId: randomUUID(),
  });

  const contactRes = workflow.contactCommand({
    operation: "CREATE",
    requestId: randomUUID(),
    displayName: "Claire Dupont",
    jobTitle: "Tech Recruiter",
    notes: "Met at career fair",
  });
  const contactId = contactRes.resultId;
  workflow.contactCommand({
    operation: "LINK",
    requestId: randomUUID(),
    contactId,
    canonicalVacancyId: vacancyId,
    role: "RECRUITER",
  });

  await workflow.createVacancyNextAction({
    canonicalVacancyId: vacancyId,
    requestId: randomUUID(),
    description: "Follow up with Claire",
    dueAt: "2026-05-10T10:00:00.000Z",
    contactId,
  });

  const docBytes = Buffer.from("%PDF-1.4\n%Mock CV content for backup portability test\n", "utf8");
  const docLibrary = workflow.importLibraryDocument({
    requestId: randomUUID(),
    kind: "CV",
    name: "Aerospace CV",
    originalFileName: "aerospace-cv.pdf",
    mediaType: "application/pdf",
    bytes: docBytes,
  });
  const docId = docLibrary[0]!.id;
  const versionId = docLibrary[0]!.versions[0]!.id;

  await workflow.associateVacancyDocument({
    canonicalVacancyId: vacancyId,
    versionId,
    requestId: randomUUID(),
  });

  const cleanup = new SqliteVacancyCleanup(env.db);
  const cleanupState = cleanup.state(vacancyId);
  cleanup.setArchived(vacancyId, true, cleanupState.token);

  return { vacancyId, contactId, docId, versionId, docBytes };
}

describe("M22.1 Backup and Restore Foundation", () => {
  it("creates a valid backup archive with manifest, consistent DB snapshot, referenced documents, and excludes orphans & repo files", async () => {
    const env = createTestEnv();
    const seeded = await seedRichUserState(env);

    // Plant an orphan managed file that is NOT referenced in application_document_versions
    const orphanDir = join(env.docDir, "documents", randomUUID(), randomUUID());
    mkdirSync(orphanDir, { recursive: true });
    writeFileSync(join(orphanDir, "content"), Buffer.from("orphan-bytes"));

    const backupPath = join(env.backupDir, "test-backup.zip");
    const result = await env.service().createBackup({ destinationPath: backupPath });

    expect(existsSync(backupPath)).toBe(true);
    expect(result.destinationPath).toBe(backupPath);
    expect(result.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(result.documentCount).toBe(1);
    expect(result.fileCount).toBe(2); // database.sqlite + 1 document

    const entries = readZipArchive(readFileSync(backupPath));
    expect(entries.has("manifest.json")).toBe(true);
    expect(entries.has("database.sqlite")).toBe(true);
    const expectedDocKey = `documents/${seeded.docId}/${seeded.versionId}/content`;
    expect(entries.has(expectedDocKey)).toBe(true);
    expect(entries.get(expectedDocKey)!.equals(seeded.docBytes)).toBe(true);

    // Orphan and repo files must NOT be included
    expect(entries.size).toBe(3);
    expect(entries.has("package.json")).toBe(false);
    expect(Array.from(entries.keys()).some((k) => k.includes("node_modules"))).toBe(false);

    // DB snapshot opens and passes integrity_check
    const checkDbPath = join(env.rootDir, "check.sqlite");
    writeFileSync(checkDbPath, entries.get("database.sqlite")!);
    const checkDb = new Database(checkDbPath, { readonly: true });
    expect(checkDb.pragma("integrity_check", { simple: true })).toBe("ok");
    checkDb.close();

    // Validation passes
    const validation = await env.service().validateBackup({ archivePath: backupPath });
    expect(validation.valid).toBe(true);
    expect(validation.formatVersion).toBe(1);
    expect(validation.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(validation.documentCount).toBe(1);

    env.close();
  });

  it("fails backup clearly if a DB-referenced document file is missing and rejects backup destinations inside documentDataDir", async () => {
    const env = createTestEnv();
    const seeded = await seedRichUserState(env);

    await expect(
      env.service().createBackup({ destinationPath: join(env.docDir, "documents", "bad.zip") }),
    ).rejects.toThrow(/outside the managed application-document/iu);

    const docFile = join(env.docDir, "documents", seeded.docId, seeded.versionId, "content");
    rmSync(docFile);

    const dest = join(env.backupDir, "should-fail.zip");
    await expect(env.service().createBackup({ destinationPath: dest })).rejects.toThrow(/missing/iu);
    expect(existsSync(dest)).toBe(false);

    env.close();
  });

  it("rejects malformed manifest, unsupported format version, future schema version, missing/corrupt DB, missing/corrupt docs, unsafe paths, and resource limits", async () => {
    const env = createTestEnv();
    const seeded = await seedRichUserState(env);
    const validPath = join(env.backupDir, "valid.zip");
    await env.service().createBackup({ destinationPath: validPath });
    const validEntries = new Map(readZipArchive(readFileSync(validPath)));
    const validManifest = JSON.parse(validEntries.get("manifest.json")!.toString("utf8"));
    const docKey = `documents/${seeded.docId}/${seeded.versionId}/content`;

    const validateBytes = (bytes: Buffer) => env.service().validateBackup({ archiveBytes: bytes });

    // 1. Malformed manifest
    const malformed = new Map(validEntries);
    malformed.set("manifest.json", Buffer.from("{bad json"));
    expect((await validateBytes(createZipArchive(Array.from(malformed, ([name, data]) => ({ name, data }))))).valid).toBe(false);

    // 2. Unsupported backup format version
    const badFormatVer = new Map(validEntries);
    badFormatVer.set("manifest.json", Buffer.from(JSON.stringify({ ...validManifest, formatVersion: 99 })));
    const r2 = await validateBytes(createZipArchive(Array.from(badFormatVer, ([name, data]) => ({ name, data }))));
    expect(r2.valid).toBe(false);
    expect(r2.error).toMatch(/format version/iu);

    // 3. Future schema version
    const futureSchema = new Map(validEntries);
    futureSchema.set("manifest.json", Buffer.from(JSON.stringify({ ...validManifest, schemaVersion: CURRENT_SCHEMA_VERSION + 5 })));
    const r3 = await validateBytes(createZipArchive(Array.from(futureSchema, ([name, data]) => ({ name, data }))));
    expect(r3.valid).toBe(false);
    expect(r3.error).toMatch(/newer/iu);

    // 4. Missing DB
    const missingDb = new Map(validEntries);
    missingDb.delete("database.sqlite");
    expect((await validateBytes(createZipArchive(Array.from(missingDb, ([name, data]) => ({ name, data }))))).valid).toBe(false);

    // 5. Database checksum mismatch
    const alteredDb = new Map(validEntries);
    alteredDb.set("database.sqlite", Buffer.from("corrupted-sqlite-bytes"));
    const r5 = await validateBytes(createZipArchive(Array.from(alteredDb, ([name, data]) => ({ name, data }))));
    expect(r5.valid).toBe(false);
    expect(r5.error).toMatch(/checksum/iu);

    // 6. Missing managed document
    const missingDoc = new Map(validEntries);
    missingDoc.delete(docKey);
    expect((await validateBytes(createZipArchive(Array.from(missingDoc, ([name, data]) => ({ name, data }))))).valid).toBe(false);

    // 7. Modified document file (archive checksum mismatch)
    const modifiedDoc = new Map(validEntries);
    modifiedDoc.set(docKey, Buffer.from("tampered"));
    const r7 = await validateBytes(createZipArchive(Array.from(modifiedDoc, ([name, data]) => ({ name, data }))));
    expect(r7.valid).toBe(false);
    expect(r7.error).toMatch(/checksum/iu);

    // 8. DB/document hash disagreement (manifest checksum matches tampered bytes, but DB metadata disagrees)
    const tamperedBytes = Buffer.from("tampered-matching-manifest");
    const tamperedHash = createHash("sha256").update(tamperedBytes).digest("hex");
    const disagree = new Map(validEntries);
    disagree.set(docKey, tamperedBytes);
    disagree.set("manifest.json", Buffer.from(JSON.stringify({
      ...validManifest,
      checksums: { ...validManifest.checksums, [docKey]: tamperedHash },
    })));
    const r8 = await validateBytes(createZipArchive(Array.from(disagree, ([name, data]) => ({ name, data }))));
    expect(r8.valid).toBe(false);
    expect(r8.error).toMatch(/disagreement/iu);

    // 9. Unsafe archive path (Zip Slip)
    const zipWithTraversal = createZipArchive([
      ...Array.from(validEntries, ([name, data]) => ({ name, data })),
    ]);
    const patched = Buffer.from(zipWithTraversal.toString("binary").replaceAll("manifest.json", "../../evil.js"), "binary");
    const r9 = await validateBytes(patched);
    expect(r9.valid).toBe(false);
    expect(() => validateArchiveEntryPath("/etc/passwd")).toThrow();
    expect(() => validateArchiveEntryPath("C:\\Windows\\system.ini")).toThrow();
    expect(() => validateArchiveEntryPath("\\\\server\\share\\file")).toThrow();

    // 10. Resource limits (maxEntries)
    const limitedService = env.service({ zipLimits: { maxEntries: 1 } });
    const r10 = await limitedService.validateBackup({ archivePath: validPath });
    expect(r10.valid).toBe(false);
    expect(r10.error).toMatch(/maximum entry count/iu);

    env.close();
  });

  it("supports cross-root portability: backup from Root A restores into clean Root B preserving all CRM, contact, action, document, archive, and ID state", async () => {
    const rootA = createTestEnv("jn-root-a-");
    const seeded = await seedRichUserState(rootA);
    const backupPath = join(rootA.backupDir, "portable.zip");
    await rootA.service().createBackup({ destinationPath: backupPath });

    // Clean Root B with completely different directory
    const rootB = createTestEnv("jn-root-b-");
    const restoreResult = await rootB.service().restoreBackup({ archivePath: backupPath });
    expect(restoreResult.restored).toBe(true);
    expect(restoreResult.documentCount).toBe(1);
    expect(restoreResult.sourceSchemaVersion).toBe(CURRENT_SCHEMA_VERSION);

    const workflowB = createWorkflow(rootB.db, rootB.docDir);
    const reviewB = await workflowB.getVacancyReview(seeded.vacancyId);

    // Exact IDs & CRM state preserved
    expect(reviewB.vacancyContext.currentCanonicalVacancyId).toBe(seeded.vacancyId);
    expect(reviewB.crm?.priority).toBe("HIGH");
    expect(reviewB.crm?.processState).toBe("APPLIED");
    expect(reviewB.crm?.notes.some((n) => n.text === "Great engineering team in Toulouse.")).toBe(true);

    // Contacts & actions preserved
    const contactsB = workflowB.getContacts();
    expect(contactsB.some((c) => c.id === seeded.contactId && c.displayName === "Claire Dupont")).toBe(true);
    expect(reviewB.nextActions?.actions.some((a) => a.description === "Follow up with Claire" && a.contact?.id === seeded.contactId)).toBe(true);

    // Interactions & archive state preserved
    expect(reviewB.interactions?.some((e) => e.type === "APPLIED")).toBe(true);
    const cleanupB = new SqliteVacancyCleanup(rootB.db).state(seeded.vacancyId);
    expect(cleanupB.archived).toBe(true);

    // Documents, associations & download integrity preserved
    expect(reviewB.documents?.associations.some((a) => a.documentVersionId === seeded.versionId)).toBe(true);
    const downloaded = workflowB.getApplicationDocumentContent(seeded.versionId);
    expect(Buffer.from(downloaded.bytes).equals(seeded.docBytes)).toBe(true);

    rootA.close();
    rootB.close();
  });

  it("replaces rather than merges state, migrates older schemas forward, and rolls back cleanly on swap failure", async () => {
    const envA = createTestEnv("jn-replace-a-");
    const seededA = await seedRichUserState(envA);
    const backupA = join(envA.backupDir, "a.zip");
    await envA.service().createBackup({ destinationPath: backupA });

    // Root B has different existing data that must be REPLACED (not merged)
    const envB = createTestEnv("jn-replace-b-");
    const seededB = await seedRichUserState(envB);
    expect(seededB.vacancyId).not.toBe(seededA.vacancyId);

    // Failure injection during swap must rollback and preserve Root B's state
    await expect(
      envB.service({
        onSwapStep: (step) => {
          if (step === "afterMoveStagedDb") {
            throw new Error("Simulated disk failure during swap");
          }
        },
      }).restoreBackup({ archivePath: backupA }),
    ).rejects.toThrow("Simulated disk failure during swap");

    // Root B still has its original vacancy and document intact
    const workflowB = createWorkflow(envB.db, envB.docDir);
    const reviewBAfterFail = await workflowB.getVacancyReview(seededB.vacancyId);
    expect(reviewBAfterFail.vacancyContext.currentCanonicalVacancyId).toBe(seededB.vacancyId);
    expect(Buffer.from(workflowB.getApplicationDocumentContent(seededB.versionId).bytes).equals(seededB.docBytes)).toBe(true);

    // Now perform actual restore without failure injection
    const restoreRes = await envB.service().restoreBackup({ archivePath: backupA });
    expect(restoreRes.restored).toBe(true);
    expect(restoreRes.safetyBackupPath).not.toBeNull();
    expect(existsSync(restoreRes.safetyBackupPath!)).toBe(true);

    // Root B now has A's vacancy and NOT B's old vacancy
    const workflowBAfter = createWorkflow(envB.db, envB.docDir);
    expect((await workflowBAfter.getVacancyReview(seededA.vacancyId)).vacancyContext.currentCanonicalVacancyId).toBe(seededA.vacancyId);
    await expect(workflowBAfter.getVacancyReview(seededB.vacancyId)).rejects.toThrow();

    // Older schema backup (e.g. schemaVersion 17) migrates forward to 18 on restore
    const entries = new Map(readZipArchive(readFileSync(backupA)));
    const olderDbPath = join(envA.rootDir, "older.sqlite");
    writeFileSync(olderDbPath, entries.get("database.sqlite")!);
    const olderDb = new Database(olderDbPath);
    olderDb.exec("DROP TABLE interaction_requests; DROP TABLE action_contact_references; DROP TABLE interaction_contact_references; DELETE FROM schema_migrations WHERE version = 18");
    olderDb.close();
    const olderDbBytes = readFileSync(olderDbPath);
    const olderManifest = JSON.parse(entries.get("manifest.json")!.toString("utf8"));
    olderManifest.schemaVersion = 17;
    olderManifest.checksums["database.sqlite"] = createHash("sha256").update(olderDbBytes).digest("hex");
    entries.set("database.sqlite", olderDbBytes);
    entries.set("manifest.json", Buffer.from(JSON.stringify(olderManifest)));
    const olderZip = createZipArchive(Array.from(entries, ([name, data]) => ({ name, data })));

    const envC = createTestEnv("jn-migrate-c-");
    const migratedRestore = await envC.service().restoreBackup({ archiveBytes: olderZip });
    expect(migratedRestore.sourceSchemaVersion).toBe(17);
    expect(migratedRestore.currentSchemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    const maxVer = (envC.db.prepare("SELECT MAX(version) AS v FROM schema_migrations").get() as { v: number }).v;
    expect(maxVer).toBe(CURRENT_SCHEMA_VERSION);

    envA.close();
    envB.close();
    envC.close();
  });

  it("exposes /backup/create, /backup/validate, and /backup/restore HTTP endpoints with confirmation enforcement", async () => {
    const env = createTestEnv("jn-http-");
    await seedRichUserState(env);

    const server = createBrowserCaptureServer({
      backupService: env.service(),
      captureAndProcessBrowserVacancy: async () => {
        throw new Error("unused");
      },
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const address = server.address() as { port: number };
    const baseUrl = `http://127.0.0.1:${address.port}`;

    try {
      const createRes = await fetch(`${baseUrl}/backup/create`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      expect(createRes.status).toBe(201);
      const created = (await createRes.json()) as { backup: { destinationPath: string } };
      expect(existsSync(created.backup.destinationPath)).toBe(true);

      const valRes = await fetch(`${baseUrl}/backup/validate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ archivePath: created.backup.destinationPath }),
      });
      expect(valRes.status).toBe(200);
      const valBody = (await valRes.json()) as { validation: { valid: boolean } };
      expect(valBody.validation.valid).toBe(true);

      const unconfirmedRes = await fetch(`${baseUrl}/backup/restore`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ archivePath: created.backup.destinationPath }),
      });
      expect(unconfirmedRes.status).toBe(400);

      const confirmedRes = await fetch(`${baseUrl}/backup/restore`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ archivePath: created.backup.destinationPath, confirm: true }),
      });
      expect(confirmedRes.status).toBe(200);
      const restoreBody = (await confirmedRes.json()) as { restore: { restored: boolean; requiresReload: boolean } };
      expect(restoreBody.restore.restored).toBe(true);
      expect(restoreBody.restore.requiresReload).toBe(true);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      env.close();
    }
  });
});
