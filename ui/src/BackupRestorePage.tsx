import { useState } from "react";
import {
  createBackup,
  restoreBackup,
  validateBackup,
  type BackupValidationResult,
  type CreateBackupResult,
  type RestoreBackupResult,
} from "./api";

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function BackupRestorePage(): React.JSX.Element {
  const [destinationPath, setDestinationPath] = useState("");
  const [creating, setCreating] = useState(false);
  const [createResult, setCreateResult] = useState<CreateBackupResult | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);

  const [archiveBase64, setArchiveBase64] = useState<string | null>(null);
  const [selectedFileName, setSelectedFileName] = useState<string | null>(null);
  const [validating, setValidating] = useState(false);
  const [validation, setValidation] = useState<BackupValidationResult | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);

  const [confirmingRestore, setConfirmingRestore] = useState(false);
  const [confirmedReplace, setConfirmedReplace] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [restoreResult, setRestoreResult] = useState<RestoreBackupResult | null>(null);
  const [restoreError, setRestoreError] = useState<string | null>(null);

  async function handleCreateBackup(event: React.FormEvent) {
    event.preventDefault();
    setCreating(true);
    setCreateError(null);
    setCreateResult(null);
    try {
      const result = await createBackup(destinationPath.trim() || undefined);
      setCreateResult(result);
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : "Failed to create backup.");
    } finally {
      setCreating(false);
    }
  }

  async function handleFileSelect(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    setValidation(null);
    setValidationError(null);
    setRestoreResult(null);
    setRestoreError(null);
    setConfirmingRestore(false);
    setConfirmedReplace(false);
    if (!file) {
      setArchiveBase64(null);
      setSelectedFileName(null);
      return;
    }
    setSelectedFileName(file.name);
    setValidating(true);
    try {
      const buffer = new Uint8Array(await file.arrayBuffer());
      const base64 = toBase64(buffer);
      setArchiveBase64(base64);
      const result = await validateBackup({ archiveBase64: base64 });
      setValidation(result);
      if (!result.valid) {
        setValidationError(result.error ?? "Backup validation failed.");
      }
    } catch (error) {
      setValidationError(error instanceof Error ? error.message : "Unable to validate backup file.");
    } finally {
      setValidating(false);
    }
  }

  async function handleRestore() {
    if (!archiveBase64 || !validation?.valid || !confirmedReplace) return;
    setRestoring(true);
    setRestoreError(null);
    try {
      const result = await restoreBackup({ archiveBase64, confirm: true });
      setRestoreResult(result);
      setConfirmingRestore(false);
      setConfirmedReplace(false);
    } catch (error) {
      setRestoreError(error instanceof Error ? error.message : "Restore failed.");
    } finally {
      setRestoring(false);
    }
  }

  return (
    <main className="page">
      <nav>
        <a href="/today">Today</a> <a href="/">Inbox</a> <a href="/contacts">Contacts</a>{" "}
        <a href="/documents">Documents</a>
      </nav>
      <h1>Backup &amp; Restore</h1>
      <p>
        Whole-application backup and restore for your SQLite CRM database and managed application
        documents. Backup is for machine-restorable recovery, not user-data export or installation
        merging.
      </p>

      <section aria-label="Create backup">
        <h2>Create backup</h2>
        <form onSubmit={(e) => void handleCreateBackup(e)}>
          <label>
            Backup file path (optional)
            <input
              type="text"
              placeholder="Leave blank for default backup folder"
              value={destinationPath}
              disabled={creating}
              onChange={(e) => setDestinationPath(e.target.value)}
            />
          </label>
          <button type="submit" disabled={creating}>
            {creating ? "Creating backup..." : "Create backup"}
          </button>
        </form>
        {createError && <p role="alert">{createError}</p>}
        {createResult && (
          <div role="status">
            <p>Backup created successfully.</p>
            <p>File: <code>{createResult.destinationPath}</code></p>
            <p>Created: <time dateTime={createResult.createdAt}>{new Date(createResult.createdAt).toLocaleString()}</time></p>
            <p>Schema version: {createResult.schemaVersion} | Documents: {createResult.documentCount}</p>
          </div>
        )}
      </section>

      <section aria-label="Restore backup">
        <h2>Restore backup</h2>
        <p>
          Restoring replaces all current Job Nearby data with the selected backup. It does not
          merge two installations.
        </p>
        <label>
          Select backup file (.zip)
          <input
            type="file"
            accept=".zip,application/zip"
            disabled={validating || restoring}
            onChange={(e) => void handleFileSelect(e)}
          />
        </label>
        {selectedFileName && <p>Selected file: {selectedFileName}</p>}
        {validating && <p role="status">Validating backup...</p>}
        {validationError && <p role="alert">{validationError}</p>}

        {validation?.valid && (
          <div aria-label="Backup manifest summary">
            <h3>Backup summary</h3>
            <ul>
              <li>Format version: {validation.formatVersion}</li>
              <li>Schema version: {validation.schemaVersion}</li>
              <li>Documents: {validation.documentCount}</li>
              <li>Files in archive: {validation.fileCount}</li>
              {validation.createdAt && (
                <li>
                  Created:{" "}
                  <time dateTime={validation.createdAt}>
                    {new Date(validation.createdAt).toLocaleString()}
                  </time>
                </li>
              )}
            </ul>
            {!confirmingRestore && !restoreResult && (
              <button
                type="button"
                disabled={restoring}
                onClick={() => setConfirmingRestore(true)}
              >
                Restore backup
              </button>
            )}
          </div>
        )}

        {confirmingRestore && validation?.valid && (
          <div role="region" aria-label="Confirm restore">
            <p>
              Warning: Current Job Nearby data will be replaced with this backup. A pre-restore
              safety backup will be created automatically before replacing data. The application may
              reload afterward.
            </p>
            <label>
              <input
                type="checkbox"
                checked={confirmedReplace}
                disabled={restoring}
                onChange={(e) => setConfirmedReplace(e.target.checked)}
              />
              I understand that current Job Nearby data will be replaced.
            </label>
            <div>
              <button
                type="button"
                disabled={!confirmedReplace || restoring}
                onClick={() => void handleRestore()}
              >
                {restoring ? "Restoring..." : "Confirm restore backup"}
              </button>
              <button
                type="button"
                disabled={restoring}
                onClick={() => {
                  setConfirmingRestore(false);
                  setConfirmedReplace(false);
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {restoreError && <p role="alert">{restoreError}</p>}
        {restoreResult && (
          <div role="status">
            <p>
              Restore completed successfully. Please reload or restart the application to view the
              restored state.
            </p>
            {restoreResult.safetyBackupPath && (
              <p>Safety backup saved at: <code>{restoreResult.safetyBackupPath}</code></p>
            )}
          </div>
        )}
      </section>
    </main>
  );
}
