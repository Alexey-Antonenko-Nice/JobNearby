"use strict";

// Fixture-corpus hygiene gate for public repository content (M24.2).
//
// Fixtures are captured or reduced third-party page fragments. The corpus must
// stay minimal, inert and free of real personal/contact data, tracking parameters
// and account/session material. This checker makes the policy enforceable.
//
//   npm run check:fixtures
//
// Exit code 1 means a public-release blocker; warnings are accepted, documented
// exceptions that a reviewer must be able to see.

const { readdirSync, readFileSync, statSync } = require("node:fs");
const path = require("node:path");

const FIXTURE_DIRECTORY = path.join("tests", "fixtures");
const NORMAL_FIXTURE_BYTES = 100 * 1024;
const EXCEPTIONAL_FIXTURE_BYTES = 250 * 1024;

// Narrow, explicit exceptions. Each entry must name the rule it exempts and why.
const FIXTURE_ALLOWLIST = new Map([
  [
    "linkedinSearchResultsWestinghouse.html",
    {
      rule: "oversize",
      reason:
        "Preserves the matching-link search-results pane hierarchy (competing cards and detail wrapper) needed for selected-pane isolation; reduced from 291 KB to under the 250 KB exceptional budget.",
    },
  ],
  [
    "franceTravailRenderedDetail.html",
    {
      rule: "oversize",
      reason:
        "Rendered/unrendered comparison needs the France Travail detail shell; scripts, styles and long prose removed.",
    },
  ],
  [
    "franceTravailUnrenderedDetail.html",
    {
      rule: "oversize",
      reason:
        "Unrendered counterpart of the France Travail detail fixture; scripts, styles and long prose removed.",
    },
  ],
  [
    "randstadSingleSalaryVacancy.html",
    {
      rule: "oversize",
      reason:
        "Retains the Randstad single-salary markup and its competing salary blocks; scripts, styles and long prose removed.",
    },
  ],
]);

const FORBIDDEN_FILE_EXTENSIONS = new Map([
  [".sqlite", "tracked SQLite database"],
  [".sqlite3", "tracked SQLite database"],
  [".db", "tracked database file"],
  [".dump", "tracked database dump"],
  [".bak", "tracked backup file"],
]);

const DOCUMENT_EXTENSIONS = new Map([
  [".pdf", "PDF document"],
  [".doc", "Word document"],
  [".docx", "Word document"],
  [".rtf", "rich-text document"],
]);

const RESERVED_EMAIL = /@(?:[a-z0-9-]+\.)*example\.(?:test|com|org|net)$/iu;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/gu;

// Separator-style French numbers only; this avoids SVG paths, decimals and hashes.
const PHONE = /(?:\+33[ .-]?[1-9](?:[ .-]?\d{2}){4})|(?:0[1-9](?:[ .-]\d{2}){4})/gu;
const SYNTHETIC_PHONE = /^(?:\+33[ .-]?[1-9](?:[ .-]?0{2}){4})|(?:0[1-9](?:[ .-]0{2}){4})$/u;

const TRACKING_PARAMETER =
  /[?&](?:utm_[a-z]+|gclid|fbclid|msclkid|acatk|alid|camk|xkcb|xpse|xfps|advn|adid|ad|tk|from|ikw|isid|trk|trackingid|sessionid|sid|continue|referrer|origin|origintolandingjobpostings|f_tpr|mid|vid|vids|uach|referenceid|upsellorderorigin|upsellslotid)=/iu;

const SESSION_MATERIAL = /(?:set-cookie\s*:|authorization\s*:\s*bearer|bearer\s+[a-z0-9._~+/=-]{20,}|csrf[-_]?token\s*[=:]|document\.cookie)/iu;

const SECRET_PATTERNS = [
  [/-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/u, "private key block"],
  [/\bAKIA[0-9A-Z]{16}\b/u, "AWS access key id"],
  [/\bgh[pousr]_[A-Za-z0-9]{20,}\b/u, "GitHub token"],
  [/\bxox[baprs]-[A-Za-z0-9-]{10,}/u, "Slack token"],
  [/\bnpm_[A-Za-z0-9]{36}\b/u, "npm token"],
  [/\bsk-[A-Za-z0-9]{20,}\b/u, "API key"],
];

const NON_JSON_LD_SCRIPT = /<script\b(?![^>]*\btype\s*=\s*["']application\/ld\+json["'])[^>]*>/iu;

function listFixtureFiles(rootDir) {
  const fixtureDir = path.join(rootDir, FIXTURE_DIRECTORY);
  const out = [];
  const walk = (directory, prefix) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const relative = prefix.length === 0 ? entry.name : `${prefix}/${entry.name}`;
      if (entry.isDirectory()) walk(path.join(directory, entry.name), relative);
      else if (entry.isFile()) out.push(relative);
    }
  };
  walk(fixtureDir, "");
  return out.sort();
}

function isAllowlisted(file, rule) {
  return FIXTURE_ALLOWLIST.get(file)?.rule === rule;
}

function scanFixture(file, bytes, content) {
  const findings = [];
  const lower = content.toLowerCase();
  const report = (rule, severity, message) => findings.push({ path: `${FIXTURE_DIRECTORY}/${file}`, rule, severity, message });

  const extension = path.extname(file).toLowerCase();
  const forbidden = FORBIDDEN_FILE_EXTENSIONS.get(extension);
  if (forbidden) report("tracked-database", "error", forbidden);
  if (DOCUMENT_EXTENSIONS.has(extension) && !file.toLowerCase().startsWith("synthetic-")) {
    report("document-fixture", "warning", `${DOCUMENT_EXTENSIONS.get(extension)} should be synthetic and named synthetic-*`);
  }
  if (/(?:^|[-_.])(?:diagnostic|dump)(?:[-_.]|$)/iu.test(file)) {
    report("diagnostic-dump", "error", "diagnostic dumps must not be tracked fixture content");
  }

  if (bytes > EXCEPTIONAL_FIXTURE_BYTES) {
    report("oversize", "error", `fixture is ${Math.round(bytes / 1024)} KB, above the ${EXCEPTIONAL_FIXTURE_BYTES / 1024} KB exceptional limit`);
  } else if (bytes > NORMAL_FIXTURE_BYTES && !isAllowlisted(file, "oversize")) {
    report(
      "oversize",
      "warning",
      `fixture is ${Math.round(bytes / 1024)} KB; minimize it or add a narrow allowlist entry with a reason`,
    );
  }

  for (const match of content.matchAll(EMAIL)) {
    if (!RESERVED_EMAIL.test(match[0])) report("real-email", "error", "fixture contains a non-reserved email address");
  }

  for (const match of content.matchAll(PHONE)) {
    if (!SYNTHETIC_PHONE.test(match[0].trim())) report("real-phone", "warning", "fixture contains a phone-style number; confirm it is synthetic");
  }

  if (TRACKING_PARAMETER.test(content)) report("tracking-parameter", "error", "URL contains a tracking/session query parameter");
  if (SESSION_MATERIAL.test(content)) report("session-material", "error", "fixture contains cookie/authorization/session material");
  if (NON_JSON_LD_SCRIPT.test(content)) report("inline-script", "warning", "fixture still contains a non-JSON-LD script block");

  for (const [pattern, category] of SECRET_PATTERNS) {
    if (pattern.test(content)) report("secret-material", "error", `fixture contains possible ${category}`);
  }

  // The scan must never echo matched values.
  if (lower.includes("data-props")) {
    // Application-state blobs are a common source of telemetry; flag only when large.
    for (const match of content.matchAll(/data-props="([^"]*)"/gu)) {
      if (match[1].length > 2000) report("telemetry-blob", "warning", "large inline data-props application-state blob");
    }
  }
  return findings;
}

function scanFixtures(options) {
  const rootDir = path.resolve(options?.rootDir ?? path.join(__dirname, ".."));
  const findings = [];
  const files = listFixtureFiles(rootDir);
  for (const file of files) {
    const absolute = path.join(rootDir, FIXTURE_DIRECTORY, file);
    const stats = statSync(absolute);
    if (!stats.isFile()) continue;
    const content = readFileSync(absolute, "utf8");
    findings.push(...scanFixture(file, stats.size, content));
  }
  findings.sort((a, b) => (a.path === b.path ? a.rule.localeCompare(b.rule) : a.path.localeCompare(b.path)));
  return {
    directory: FIXTURE_DIRECTORY,
    files: files.length,
    errors: findings.filter((finding) => finding.severity === "error").length,
    warnings: findings.filter((finding) => finding.severity === "warning").length,
    findings,
  };
}

function formatReport(result) {
  const lines = [`Fixture hygiene: ${result.files} files, ${result.errors} errors, ${result.warnings} warnings`];
  for (const finding of result.findings) {
    lines.push(`${finding.severity.toUpperCase()} ${finding.path}: ${finding.rule} (${finding.message})`);
  }
  if (result.errors === 0) lines.push("No public-release content blockers found in tests/fixtures.");
  return `${lines.join("\n")}\n`;
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    process.stdout.write("Usage: node tools/checkFixtures.cjs [--root <directory>] [--json]\n");
    return 0;
  }
  const rootIndex = args.indexOf("--root");
  const rootDir = rootIndex >= 0 ? args[rootIndex + 1] : path.join(__dirname, "..");
  const result = scanFixtures({ rootDir });
  process.stdout.write(args.includes("--json") ? `${JSON.stringify(result, null, 2)}\n` : formatReport(result));
  return result.errors > 0 ? 1 : 0;
}

if (require.main === module) process.exitCode = main();

module.exports = {
  FIXTURE_ALLOWLIST,
  NORMAL_FIXTURE_BYTES,
  EXCEPTIONAL_FIXTURE_BYTES,
  formatReport,
  listFixtureFiles,
  scanFixture,
  scanFixtures,
};
