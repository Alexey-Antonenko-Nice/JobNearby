import { homedir, tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

import { documentDataDirectory } from "./documentDataDirectory.js";

export interface ApplicationDataPaths {
  readonly databasePath: string;
  readonly documentDataDir: string;
  readonly defaultBackupDir: string;
}

export function resolveApplicationDataPaths(options: {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  home?: string;
  repositoryRoot?: string;
  temporaryRoot?: string;
  databasePath?: string;
  documentDataDir?: string;
  defaultBackupDir?: string;
} = {}): ApplicationDataPaths {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const home = options.home ?? homedir();

  const resolvedDocumentDir = options.documentDataDir
    ? resolve(options.documentDataDir)
    : documentDataDirectory({
        platform,
        env,
        home,
        ...(options.repositoryRoot !== undefined ? { repositoryRoot: options.repositoryRoot } : {}),
        ...(options.temporaryRoot !== undefined ? { temporaryRoot: options.temporaryRoot } : {}),
      });

  const configuredDb = options.databasePath ?? env.JOB_NEARBY_DATABASE_PATH ?? "job-nearby.sqlite";
  const databasePath = resolve(configuredDb);

  const defaultBackupBase =
    options.defaultBackupDir ??
    env.JOB_NEARBY_BACKUP_DIR ??
    join(resolvedDocumentDir, "..", "JobNearby-Backups");
  const defaultBackupDir = resolve(defaultBackupBase);

  return {
    databasePath,
    documentDataDir: resolvedDocumentDir,
    defaultBackupDir,
  };
}

export function isPathInside(parentPath: string, candidatePath: string): boolean {
  const rel = relative(resolve(parentPath), resolve(candidatePath));
  return rel === "" || (rel !== ".." && !rel.startsWith(".." + sep) && !isAbsolute(rel));
}

export function assertSafeBackupDestination(
  destinationPath: string,
  documentDataDir: string,
): string {
  const resolvedDest = resolve(destinationPath);
  const managedDocsRoot = join(resolve(documentDataDir), "documents");
  if (isPathInside(managedDocsRoot, resolvedDest) || isPathInside(resolve(documentDataDir), resolvedDest)) {
    throw new Error("Backup destination must be outside the managed application-document data directory.");
  }
  return resolvedDest;
}

export function defaultBackupFileName(now: Date = new Date(), prefix = "job-nearby-backup"): string {
  const stamp = now.toISOString().replace(/[:.]/gu, "-");
  return `${prefix}-${stamp}.zip`;
}

export function tempDirectoryRoot(temporaryRoot?: string): string {
  return resolve(temporaryRoot ?? tmpdir());
}
