import { createHash } from "node:crypto";
import {
  closeSync,
  copyFileSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import Database from "better-sqlite3";

import {
  BACKUP_FORMAT,
  BACKUP_FORMAT_VERSION,
  type BackupArchiveInput,
  type BackupManifest,
  type BackupService,
  type BackupValidationResult,
  type CreateBackupResult,
  type RestoreBackupResult,
} from "../../application/backup/backupTypes.js";
import { CURRENT_SCHEMA_VERSION, migrateDatabase } from "../database/migrateDatabase.js";
import {
  assertSafeBackupDestination,
  defaultBackupFileName,
} from "../storage/applicationDataPaths.js";
import { createZipArchive, readZipArchive, type ZipLimits } from "./zipArchive.js";

const MAX_MANIFEST_BYTES = 2 * 1024 * 1024;
const UUID_RE = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const DOCUMENT_KEY_RE = new RegExp(`^documents/(${UUID_RE})/(${UUID_RE})/content$`, "u");
const SHA256_HEX_RE = /^[0-9a-f]{64}$/u;

export interface LocalBackupServiceConfig {
  readonly getDatabase: () => Database.Database;
  readonly databasePath: string;
  readonly documentDataDir: string;
  readonly defaultBackupDir: string;
  readonly applicationVersion?: string;
  readonly temporaryRoot?: string;
  readonly zipLimits?: ZipLimits;
  readonly now?: () => Date;
  readonly beforeSwap?: () => void | Promise<void>;
  readonly afterSwap?: () => void | Promise<void>;
  readonly onSwapStep?: (
    step: "beforeMoveLiveDb" | "beforeMoveLiveDocs" | "afterMoveStagedDb" | "beforeReopen",
  ) => void;
}

interface DocumentVersionInventoryRow {
  readonly id: string;
  readonly document_id: string;
  readonly storage_key: string;
  readonly size_bytes: number;
  readonly content_hash: string;
}

export class BackupError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404 | 409 | 500 = 400,
  ) {
    super(message);
  }
}

function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function writeFileAtomically(targetPath: string, bytes: Uint8Array): void {
  const targetDir = dirname(targetPath);
  mkdirSync(targetDir, { recursive: true, mode: 0o700 });
  const stageDir = mkdtempSync(join(targetDir, ".backup-stage-"));
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

function moveFileSafe(sourcePath: string, destPath: string): void {
  mkdirSync(dirname(destPath), { recursive: true, mode: 0o700 });
  try {
    renameSync(sourcePath, destPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EXDEV") {
      throw error;
    }
    const bytes = readFileSync(sourcePath);
    writeFileAtomically(destPath, bytes);
    rmSync(sourcePath, { force: true });
  }
}

function moveDirectorySafe(sourceDir: string, destDir: string): void {
  mkdirSync(dirname(destDir), { recursive: true, mode: 0o700 });
  try {
    renameSync(sourceDir, destDir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EXDEV") {
      throw error;
    }
    copyDirRecursive(sourceDir, destDir);
    rmSync(sourceDir, { recursive: true, force: true });
  }
}

function copyDirRecursive(sourceDir: string, destDir: string): void {
  const { readdirSync } = require("node:fs") as typeof import("node:fs");
  mkdirSync(destDir, { recursive: true, mode: 0o700 });
  for (const entry of readdirSync(sourceDir, { withFileTypes: true })) {
    const src = join(sourceDir, entry.name);
    const dst = join(destDir, entry.name);
    if (entry.isSymbolicLink()) {
      throw new BackupError("Symbolic links are not permitted in managed document storage.", 409);
    }
    if (entry.isDirectory()) {
      copyDirRecursive(src, dst);
    } else if (entry.isFile()) {
      copyFileSync(src, dst);
    }
  }
}

function readArchiveBytes(input: BackupArchiveInput): Uint8Array {
  if ("archiveBytes" in input) {
    return input.archiveBytes;
  }
  const resolved = resolve(input.archivePath);
  if (!existsSync(resolved)) {
    throw new BackupError(`Backup archive not found: ${resolved}`, 404);
  }
  const stat = lstatSync(resolved);
  if (!stat.isFile()) {
    throw new BackupError("Backup archive path must be a regular file.", 400);
  }
  return readFileSync(resolved);
}

function parseAndValidateManifest(rawBytes: Buffer): BackupManifest {
  if (rawBytes.length > MAX_MANIFEST_BYTES) {
    throw new BackupError("Backup manifest exceeds maximum allowed size.", 400);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBytes.toString("utf8"));
  } catch {
    throw new BackupError("Malformed backup manifest JSON.", 400);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new BackupError("Backup manifest must be a JSON object.", 400);
  }
  const record = parsed as Record<string, unknown>;
  if (record.format !== BACKUP_FORMAT) {
    throw new BackupError(`Unsupported backup format: ${String(record.format)}.`, 400);
  }
  if (record.formatVersion !== BACKUP_FORMAT_VERSION) {
    throw new BackupError(
      `Unsupported backup format version: ${String(record.formatVersion)}. Supported version: ${BACKUP_FORMAT_VERSION}.`,
      400,
    );
  }
  if (typeof record.createdAt !== "string" || Number.isNaN(Date.parse(record.createdAt))) {
    throw new BackupError("Backup manifest has invalid createdAt timestamp.", 400);
  }
  if (typeof record.applicationVersion !== "string" || !record.applicationVersion.trim()) {
    throw new BackupError("Backup manifest has invalid applicationVersion.", 400);
  }
  if (
    typeof record.schemaVersion !== "number" ||
    !Number.isInteger(record.schemaVersion) ||
    record.schemaVersion < 1
  ) {
    throw new BackupError("Backup manifest has invalid schemaVersion.", 400);
  }
  if (record.schemaVersion > CURRENT_SCHEMA_VERSION) {
    throw new BackupError(
      `Backup schema version ${record.schemaVersion} is newer than supported application schema version ${CURRENT_SCHEMA_VERSION}. Update Job Nearby before restoring.`,
      409,
    );
  }
  if (record.databaseFile !== "database.sqlite") {
    throw new BackupError("Backup manifest specifies unsupported databaseFile.", 400);
  }
  if (record.documentRoot !== "documents/") {
    throw new BackupError("Backup manifest specifies unsupported documentRoot.", 400);
  }
  if (
    typeof record.fileCount !== "number" ||
    !Number.isInteger(record.fileCount) ||
    record.fileCount < 1
  ) {
    throw new BackupError("Backup manifest has invalid fileCount.", 400);
  }
  if (
    typeof record.documentCount !== "number" ||
    !Number.isInteger(record.documentCount) ||
    record.documentCount < 0
  ) {
    throw new BackupError("Backup manifest has invalid documentCount.", 400);
  }
  if (!record.checksums || typeof record.checksums !== "object" || Array.isArray(record.checksums)) {
    throw new BackupError("Backup manifest is missing checksums.", 400);
  }
  const checksums = record.checksums as Record<string, unknown>;
  for (const [key, value] of Object.entries(checksums)) {
    if (typeof value !== "string" || !SHA256_HEX_RE.test(value)) {
      throw new BackupError(`Invalid SHA-256 checksum entry for "${key}".`, 400);
    }
  }
  return record as unknown as BackupManifest;
}

function querySchemaVersion(db: Database.Database): number {
  const hasTable = db
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'")
    .get();
  if (!hasTable) {
    throw new BackupError("Database snapshot is missing schema_migrations table.", 400);
  }
  const row = db
    .prepare("SELECT MAX(version) AS version FROM schema_migrations")
    .get() as { version: number | null } | undefined;
  if (!row || typeof row.version !== "number" || !Number.isInteger(row.version) || row.version < 1) {
    throw new BackupError("Database snapshot has no valid schema migration version.", 400);
  }
  return row.version;
}

function queryReferencedDocuments(db: Database.Database): readonly DocumentVersionInventoryRow[] {
  const hasTable = db
    .prepare(
      "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'application_document_versions'",
    )
    .get();
  if (!hasTable) {
    return [];
  }
  return db
    .prepare(
      "SELECT id, document_id, storage_key, size_bytes, content_hash FROM application_document_versions ORDER BY id",
    )
    .all() as DocumentVersionInventoryRow[];
}

export class LocalBackupService implements BackupService {
  private readonly applicationVersion: string;
  private readonly temporaryRoot: string;
  private readonly now: () => Date;

  constructor(private readonly config: LocalBackupServiceConfig) {
    this.applicationVersion = config.applicationVersion ?? "0.1.0";
    this.temporaryRoot = resolve(config.temporaryRoot ?? tmpdir());
    this.now = config.now ?? (() => new Date());
  }

  private createStagingDir(prefix: string): string {
    mkdirSync(this.temporaryRoot, { recursive: true, mode: 0o700 });
    return mkdtempSync(join(this.temporaryRoot, prefix));
  }

  async createBackup(input: { readonly destinationPath?: string } = {}): Promise<CreateBackupResult> {
    const createdAtDate = this.now();
    const createdAt = createdAtDate.toISOString();
    const requestedDest =
      input.destinationPath ??
      join(this.config.defaultBackupDir, defaultBackupFileName(createdAtDate));

    let destinationPath: string;
    try {
      destinationPath = assertSafeBackupDestination(requestedDest, this.config.documentDataDir);
    } catch (error) {
      throw new BackupError(error instanceof Error ? error.message : String(error), 400);
    }

    const stagingDir = this.createStagingDir("job-nearby-backup-create-");
    const stagedDbPath = join(stagingDir, "database.sqlite");

    try {
      const liveDb = this.config.getDatabase();
      await liveDb.backup(stagedDbPath);

      const snapshotDb = new Database(stagedDbPath, { readonly: true, fileMustExist: true });
      let schemaVersion: number;
      let docRows: readonly DocumentVersionInventoryRow[];
      try {
        const integrity = snapshotDb.pragma("integrity_check", { simple: true });
        if (integrity !== "ok") {
          throw new BackupError(`Database integrity check failed: ${String(integrity)}.`, 409);
        }
        schemaVersion = querySchemaVersion(snapshotDb);
        docRows = queryReferencedDocuments(snapshotDb);
      } finally {
        snapshotDb.close();
      }

      const dbBytes = readFileSync(stagedDbPath);
      const dbChecksum = sha256Hex(dbBytes);
      const checksums: Record<string, string> = {
        "database.sqlite": dbChecksum,
      };
      const zipEntries: { name: string; data: Uint8Array }[] = [
        { name: "database.sqlite", data: dbBytes },
      ];

      for (const docRow of docRows) {
        if (!DOCUMENT_KEY_RE.test(docRow.storage_key)) {
          throw new BackupError(
            `Database references invalid document storage key: "${docRow.storage_key}".`,
            409,
          );
        }
        const docFilePath = join(this.config.documentDataDir, ...docRow.storage_key.split("/"));
        if (!existsSync(docFilePath)) {
          throw new BackupError(
            `Referenced managed document file is missing: ${docRow.storage_key}.`,
            409,
          );
        }
        const stat = lstatSync(docFilePath);
        if (stat.isSymbolicLink() || !stat.isFile()) {
          throw new BackupError(
            `Referenced managed document is not a regular file: ${docRow.storage_key}.`,
            409,
          );
        }
        const docBytes = readFileSync(docFilePath);
        const docHash = sha256Hex(docBytes);
        if (docBytes.length !== docRow.size_bytes || docHash !== docRow.content_hash) {
          throw new BackupError(
            `Managed document integrity mismatch for ${docRow.storage_key}.`,
            409,
          );
        }
        checksums[docRow.storage_key] = docHash;
        zipEntries.push({ name: docRow.storage_key, data: docBytes });
      }

      const manifest: BackupManifest = {
        format: BACKUP_FORMAT,
        formatVersion: BACKUP_FORMAT_VERSION,
        createdAt,
        applicationVersion: this.applicationVersion,
        schemaVersion,
        databaseFile: "database.sqlite",
        documentRoot: "documents/",
        fileCount: zipEntries.length,
        documentCount: docRows.length,
        checksums,
      };

      const manifestBytes = Buffer.from(JSON.stringify(manifest, null, 2), "utf8");
      const archiveBuffer = createZipArchive([
        { name: "manifest.json", data: manifestBytes },
        ...zipEntries,
      ]);

      writeFileAtomically(destinationPath, archiveBuffer);

      return {
        destinationPath,
        createdAt,
        formatVersion: BACKUP_FORMAT_VERSION,
        schemaVersion,
        documentCount: docRows.length,
        fileCount: zipEntries.length,
        manifest,
      };
    } finally {
      rmSync(stagingDir, { recursive: true, force: true });
    }
  }

  private stageAndVerifyArchive(input: BackupArchiveInput): {
    stagingDir: string;
    stagedDbPath: string;
    stagedDocsDir: string;
    manifest: BackupManifest;
  } {
    const archiveBytes = readArchiveBytes(input);
    const entries = readZipArchive(archiveBytes, this.config.zipLimits);

    const manifestBytes = entries.get("manifest.json");
    if (!manifestBytes) {
      throw new BackupError("Backup archive is missing manifest.json.", 400);
    }
    const manifest = parseAndValidateManifest(manifestBytes);

    const dbBytes = entries.get(manifest.databaseFile);
    if (!dbBytes) {
      throw new BackupError(`Backup archive is missing ${manifest.databaseFile}.`, 400);
    }
    const expectedDbChecksum = manifest.checksums[manifest.databaseFile];
    if (!expectedDbChecksum || sha256Hex(dbBytes) !== expectedDbChecksum) {
      throw new BackupError("Backup database checksum verification failed.", 409);
    }

    const expectedChecksumKeys = Object.keys(manifest.checksums);
    if (expectedChecksumKeys.length !== manifest.fileCount) {
      throw new BackupError("Backup manifest fileCount does not match checksum entries.", 400);
    }
    for (const [key, expectedHash] of Object.entries(manifest.checksums)) {
      const fileBytes = entries.get(key);
      if (!fileBytes) {
        throw new BackupError(`Backup archive is missing file listed in manifest: ${key}.`, 400);
      }
      if (sha256Hex(fileBytes) !== expectedHash) {
        throw new BackupError(`Checksum verification failed for ${key}.`, 409);
      }
    }

    const stagingDir = this.createStagingDir("job-nearby-backup-stage-");
    const stagedDbPath = join(stagingDir, "database.sqlite");
    const stagedDocsDir = join(stagingDir, "documents-root");

    try {
      writeFileSync(stagedDbPath, dbBytes, { mode: 0o600 });

      const stagedDb = new Database(stagedDbPath, { readonly: true, fileMustExist: true });
      let dbSchemaVersion: number;
      let docRows: readonly DocumentVersionInventoryRow[];
      try {
        const integrity = stagedDb.pragma("integrity_check", { simple: true });
        if (integrity !== "ok") {
          throw new BackupError(`Backup database integrity check failed: ${String(integrity)}.`, 409);
        }
        dbSchemaVersion = querySchemaVersion(stagedDb);
        if (dbSchemaVersion > CURRENT_SCHEMA_VERSION) {
          throw new BackupError(
            `Backup database schema version ${dbSchemaVersion} is newer than supported version ${CURRENT_SCHEMA_VERSION}.`,
            409,
          );
        }
        if (dbSchemaVersion !== manifest.schemaVersion) {
          throw new BackupError(
            `Backup manifest schemaVersion (${manifest.schemaVersion}) does not match database schema (${dbSchemaVersion}).`,
            409,
          );
        }
        docRows = queryReferencedDocuments(stagedDb);
      } finally {
        stagedDb.close();
      }

      if (docRows.length !== manifest.documentCount) {
        throw new BackupError(
          `Backup manifest documentCount (${manifest.documentCount}) does not match database records (${docRows.length}).`,
          409,
        );
      }

      for (const docRow of docRows) {
        if (!DOCUMENT_KEY_RE.test(docRow.storage_key)) {
          throw new BackupError(`Invalid document storage key in backup DB: ${docRow.storage_key}.`, 409);
        }
        const docBytes = entries.get(docRow.storage_key);
        if (!docBytes) {
          throw new BackupError(`Backup archive is missing referenced document: ${docRow.storage_key}.`, 409);
        }
        if (docBytes.length !== docRow.size_bytes || sha256Hex(docBytes) !== docRow.content_hash) {
          throw new BackupError(
            `Document hash or size disagreement between DB metadata and archived bytes for ${docRow.storage_key}.`,
            409,
          );
        }
        const targetDocPath = join(stagedDocsDir, ...docRow.storage_key.split("/"));
        mkdirSync(dirname(targetDocPath), { recursive: true, mode: 0o700 });
        writeFileSync(targetDocPath, docBytes, { mode: 0o600 });
      }

      return { stagingDir, stagedDbPath, stagedDocsDir, manifest };
    } catch (error) {
      rmSync(stagingDir, { recursive: true, force: true });
      throw error;
    }
  }

  async validateBackup(input: BackupArchiveInput): Promise<BackupValidationResult> {
    let staged: ReturnType<LocalBackupService["stageAndVerifyArchive"]> | null = null;
    try {
      staged = this.stageAndVerifyArchive(input);
      return {
        valid: true,
        format: staged.manifest.format,
        formatVersion: staged.manifest.formatVersion,
        createdAt: staged.manifest.createdAt,
        applicationVersion: staged.manifest.applicationVersion,
        schemaVersion: staged.manifest.schemaVersion,
        documentCount: staged.manifest.documentCount,
        fileCount: staged.manifest.fileCount,
      };
    } catch (error) {
      return {
        valid: false,
        error: error instanceof Error ? error.message : String(error),
      };
    } finally {
      if (staged) {
        rmSync(staged.stagingDir, { recursive: true, force: true });
      }
    }
  }

  async restoreBackup(
    input: BackupArchiveInput,
    options: { readonly createSafetyBackup?: boolean } = {},
  ): Promise<RestoreBackupResult> {
    const staged = this.stageAndVerifyArchive(input);

    try {
      if (staged.manifest.schemaVersion < CURRENT_SCHEMA_VERSION) {
        const dbToMigrate = new Database(staged.stagedDbPath, { fileMustExist: true });
        try {
          dbToMigrate.pragma("foreign_keys = ON");
          migrateDatabase(dbToMigrate);
          const integrity = dbToMigrate.pragma("integrity_check", { simple: true });
          if (integrity !== "ok") {
            throw new BackupError(
              `Migrated backup database failed integrity check: ${String(integrity)}.`,
              409,
            );
          }
        } finally {
          dbToMigrate.close();
        }
      }

      let safetyBackupPath: string | null = null;
      if (options.createSafetyBackup !== false && existsSync(this.config.databasePath)) {
        const safetyName = defaultBackupFileName(this.now(), "pre-restore-backup");
        const safetyResult = await this.createBackup({
          destinationPath: join(this.config.defaultBackupDir, safetyName),
        });
        safetyBackupPath = safetyResult.destinationPath;
      }

      const liveDbPath = resolve(this.config.databasePath);
      const liveDocsRoot = join(resolve(this.config.documentDataDir), "documents");
      const stagedDocsTree = join(staged.stagedDocsDir, "documents");
      const rollbackDir = join(staged.stagingDir, "rollback");
      const rollbackDbPath = join(rollbackDir, "database.sqlite");
      const rollbackDocsDir = join(rollbackDir, "documents");
      const sidecarSuffixes = ["-wal", "-shm", "-journal"] as const;

      mkdirSync(rollbackDir, { recursive: true, mode: 0o700 });

      let movedLiveDb = false;
      let movedLiveDocs = false;
      let movedStagedDb = false;
      let movedStagedDocs = false;
      const movedSidecars: string[] = [];

      await this.config.beforeSwap?.();

      try {
        this.config.onSwapStep?.("beforeMoveLiveDb");
        if (existsSync(liveDbPath)) {
          moveFileSafe(liveDbPath, rollbackDbPath);
          movedLiveDb = true;
        }
        for (const suffix of sidecarSuffixes) {
          const sidecar = liveDbPath + suffix;
          if (existsSync(sidecar)) {
            moveFileSafe(sidecar, rollbackDbPath + suffix);
            movedSidecars.push(suffix);
          }
        }

        this.config.onSwapStep?.("beforeMoveLiveDocs");
        if (existsSync(liveDocsRoot)) {
          moveDirectorySafe(liveDocsRoot, rollbackDocsDir);
          movedLiveDocs = true;
        }

        moveFileSafe(staged.stagedDbPath, liveDbPath);
        movedStagedDb = true;
        this.config.onSwapStep?.("afterMoveStagedDb");

        if (existsSync(stagedDocsTree)) {
          moveDirectorySafe(stagedDocsTree, liveDocsRoot);
          movedStagedDocs = true;
        }

        this.config.onSwapStep?.("beforeReopen");
        await this.config.afterSwap?.();
      } catch (swapError) {
        try {
          if (movedStagedDocs && existsSync(liveDocsRoot)) {
            rmSync(liveDocsRoot, { recursive: true, force: true });
          }
          if (movedLiveDocs && existsSync(rollbackDocsDir)) {
            moveDirectorySafe(rollbackDocsDir, liveDocsRoot);
          }
          if (movedStagedDb && existsSync(liveDbPath)) {
            rmSync(liveDbPath, { force: true });
          }
          if (movedLiveDb && existsSync(rollbackDbPath)) {
            moveFileSafe(rollbackDbPath, liveDbPath);
          }
          for (const suffix of movedSidecars) {
            const savedSidecar = rollbackDbPath + suffix;
            if (existsSync(savedSidecar)) {
              moveFileSafe(savedSidecar, liveDbPath + suffix);
            }
          }
        } finally {
          await this.config.afterSwap?.();
        }
        throw swapError;
      }

      return {
        restored: true,
        createdAt: staged.manifest.createdAt,
        formatVersion: staged.manifest.formatVersion,
        sourceSchemaVersion: staged.manifest.schemaVersion,
        currentSchemaVersion: CURRENT_SCHEMA_VERSION,
        documentCount: staged.manifest.documentCount,
        safetyBackupPath,
        requiresReload: true,
      };
    } finally {
      rmSync(staged.stagingDir, { recursive: true, force: true });
    }
  }
}
