"use strict";

// Reachable-history hygiene gate for public publication (M24.4).
//
// This is recurrence prevention, not a history rewrite. It inspects the paths and
// blob sizes reachable from a ref using Git plumbing only: no worktree checkout, no
// file contents printed, and no database contents read.
//
//   npm run check:history
//
// Defaults to the current HEAD ancestry. Use `--ref refs/heads/main` to check a
// publishable branch explicitly.

const { execFileSync } = require("node:child_process");
const path = require("node:path");

const DEFAULT_MAX_BLOB_BYTES = 10 * 1024 * 1024;

// Paths that must never reappear in reachable history. Keep this narrow: it targets
// private application databases and diagnostic dumps, not ordinary SQL/database code.
const FORBIDDEN_PATHS = [
  { rule: "application-database", pattern: /(^|\/)job-nearby\.sqlite$/iu },
  { rule: "database-file", pattern: /\.sqlite$/iu },
  { rule: "database-file", pattern: /\.sqlite3$/iu },
  { rule: "database-file", pattern: /\.db$/iu },
  { rule: "database-wal", pattern: /\.db-wal$/iu },
  { rule: "database-shm", pattern: /\.db-shm$/iu },
  { rule: "diagnostic-dump", pattern: /(^|\/)linkedin-diagnostic\.txt$/iu },
  { rule: "diagnostic-dump", pattern: /-diagnostic\.txt$/iu },
  { rule: "diagnostic-dump", pattern: /(^|\/)(?:diagnostic|capture-dump|database-dump|debug-dump)[^/]*\.txt$/iu },
];

// Narrow, reviewable exceptions for deliberately synthetic fixtures. Each entry must
// name the path and why it is safe; the default set is empty.
const DEFAULT_ALLOWLIST = new Map();

function git(rootDir, args, input) {
  return execFileSync("git", ["-C", rootDir, ...args], {
    input,
    maxBuffer: 512 * 1024 * 1024,
  }).toString("utf8");
}

function forbiddenRuleFor(filePath) {
  for (const { rule, pattern } of FORBIDDEN_PATHS) {
    if (pattern.test(filePath)) return rule;
  }
  return undefined;
}

function scanHistory(options = {}) {
  const rootDir = path.resolve(options.rootDir ?? path.join(__dirname, ".."));
  const ref = options.ref ?? "HEAD";
  const maxBlobBytes = options.maxBlobBytes ?? DEFAULT_MAX_BLOB_BYTES;
  const allowlist = options.allowlist ?? DEFAULT_ALLOWLIST;
  const shaAllowlist = options.shaAllowlist ?? new Set();

  let commit;
  try {
    commit = git(rootDir, ["rev-parse", "--verify", `${ref}^{commit}`]).trim();
  } catch {
    return {
      ref,
      error: `cannot resolve ${ref} to a commit`,
      commits: 0,
      blobVersions: 0,
      findings: [],
      pass: false,
    };
  }

  const commits = Number(git(rootDir, ["rev-list", "--count", commit]).trim());
  const objectLines = git(rootDir, ["rev-list", "--objects", commit])
    .split(/\r?\n/u)
    .filter(Boolean);

  const pathBySha = new Map();
  const blobs = [];
  for (const line of objectLines) {
    const space = line.indexOf(" ");
    if (space < 0) continue; // commit/tree without a path
    const sha = line.slice(0, space);
    const filePath = line.slice(space + 1);
    if (filePath.length === 0) continue;
    if (!pathBySha.has(sha)) pathBySha.set(sha, filePath);
    blobs.push({ sha, path: filePath });
  }

  const uniqueShas = [...new Set(blobs.map((blob) => blob.sha))];
  const objectTypes = new Map();
  if (uniqueShas.length > 0) {
    const batch = git(
      rootDir,
      ["cat-file", "--batch-check=%(objectname) %(objecttype) %(objectsize)"],
      `${uniqueShas.join("\n")}\n`,
    )
      .split(/\r?\n/u)
      .filter(Boolean);
    for (const line of batch) {
      const [sha, type, size] = line.split(" ");
      objectTypes.set(sha, { type, size: Number(size) });
    }
  }

  const findings = [];
  const seenForbidden = new Set();
  const seenOversized = new Set();
  let blobVersions = 0;

  for (const blob of blobs) {
    const info = objectTypes.get(blob.sha);
    if (info === undefined || info.type !== "blob") continue;
    blobVersions += 1;
    const allowed = allowlist.get(blob.path);

    const rule = forbiddenRuleFor(blob.path);
    if (rule !== undefined && allowed === undefined && !seenForbidden.has(`${blob.path}:${rule}`)) {
      seenForbidden.add(`${blob.path}:${rule}`);
      findings.push({
        path: blob.path,
        rule,
        severity: "error",
        message: `forbidden path in reachable history (${rule})`,
      });
    }

    if (
      info.size > maxBlobBytes &&
      allowed === undefined &&
      !shaAllowlist.has(blob.sha) &&
      !seenOversized.has(blob.path)
    ) {
      seenOversized.add(blob.path);
      findings.push({
        path: blob.path,
        rule: "oversized-blob",
        severity: "error",
        message: `blob is ${Math.round(info.size / (1024 * 1024))} MB, above the ${Math.round(maxBlobBytes / (1024 * 1024))} MB limit`,
      });
    }
  }

  findings.sort((a, b) => (a.path === b.path ? a.rule.localeCompare(b.rule) : a.path.localeCompare(b.path)));

  return {
    ref,
    commit,
    commits,
    blobVersions,
    maxBlobBytes,
    findings,
    pass: findings.length === 0,
  };
}

function formatReport(result) {
  const lines = [];
  if (result.error !== undefined) {
    lines.push(`History hygiene: FAIL (${result.error})`);
    return `${lines.join("\n")}\n`;
  }
  lines.push(
    `History hygiene: ref ${result.ref} (${result.commits} commits, ${result.blobVersions} blob versions, limit ${Math.round(result.maxBlobBytes / (1024 * 1024))} MB)`,
  );
  for (const finding of result.findings) {
    lines.push(`FAIL ${finding.path}: ${finding.rule} (${finding.message})`);
  }
  if (result.pass) {
    lines.push("PASS no forbidden paths or oversized blobs in reachable history.");
  }
  return `${lines.join("\n")}\n`;
}

function main(argv) {
  const args = [...argv];
  if (args.includes("--help") || args.includes("-h")) {
    process.stdout.write("Usage: node tools/checkHistory.cjs [--ref <ref>] [--max-blob-bytes <n>] [--root <dir>] [--json]\n");
    return 0;
  }
  const readOption = (name) => {
    const index = args.indexOf(name);
    if (index < 0) return undefined;
    const value = args[index + 1];
    if (value === undefined) throw new Error(`${name} requires a value`);
    return value;
  };

  const result = scanHistory({
    rootDir: readOption("--root"),
    ref: readOption("--ref"),
    maxBlobBytes: readOption("--max-blob-bytes") === undefined ? undefined : Number(readOption("--max-blob-bytes")),
  });
  process.stdout.write(args.includes("--json") ? `${JSON.stringify(result, null, 2)}\n` : formatReport(result));
  return result.pass ? 0 : 1;
}

if (require.main === module) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`History hygiene: FAIL (${error.message})\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  DEFAULT_ALLOWLIST,
  DEFAULT_MAX_BLOB_BYTES,
  FORBIDDEN_PATHS,
  forbiddenRuleFor,
  formatReport,
  scanHistory,
};
