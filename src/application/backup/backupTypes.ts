export const BACKUP_FORMAT = "job-nearby-backup" as const;
export const BACKUP_FORMAT_VERSION = 1 as const;

export interface BackupManifest {
  readonly format: typeof BACKUP_FORMAT;
  readonly formatVersion: number;
  readonly createdAt: string;
  readonly applicationVersion: string;
  readonly schemaVersion: number;
  readonly databaseFile: string;
  readonly documentRoot: string;
  readonly fileCount: number;
  readonly documentCount: number;
  readonly checksums: Readonly<Record<string, string>>;
}

export interface CreateBackupResult {
  readonly destinationPath: string;
  readonly createdAt: string;
  readonly formatVersion: number;
  readonly schemaVersion: number;
  readonly documentCount: number;
  readonly fileCount: number;
  readonly manifest: BackupManifest;
}

export interface BackupValidationResult {
  readonly valid: boolean;
  readonly format?: string;
  readonly formatVersion?: number;
  readonly createdAt?: string;
  readonly applicationVersion?: string;
  readonly schemaVersion?: number;
  readonly documentCount?: number;
  readonly fileCount?: number;
  readonly error?: string;
}

export interface RestoreBackupResult {
  readonly restored: true;
  readonly createdAt: string;
  readonly formatVersion: number;
  readonly sourceSchemaVersion: number;
  readonly currentSchemaVersion: number;
  readonly documentCount: number;
  readonly safetyBackupPath: string | null;
  readonly requiresReload: boolean;
}

export type BackupArchiveInput =
  | { readonly archivePath: string }
  | { readonly archiveBytes: Uint8Array };

export interface BackupService {
  createBackup(input?: { readonly destinationPath?: string }): Promise<CreateBackupResult>;
  validateBackup(input: BackupArchiveInput): Promise<BackupValidationResult>;
  restoreBackup(
    input: BackupArchiveInput,
    options?: { readonly createSafetyBackup?: boolean },
  ): Promise<RestoreBackupResult>;
}
