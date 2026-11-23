"use strict";

// Repository hygiene gate for a future public source release.
//
// Reads the tracked-file list from stdin so it never shells out:
//   git ls-files | node tools/checkRepositoryHygiene.cjs
//
// It rejects generated/private artifacts that must never be committed and flags
// high-confidence secrets in tracked text files (reporting path and category only).

const { existsSync, readFileSync, statSync } = require("node:fs");
const path = require("node:path");

const FORBIDDEN_PREFIXES = [
  ["node_modules/", "dependency directory"],
  ["release/", "generated installer/release output"],
  ["dist/", "generated backend build output"],
  ["ui/dist/", "generated UI build output"],
  ["coverage/", "generated coverage output"],
  ["db-archive/", "local database archive"],
  ["backups/", "local backup archive"],
  ["exports/", "local user-data export"],
  ["managed-documents/", "managed user-document store"],
  [".agent-cache/", "local agent/tool cache"],
];

const FORBIDDEN_EXTENSIONS = new Map([
  [".sqlite", "local SQLite database"],
  [".sqlite-wal", "SQLite write-ahead log"],
  [".sqlite-shm", "SQLite shared-memory file"],
  [".db", "local database"],
  [".db-wal", "database write-ahead log"],
  [".db-shm", "database shared-memory file"],
  [".log", "log file"],
  [".zip", "archive (backup/export)"],
  [".7z", "archive"],
  [".rar", "archive"],
  [".exe", "executable binary"],
  [".dll", "native binary"],
  [".node", "native addon binary"],
  [".asar", "packed application archive"],
  [".har", "captured browser traffic"],
]);

const SECRET_PATTERNS = [
  [/-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/u, "private key block"],
  [/\bAKIA[0-9A-Z]{16}\b/u, "AWS access key id"],
  [/\bgh[pousr]_[A-Za-z0-9]{20,}\b/u, "GitHub token"],
  [/\bxox[baprs]-[A-Za-z0-9-]{10,}/u, "Slack token"],
  [/\bnpm_[A-Za-z0-9]{36}\b/u, "npm token"],
  [/\bsk-[A-Za-z0-9]{20,}\b/u, "API key"],
];

const MAX_SCANNED_BYTES = 5 * 1024 * 1024;

function normalizeTrackedPath(filePath) {
  return String(filePath ?? "").trim().replace(/\\/gu, "/").replace(/^\.\//u, "");
}

// Returns { category, reason } when a tracked path must not be committed.
function classifyTrackedPath(filePath) {
  const normalized = normalizeTrackedPath(filePath);
  if (!normalized) return null;
  for (const [prefix, reason] of FORBIDDEN_PREFIXES) {
    if (normalized.startsWith(prefix)) return { category: "forbidden-directory", reason };
  }
  const base = normalized.split("/").pop() ?? normalized;
  if (/(?:^|[-_.])(?:diagnostic|dump)(?:[-_.]|$)/iu.test(base)) {
    return { category: "diagnostic-dump", reason: "diagnostic dump or database export" };
  }
  const extension = path.extname(base).toLowerCase();
  const extensionReason = FORBIDDEN_EXTENSIONS.get(extension);
  if (extensionReason) return { category: "forbidden-extension", reason: extensionReason };
  return null;
}

function looksBinary(buffer) {
  const sample = buffer.subarray(0, 8192);
  return sample.includes(0);
}

// Returns { line, category } of the first high-confidence secret match, if any.
function findSecret(content) {
  const lines = content.split(/\r?\n/u);
  for (let index = 0; index < lines.length; index += 1) {
    for (const [pattern, category] of SECRET_PATTERNS) {
      if (pattern.test(lines[index])) return { line: index + 1, category };
    }
  }
  return null;
}

function checkTrackedFiles(rootDir, files) {
  const findings = [];
  for (const file of files) {
    const classified = classifyTrackedPath(file);
    if (classified) {
      findings.push({ path: file, ...classified });
      continue;
    }
    if (/\.(?:png|jpe?g|gif|ico|woff2?|ttf|otf|pdf)$/iu.test(file)) continue;
    const absolute = path.join(rootDir, file);
    let stats;
    try {
      stats = statSync(absolute);
    } catch {
      continue;
    }
    if (!stats.isFile() || stats.size > MAX_SCANNED_BYTES) continue;
    const buffer = readFileSync(absolute);
    if (looksBinary(buffer)) continue;
    const secret = findSecret(buffer.toString("utf8"));
    if (secret) findings.push({ path: file, category: `possible-secret:${secret.category}`, reason: `line ${secret.line}` });
  }
  return findings;
}

function main() {
  if (process.stdin.isTTY) {
    process.stderr.write("Usage: git ls-files | node tools/checkRepositoryHygiene.cjs\n");
    return 2;
  }
  const chunks = [];
  process.stdin.on("data", (chunk) => chunks.push(chunk));
  process.stdin.on("end", () => {
    const root = path.resolve(__dirname, "..");
    const files = Buffer.concat(chunks)
      .toString("utf8")
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter(Boolean)
      // A path removed from the working tree but not yet committed is absent from this
      // checkout; `git status` already reports that pending change.
      .filter((file) => existsSync(path.join(root, file)));
    const findings = checkTrackedFiles(root, files);
    process.stdout.write(`Repository hygiene: ${files.length} tracked files checked\n`);
    if (findings.length === 0) {
      process.stdout.write("No generated artifacts, local data, or high-confidence secrets found in tracked files.\n");
      return;
    }
    for (const finding of findings) {
      process.stdout.write(`FAIL ${finding.path}: ${finding.category} (${finding.reason})\n`);
    }
    process.exitCode = 1;
  });
  return undefined;
}

if (require.main === module) {
  const code = main();
  if (typeof code === "number") process.exitCode = code;
}

module.exports = { checkTrackedFiles, classifyTrackedPath, findSecret, normalizeTrackedPath };
