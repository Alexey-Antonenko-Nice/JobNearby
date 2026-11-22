import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BackupRestorePage } from "./BackupRestorePage";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("BackupRestorePage", () => {
  it("renders backup and restore sections and creates a backup", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          backup: {
            destinationPath: "C:/Users/demo/AppData/Local/JobNearby-Backups/backup.zip",
            createdAt: "2026-05-01T12:00:00.000Z",
            formatVersion: 1,
            schemaVersion: 18,
            documentCount: 2,
            fileCount: 3,
          },
        }),
        { status: 201, headers: { "Content-Type": "application/json" } },
      ),
    );

    render(<BackupRestorePage />);
    expect(screen.getByRole("heading", { name: /Backup & Restore/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Create backup" }));

    await waitFor(() => {
      expect(screen.getByText(/Backup created successfully/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/backup\.zip/)).toBeInTheDocument();
    expect(screen.getByText(/Schema version: 18/i)).toBeInTheDocument();
  });

  it("shows validation error for an invalid backup file", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          validation: {
            valid: false,
            error: "Backup database checksum verification failed.",
          },
        }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      ),
    );

    render(<BackupRestorePage />);
    const fileInput = screen.getByLabelText(/Select backup file/i);
    const file = new File([new Uint8Array([1, 2, 3])], "corrupt.zip", { type: "application/zip" });
    Object.defineProperty(file, "arrayBuffer", { value: async () => new Uint8Array([1, 2, 3]).buffer });

    fireEvent.change(fileInput, { target: { files: [file] } });

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("Backup database checksum verification failed.");
    });
    expect(screen.queryByRole("button", { name: "Restore backup" })).not.toBeInTheDocument();
  });

  it("shows manifest summary, requires confirmation, and communicates reload requirement after restore", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          validation: {
            valid: true,
            format: "job-nearby-backup",
            formatVersion: 1,
            createdAt: "2026-05-01T12:00:00.000Z",
            applicationVersion: "0.1.0",
            schemaVersion: 18,
            documentCount: 3,
            fileCount: 4,
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          restore: {
            restored: true,
            createdAt: "2026-05-01T12:00:00.000Z",
            formatVersion: 1,
            sourceSchemaVersion: 18,
            currentSchemaVersion: 18,
            documentCount: 3,
            safetyBackupPath: "C:/Backups/pre-restore.zip",
            requiresReload: true,
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    render(<BackupRestorePage />);
    const fileInput = screen.getByLabelText(/Select backup file/i);
    const file = new File([new Uint8Array([80, 75, 5, 6])], "good.zip", { type: "application/zip" });
    Object.defineProperty(file, "arrayBuffer", { value: async () => new Uint8Array([80, 75, 5, 6]).buffer });

    fireEvent.change(fileInput, { target: { files: [file] } });

    await waitFor(() => {
      expect(screen.getByText(/Backup summary/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/Format version: 1/i)).toBeInTheDocument();
    expect(screen.getByText(/Schema version: 18/i)).toBeInTheDocument();
    expect(screen.getByText(/Documents: 3/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Restore backup" }));
    const confirmButton = screen.getByRole("button", { name: "Confirm restore backup" });
    expect(confirmButton).toBeDisabled();

    fireEvent.click(screen.getByLabelText(/I understand that current Job Nearby data will be replaced/i));
    expect(confirmButton).toBeEnabled();

    fireEvent.click(confirmButton);

    await waitFor(() => {
      expect(screen.getByText(/Restore completed successfully/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/reload or restart/i)).toBeInTheDocument();
    expect(screen.getByText(/pre-restore\.zip/)).toBeInTheDocument();
  });
});
