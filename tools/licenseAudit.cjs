"use strict";

// Dependency-license audit helpers for Job Nearby (M24.1).
//
// The audit is intentionally dependency-free: it reads package-lock.json and
// installed package metadata with Node's standard library only, so it can run on
// a fresh clone without network access or an extra license-checker package.
//
// Classification rules (see docs/LICENSING.md):
//   * ACCEPTED_LICENSES are permissive SPDX identifiers reviewed for this project.
//   * REVIEW_LICENSES are unusual or obligation-bearing identifiers that were
//     explicitly reviewed; they stay in the "review" tier so they keep showing up
//     in the inventory instead of silently becoming "accepted".
//   * Everything else is UNKNOWN and must be read before it may ship.
//   * "Distributed" means the code ships inside the Windows app/installer. A
//     review/unknown license is a blocker only for distributed packages; for
//     dev-only packages it is a warning.

const { existsSync, readFileSync, readdirSync, statSync } = require("node:fs");
const path = require("node:path");

const ACCEPTED_LICENSES = new Map([
  ["0BSD", "Public-domain-equivalent permissive license."],
  ["Apache-2.0", "Permissive with patent grant; preserve NOTICE/attribution when distributed."],
  ["BSD-2-Clause", "Permissive; preserve copyright and license text when distributed."],
  ["BSD-3-Clause", "Permissive; preserve copyright and license text when distributed."],
  ["BlueOak-1.0.0", "Permissive, OSI-approved; reviewed for build tooling."],
  ["CC0-1.0", "Public-domain dedication; no attribution required."],
  ["ISC", "Permissive; preserve copyright and license text when distributed."],
  ["MIT", "Permissive; preserve copyright and license text when distributed."],
  ["MIT-0", "MIT without an attribution requirement."],
  ["Unlicense", "Public-domain dedication; no attribution required."],
]);

const REVIEW_LICENSES = new Map([
  ["CC-BY-4.0", "Attribution required; acceptable only for non-distributed build data."],
  ["Python-2.0", "Permissive but non-standard; reviewed as dev-only toolchain input."],
  ["WTFPL", "Permissive public-domain-equivalent but not OSI-reviewed; reviewed as dev-only."],
]);

// Identifier prefixes that always require an explicit human decision.
const REVIEW_PREFIXES = [
  ["AGPL", "Network-copyleft; would extort source release of combined work."],
  ["SSPL", "Service-source-available; not OSI open source."],
  ["LGPL", "Weak copyleft; static linking needs a relink/source-offer strategy."],
  ["GPL", "Strong copyleft; incompatible with shipping MIT-only application code."],
  ["MPL", "File-level copyleft; requires source of modified files."],
  ["EPL", "Weak copyleft; requires source of modified files."],
  ["CDDL", "File-level copyleft; not GPL-compatible."],
  ["CPL", "Weak copyleft; requires source availability for covered code."],
  ["BUSL", "Business Source License; not open source during the change window."],
  ["Elastic", "Source-available; restricts providing the software as a service."],
  ["Commons-Clause", "Forbids selling the software; not open source."],
  ["CC-BY", "Attribution obligations; not a software license."],
  ["OSL", "Strong copyleft."],
  ["Artistic", "Requires reading the actual terms."],
  ["JSON", "Non-standard 'shall be used for Good, not Evil' clause."],
];

// Dev dependencies whose compiled output is still shipped inside ui/dist.
const BUNDLED_DEV_DEPENDENCIES = new Map([
  ["react", "ui/dist bundle"],
  ["react-dom", "ui/dist bundle"],
  ["scheduler", "ui/dist bundle"],
]);

const RANK = { accepted: 0, review: 1, unknown: 2 };
const KIND_BY_RANK = ["accepted", "review", "unknown"];

function normalizeLicenseId(identifier) {
  const trimmed = String(identifier ?? "").trim().replace(/\s+/gu, " ");
  if (!trimmed) return "";
  const aliases = new Map([
    ["Apache 2", "Apache-2.0"],
    ["Apache 2.0", "Apache-2.0"],
    ["Apache License 2.0", "Apache-2.0"],
    ["MIT License", "MIT"],
    ["ISC License", "ISC"],
    ["BSD", "UNKNOWN"],
    ["Public Domain", "Public-Domain"],
  ]);
  return aliases.get(trimmed) ?? trimmed;
}

function classifyLicenseId(rawIdentifier) {
  const identifier = normalizeLicenseId(rawIdentifier);
  if (!identifier) {
    return { kind: "unknown", reason: "missing license identifier", licenseIds: [] };
  }
  if (ACCEPTED_LICENSES.has(identifier)) {
    return { kind: "accepted", reason: ACCEPTED_LICENSES.get(identifier), licenseIds: [identifier] };
  }
  if (REVIEW_LICENSES.has(identifier)) {
    return { kind: "review", reason: REVIEW_LICENSES.get(identifier), licenseIds: [identifier] };
  }
  if (identifier === "UNKNOWN" || identifier === "UNLICENSED" || identifier === "NOASSERTION") {
    return { kind: "unknown", reason: "declared license is unknown or unreviewed", licenseIds: [] };
  }
  const upper = identifier.toUpperCase();
  for (const [prefix, reason] of REVIEW_PREFIXES) {
    if (upper.startsWith(prefix.toUpperCase())) {
      return { kind: "review", reason, licenseIds: [identifier] };
    }
  }
  return {
    kind: "unknown",
    reason: "license identifier is not on the reviewed allowlist; read the license text",
    licenseIds: [identifier],
  };
}

function tokenizeExpression(expression) {
  const tokens = [];
  const pattern = /\(|\)|\bAND\b|\bOR\b|\bWITH\b|[^\s()]+/gu;
  let match;
  while ((match = pattern.exec(expression)) !== null) {
    tokens.push(match[0]);
  }
  return tokens;
}

// Parses the SPDX subset that appears on npm: ids, AND, OR, WITH, parentheses.
// Returns null when the expression cannot be parsed as a license expression.
function parseLicenseExpression(expression) {
  const tokens = tokenizeExpression(String(expression ?? ""));
  if (tokens.length === 0) return null;
  let cursor = 0;

  const peek = () => tokens[cursor];
  const take = () => tokens[cursor++];

  function parsePrimary() {
    const token = peek();
    if (token === undefined) return null;
    if (token === "(") {
      take();
      const inner = parseOr();
      if (inner === null || peek() !== ")") return null;
      take();
      return inner;
    }
    if (token === ")" || /^(AND|OR|WITH)$/iu.test(token)) return null;
    take();
    return { type: "license", id: token };
  }

  function parseWith() {
    const base = parsePrimary();
    if (base === null) return null;
    if (peek() === "WITH") {
      take();
      const exception = parsePrimary();
      if (exception === null || exception.type !== "license") return null;
      return { type: "with", license: base, exception: exception.id };
    }
    return base;
  }

  function parseAnd() {
    let node = parseWith();
    if (node === null) return null;
    while (peek() === "AND") {
      take();
      const right = parseWith();
      if (right === null) return null;
      node = { type: "and", left: node, right };
    }
    return node;
  }

  function parseOr() {
    let node = parseAnd();
    if (node === null) return null;
    while (peek() === "OR") {
      take();
      const right = parseAnd();
      if (right === null) return null;
      node = { type: "or", left: node, right };
    }
    return node;
  }

  const ast = parseOr();
  if (ast === null || cursor !== tokens.length) return null;
  return ast;
}

function collectLicenseIds(node, into) {
  if (node.type === "license") {
    into.add(normalizeLicenseId(node.id));
  } else if (node.type === "with") {
    collectLicenseIds(node.license, into);
    into.add(normalizeLicenseId(node.exception));
  } else {
    collectLicenseIds(node.left, into);
    collectLicenseIds(node.right, into);
  }
  return into;
}

function evaluateAst(node) {
  if (node.type === "license") {
    return classifyLicenseId(node.id).kind;
  }
  if (node.type === "with") {
    // An SPDX exception qualifies the license; exceptions are reviewed case by case.
    return KIND_BY_RANK[Math.max(RANK[evaluateAst(node.license)], RANK.review)];
  }
  const left = evaluateAst(node.left);
  const right = evaluateAst(node.right);
  // AND: every obligation applies. OR: the licensee may choose, so the best branch wins.
  return node.type === "and"
    ? KIND_BY_RANK[Math.max(RANK[left], RANK[right])]
    : KIND_BY_RANK[Math.min(RANK[left], RANK[right])];
}

// Classifies an SPDX expression without truncating it to its first token.
function classifyLicenseExpression(expression) {
  const raw = String(expression ?? "").trim();
  const ast = parseLicenseExpression(raw);
  if (ast === null) {
    const single = classifyLicenseId(raw);
    return {
      expression: raw,
      licenseIds: single.licenseIds,
      kind: single.kind,
      parsed: false,
      reason: single.reason,
    };
  }
  const ids = [...collectLicenseIds(ast, new Set())].filter(Boolean).sort();
  const kind = evaluateAst(ast);
  const reasons = ids.map((id) => `${id}: ${classifyLicenseId(id).reason}`);
  return { expression: raw, licenseIds: ids, kind, parsed: true, reason: reasons.join(" ") };
}

function detectLicenseFromText(text) {
  const body = String(text ?? "");
  if (/Apache License,?\s*Version 2\.0/iu.test(body)) return "Apache-2.0";
  if (/MIT License|Permission is hereby granted, free of charge/iu.test(body)) return "MIT";
  if (/ISC License|Permission to use, copy, modify, and\/or distribute/iu.test(body)) return "ISC";
  if (/Redistribution and use in source and binary forms/iu.test(body)) {
    return /Neither the name/iu.test(body) ? "BSD-3-Clause" : "BSD-2-Clause";
  }
  if (/GNU AFFERO GENERAL PUBLIC LICENSE/iu.test(body)) return "AGPL-3.0";
  if (/GNU LESSER GENERAL PUBLIC LICENSE/iu.test(body)) return "LGPL-2.1";
  if (/GNU GENERAL PUBLIC LICENSE/iu.test(body)) return "GPL-2.0";
  if (/Mozilla Public License/iu.test(body)) return "MPL-2.0";
  if (/CC0 1\.0|Creative Commons Zero/iu.test(body)) return "CC0-1.0";
  if (/The Unlicense/iu.test(body)) return "Unlicense";
  if (/Blue Oak Model License/iu.test(body)) return "BlueOak-1.0.0";
  return "UNKNOWN";
}

const LICENSE_FILE_CANDIDATES = ["LICENSE", "LICENSE.md", "LICENSE.txt", "LICENCE", "COPYING", "COPYING.md", "NOTICE"];

function readLicenseText(packageDir) {
  let entries;
  try {
    entries = readdirSync(packageDir);
  } catch {
    return null;
  }
  const candidates = entries
    .filter((name) => LICENSE_FILE_CANDIDATES.some((candidate) => name.toUpperCase() === candidate) || /^(LICEN[CS]E|COPYING)/iu.test(name))
    .sort();
  for (const name of candidates) {
    const file = path.join(packageDir, name);
    try {
      if (statSync(file).isFile()) return readFileSync(file, "utf8");
    } catch {
      // Unreadable license file: keep looking.
    }
  }
  return null;
}

// Resolves a declared license, including "SEE LICENSE IN <file>" references.
function resolveLicense(packageDir, declaredLicense) {
  const declared = typeof declaredLicense === "string" ? declaredLicense.trim() : "";
  const seeLicense = /^SEE LICEN[CS]E IN\s+(.+)$/iu.exec(declared);
  if (seeLicense) {
    const relative = seeLicense[1].trim().replace(/^["']|["']$/gu, "");
    const file = path.resolve(packageDir, relative);
    if (existsSync(file) && file.startsWith(path.resolve(packageDir))) {
      const detected = detectLicenseFromText(readFileSync(file, "utf8"));
      return { license: detected, source: `SEE LICENSE IN ${relative}` };
    }
    return { license: "UNKNOWN", source: `SEE LICENSE IN ${relative} (file missing)` };
  }
  if (declared && declared !== "UNKNOWN") {
    return { license: declared, source: "package metadata" };
  }
  const text = readLicenseText(packageDir);
  if (text) {
    return { license: detectLicenseFromText(text), source: "license file text" };
  }
  return { license: "UNKNOWN", source: "no metadata or license file" };
}

function severityFor(kind, distributed) {
  if (kind === "accepted") return "none";
  return distributed ? "blocker" : "warning";
}

function packageStatusFor(kind) {
  if (kind === "accepted") return "OK";
  if (kind === "review") return "REVIEW";
  return "UNKNOWN";
}

function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

function buildInventory(options) {
  const rootDir = path.resolve(options.rootDir);
  const lock = options.lock ?? readJson(path.join(rootDir, "package-lock.json"));
  const rootPackage = options.rootPackage ?? readJson(path.join(rootDir, "package.json"));
  const directDependencies = new Set([
    ...Object.keys(rootPackage.dependencies ?? {}),
    ...Object.keys(rootPackage.optionalDependencies ?? {}),
    ...Object.keys(rootPackage.devDependencies ?? {}),
  ]);

  const packages = [];
  for (const [lockPath, meta] of Object.entries(lock.packages ?? {})) {
    if (lockPath === "") continue;
    const name = meta.name ?? lockPath.replace(/^.*node_modules\//u, "");
    const version = meta.version ?? "0.0.0";
    const packageDir = path.join(rootDir, lockPath);
    let declared = meta.license;
    if (!declared) {
      try {
        declared = readJson(path.join(packageDir, "package.json")).license;
      } catch {
        declared = undefined;
      }
    }
    const resolved = resolveLicense(packageDir, declared);
    const classification = classifyLicenseExpression(resolved.license);
    const developmentOnly = meta.dev === true;
    const distributedVia = !developmentOnly
      ? "app.asar"
      : BUNDLED_DEV_DEPENDENCIES.get(name) ?? null;
    const distributed = distributedVia !== null;
    const kind = classification.kind;
    packages.push({
      name,
      version,
      license: resolved.license,
      licenseExpression: classification.expression,
      licenseSource: resolved.source,
      direct: directDependencies.has(name),
      production: !developmentOnly,
      distributed,
      distributedVia,
      status: packageStatusFor(kind),
      severity: severityFor(kind, distributed),
      reviewNote: kind === "accepted" || kind === "unknown" ? null : classification.reason,
    });
  }

  packages.sort((a, b) => (a.name === b.name ? a.version.localeCompare(b.version) : a.name.localeCompare(b.name)));

  const electron = packages.find((pkg) => pkg.name === "electron" && pkg.production === false);
  const components = buildComponents(electron ? electron.version : "unknown");

  const summary = {
    packages: packages.length,
    direct: new Set(packages.filter((pkg) => pkg.direct).map((pkg) => pkg.name)).size,
    production: packages.filter((pkg) => pkg.production).length,
    distributed: packages.filter((pkg) => pkg.distributed).length,
    ok: packages.filter((pkg) => pkg.status === "OK").length,
    warnings: packages.filter((pkg) => pkg.severity === "warning").length,
    blockers: packages.filter((pkg) => pkg.severity === "blocker").length,
  };

  return {
    schemaVersion: 1,
    project: { name: rootPackage.name, version: rootPackage.version, license: rootPackage.license ?? "UNKNOWN" },
    source: { packageLock: "package-lock.json", lockfileVersion: lock.lockfileVersion ?? null },
    policy: {
      accepted: [...ACCEPTED_LICENSES.keys()].sort(),
      reviewRequired: [...REVIEW_LICENSES.keys()].sort(),
      unknownRule:
        "Distributed code must not use an unreviewed license: an UNKNOWN or review-tier license in shipped code is a blocker. Dev-only packages are warnings for source-repository compatibility.",
      bundledDevDependencies: [...BUNDLED_DEV_DEPENDENCIES.keys()].sort(),
    },
    summary,
    packages,
    components,
  };
}

// Curated, hand-audited components that are not ordinary npm production packages.
function buildComponents(electronVersion) {
  return [
    {
      name: "Chromium",
      version: `as bundled with Electron ${electronVersion}`,
      license: "BSD-3-Clause and third-party licenses",
      distributed: true,
      distributionPoint: "Windows app (install root)",
      noticeLocation: "LICENSES.chromium.html",
      source: "https://github.com/chromium/chromium",
    },
    {
      name: "Electron",
      version: electronVersion,
      license: "MIT",
      distributed: true,
      distributionPoint: "Windows app (install root)",
      noticeLocation: "LICENSE.electron.txt",
      source: "https://github.com/electron/electron",
    },
    {
      name: "Node.js",
      version: `as bundled with Electron ${electronVersion}`,
      license: "MIT",
      distributed: true,
      distributionPoint: "Windows app (Electron runtime)",
      noticeLocation: "LICENSES.chromium.html (Node.js section)",
      source: "https://github.com/nodejs/node",
    },
    {
      name: "NSIS",
      version: "3.0.4.1 (installer runtime stub)",
      license: "Zlib AND CPL-1.0 (LZMA module)",
      distributed: true,
      distributionPoint: "NSIS installer",
      noticeLocation: "THIRD_PARTY_NOTICES.md",
      source: "https://nsis.sourceforge.io/",
    },
    {
      name: "SQLite",
      version: "as bundled in better-sqlite3",
      license: "Public-Domain",
      distributed: true,
      distributionPoint: "app.asar.unpacked (better-sqlite3 native binary)",
      noticeLocation: "THIRD_PARTY_NOTICES.md",
      source: "https://sqlite.org/",
    },
    {
      name: "nsis7z (7-Zip extraction plugin)",
      version: "as bundled by electron-builder",
      license: "LGPL-2.1-or-later",
      distributed: true,
      distributionPoint: "NSIS installer",
      noticeLocation: "THIRD_PARTY_NOTICES.md",
      source: "https://www.7-zip.org/",
    },
  ].sort((a, b) => a.name.localeCompare(b.name));
}

function summarize(inventory) {
  const blockers = inventory.packages.filter((pkg) => pkg.severity === "blocker");
  const warnings = inventory.packages.filter((pkg) => pkg.severity === "warning");
  const lines = [
    `Job Nearby ${inventory.project.version} - dependency license audit`,
    `Project license: ${inventory.project.license}`,
    `Packages: ${inventory.summary.packages} (production ${inventory.summary.production}, distributed ${inventory.summary.distributed}, direct ${inventory.summary.direct})`,
    `Accepted: ${inventory.summary.ok}  Warnings: ${inventory.summary.warnings}  Blockers: ${inventory.summary.blockers}`,
  ];
  if (blockers.length > 0) {
    lines.push("", "Blockers (distributed code with an unreviewed license):");
    for (const pkg of blockers) lines.push(`  - ${pkg.name}@${pkg.version}: ${pkg.license} (${pkg.status})`);
  }
  if (warnings.length > 0) {
    lines.push("", "Warnings (dev-only packages needing explicit review):");
    for (const pkg of warnings) lines.push(`  - ${pkg.name}@${pkg.version}: ${pkg.license} (${pkg.status}, dev-only)`);
  }
  lines.push("", "Distributed components:");
  for (const component of inventory.components) {
    lines.push(`  - ${component.name} ${component.version}: ${component.license} -> ${component.noticeLocation}`);
  }
  return `${lines.join("\n")}\n`;
}

function formatInventoryJson(inventory) {
  return `${JSON.stringify(inventory, null, 2)}\n`;
}

module.exports = {
  ACCEPTED_LICENSES,
  REVIEW_LICENSES,
  BUNDLED_DEV_DEPENDENCIES,
  buildInventory,
  classifyLicenseExpression,
  classifyLicenseId,
  detectLicenseFromText,
  formatInventoryJson,
  normalizeLicenseId,
  parseLicenseExpression,
  resolveLicense,
  severityFor,
  summarize,
};
