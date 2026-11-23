import { useState } from "react";
import {
  createBackup,
  getExtensionPairingToken,
  exportUserData,
  restoreBackup,
  validateBackup,
  type BackupValidationResult,
  type CreateBackupResult,
  type ExportUserDataResult,
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

function triggerDownload(base64: string, fileName: string, mimeType: string) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  const blob = new Blob([bytes], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
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

  const [exportDestination, setExportDestination] = useState("");
  const [exporting, setExporting] = useState<"json" | "csv" | null>(null);
  const [exportResult, setExportResult] = useState<ExportUserDataResult | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [pairingToken, setPairingToken] = useState<string | null>(null);
  const [pairingError, setPairingError] = useState<string | null>(null);

  async function handleShowPairingCode() {
    setPairingError(null);
    try {
      setPairingToken(await getExtensionPairingToken());
    } catch (error) {
      setPairingError(error instanceof Error ? error.message : "Unable to read the pairing code.");
    }
  }

  async function handleExport(format: "json" | "csv") {
    setExporting(format);
    setExportError(null);
    setExportResult(null);
    try {
      const response = await exportUserData(format, exportDestination.trim() || undefined);
      setExportResult(response.export);
      if (response.contentBase64) {
        triggerDownload(response.contentBase64, response.export.fileName, response.export.mimeType);
      }
    } catch (error) {
      setExportError(error instanceof Error ? error.message : "Failed to export user data.");
    } finally {
      setExporting(null);
    }
  }

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

      <section aria-label="Data Export">
        <h2>Data Export</h2>
        <p>
          Export your CRM data in human-readable JSON or spreadsheet-friendly CSV (ZIP package)
          formats, including archived items. Managed document binary files are not included in
          exports.
        </p>
        <p>
          <strong>Important:</strong> JSON/CSV exports cannot be used as Job Nearby backups. For
          exact restore, use Backup &amp; Restore above.
        </p>
        <p role="note">
          Privacy notice: Exported files may contain personal notes, contact details, interaction
          history, and job-search information. Store them securely.
        </p>
        <label>
          Export file path (optional)
          <input
            type="text"
            placeholder="Leave blank to download in browser"
            value={exportDestination}
            disabled={exporting !== null}
            onChange={(e) => setExportDestination(e.target.value)}
          />
        </label>
        <div>
          <button
            type="button"
            disabled={exporting !== null}
            onClick={() => void handleExport("json")}
          >
            {exporting === "json" ? "Exporting JSON..." : "Export JSON"}
          </button>
          <button
            type="button"
            disabled={exporting !== null}
            onClick={() => void handleExport("csv")}
          >
            {exporting === "csv" ? "Exporting CSV package..." : "Export CSV package"}
          </button>
        </div>
        {exportError && <p role="alert">{exportError}</p>}
        {exportResult && (
          <div role="status" aria-label="Export summary">
            <p>Export completed ({exportResult.format.toUpperCase()}).</p>
            {exportResult.destinationPath ? (
              <p>Saved to: <code>{exportResult.destinationPath}</code></p>
            ) : (
              <p>File: <code>{exportResult.fileName}</code></p>
            )}
            <ul>
              <li>Vacancies: {exportResult.counts.vacancies}</li>
              <li>Notes: {exportResult.counts.notes}</li>
              <li>Interactions: {exportResult.counts.interactions}</li>
              <li>Actions: {exportResult.counts.actions}</li>
              <li>Contacts: {exportResult.counts.contacts}</li>
              <li>Documents: {exportResult.counts.documents}</li>
            </ul>
          </div>
        )}
      </section>
      <section aria-label="Browser extension connection">
        <h2>Browser extension</h2>
        <p>
          The optional capture extension must be paired with this desktop session. Open the
          extension popup, paste the pairing code, and keep Job Nearby running.
        </p>
        <button type="button" onClick={() => void handleShowPairingCode()}>
          Show pairing code
        </button>
        {pairingError && <p role="alert">{pairingError}</p>}
        {pairingToken && (
          <div role="status" aria-label="Extension pairing code">
            <p>Pairing code for this desktop session:</p>
            <code>{pairingToken}</code>
            <p>This code is secret. Do not share it or put it in screenshots.</p>
          </div>
        )}
      </section>
    </main>
  );
}
