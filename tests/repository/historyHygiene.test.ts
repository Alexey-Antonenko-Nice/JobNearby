import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { formatReport, scanHistory } from "../../tools/checkHistory.cjs";

const directories: string[] = [];

function git(dir: string, args: readonly string[]): string {
  return execFileSync("git", ["-C", dir, ...args], { encoding: "utf8" }).trim();
}

function makeRepository(): string {
  const dir = mkdtempSync(join(tmpdir(), "job-nearby-history-hygiene-"));
  directories.push(dir);
  git(dir, ["init", "-q"]);
  git(dir, ["config", "user.email", "test@example.test"]);
  git(dir, ["config", "user.name", "History Test"]);
  git(dir, ["config", "core.autocrlf", "false"]);
  return dir;
}

function commitFile(dir: string, relativePath: string, content: string, message = "add file"): string {
  const file = join(dir, relativePath);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content);
  git(dir, ["add", "--", relativePath]);
  git(dir, ["commit", "-q", "-m", message]);
  return git(dir, ["rev-parse", "HEAD"]);
}

afterEach(() => {
  while (directories.length > 0) {
    const dir = directories.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe("reachable history hygiene", () => {
  it("passes a clean synthetic history", () => {
    const dir = makeRepository();
    commitFile(dir, "src/app.ts", "export const ok = true;\n");
    commitFile(dir, "README.md", "# Synthetic\n");
    const result = scanHistory({ rootDir: dir });
    expect(result).toMatchObject({ pass: true, findings: [], commits: 2 });
    expect(result.blobVersions).toBe(2);
  });

  it("rejects a reachable application database", () => {
    const dir = makeRepository();
    commitFile(dir, "job-nearby.sqlite", "SQLite format 3\u0000 opaque");
    expect(scanHistory({ rootDir: dir }).findings).toContainEqual(
      expect.objectContaining({ path: "job-nearby.sqlite", rule: "application-database" }),
    );
  });

  it("rejects a reachable diagnostic dump", () => {
    const dir = makeRepository();
    commitFile(dir, "linkedin-diagnostic.txt", "captured state");
    expect(scanHistory({ rootDir: dir }).findings).toContainEqual(
      expect.objectContaining({ path: "linkedin-diagnostic.txt", rule: "diagnostic-dump" }),
    );
  });

  it("rejects WAL and SHM sidecars", () => {
    const dir = makeRepository();
    commitFile(dir, "history.db-wal", "wal");
    commitFile(dir, "history.db-shm", "shm");
    const rules = scanHistory({ rootDir: dir }).findings.map((finding) => finding.rule);
    expect(rules).toEqual(expect.arrayContaining(["database-wal", "database-shm"]));
  });

  it("allows ordinary source files that mention databases", () => {
    const dir = makeRepository();
    commitFile(dir, "src/infrastructure/database/repository.ts", "export const repository = {};\n");
    commitFile(dir, "docs/backup.md", "The database is stored per user.\n");
    expect(scanHistory({ rootDir: dir }).pass).toBe(true);
  });

  it("rejects an oversized blob above the configured limit", () => {
    const dir = makeRepository();
    commitFile(dir, "assets/large.bin", "x".repeat(4096));
    expect(scanHistory({ rootDir: dir, maxBlobBytes: 2048 }).findings).toContainEqual(
      expect.objectContaining({ path: "assets/large.bin", rule: "oversized-blob" }),
    );
  });

  it("allows an explicitly allowlisted oversized benign blob", () => {
    const dir = makeRepository();
    commitFile(dir, "assets/benign-large.bin", "x".repeat(4096));
    const result = scanHistory({
      rootDir: dir,
      maxBlobBytes: 2048,
      allowlist: new Map([["assets/benign-large.bin", "reviewed synthetic test asset"]]),
    });
    expect(result.pass).toBe(true);
  });

  it("never prints blob contents", () => {
    const dir = makeRepository();
    commitFile(dir, "job-nearby.sqlite", "TOP-SECRET-MARKER-123");
    const report = formatReport(scanHistory({ rootDir: dir }));
    expect(report).toContain("application-database");
    expect(report).not.toContain("TOP-SECRET-MARKER-123");
  });

  it("does not fail on a sensitive blob that is unreachable from the checked ref", () => {
    const dir = makeRepository();
    commitFile(dir, "src/app.ts", "export const ok = true;\n");
    const sensitiveCommit = commitFile(dir, "history.db", "SQLite format 3\u0000 opaque");
    const sensitiveSha = git(dir, ["rev-parse", `${sensitiveCommit}:history.db`]);
    git(dir, ["reset", "-q", "--hard", "HEAD~1"]);
    const objectStillPresent = () => {
      try {
        git(dir, ["cat-file", "-e", sensitiveSha]);
        return true;
      } catch {
        return false;
      }
    };
    expect(objectStillPresent()).toBe(true);
    expect(scanHistory({ rootDir: dir }).pass).toBe(true);
  });

  it("scans the requested ref rather than every local object", () => {
    const dir = makeRepository();
    commitFile(dir, "src/app.ts", "export const ok = true;\n");
    const baseBranch = git(dir, ["rev-parse", "--abbrev-ref", "HEAD"]);
    git(dir, ["checkout", "-q", "-b", "unsafe-history"]);
    commitFile(dir, "worker.db", "SQLite format 3\u0000 opaque");
    git(dir, ["checkout", "-q", baseBranch]);
    expect(scanHistory({ rootDir: dir, ref: baseBranch }).pass).toBe(true);
    expect(scanHistory({ rootDir: dir, ref: "unsafe-history" }).pass).toBe(false);
  });

  it("produces deterministic results", () => {
    const dir = makeRepository();
    commitFile(dir, "src/app.ts", "export const ok = true;\n");
    const first = JSON.stringify(scanHistory({ rootDir: dir }));
    const second = JSON.stringify(scanHistory({ rootDir: dir }));
    expect(second).toBe(first);
  });
});
