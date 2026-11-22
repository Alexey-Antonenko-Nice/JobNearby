"use strict";

// Packaging regression check: legal resources must survive `npm run desktop:package`.
//
// The installed Windows app is expected to contain:
//   * LICENSE.txt and THIRD_PARTY_NOTICES.md under resources/ (extraResources)
//   * Electron's own LICENSE.electron.txt and LICENSES.chromium.html at the install root
//   * the license files of the bundled production npm packages inside app.asar

const { existsSync, readFileSync, statSync } = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const unpacked = path.join(root, "release", "win-unpacked");

const REQUIRED_ROOT_FILES = ["LICENSE.electron.txt", "LICENSES.chromium.html"];
const REQUIRED_RESOURCE_FILES = [
  { file: "LICENSE.txt", marker: "MIT License" },
  { file: "THIRD_PARTY_NOTICES.md", marker: "Third-Party Notices" },
];
const REQUIRED_ASAR_LICENSES = [
  "node_modules/better-sqlite3/LICENSE",
  "node_modules/node-addon-api/LICENSE.md",
  "node_modules/zod/LICENSE",
];

function fail(message) {
  process.stderr.write(`Packaged legal resources: ${message}\n`);
}

function checkFiles() {
  const problems = [];
  if (!existsSync(unpacked)) {
    return ["release/win-unpacked is missing (run npm run desktop:package first)"];
  }
  for (const file of REQUIRED_ROOT_FILES) {
    const full = path.join(unpacked, file);
    if (!existsSync(full) || statSync(full).size === 0) problems.push(`${file} is missing or empty at the install root`);
  }
  for (const { file, marker } of REQUIRED_RESOURCE_FILES) {
    const full = path.join(unpacked, "resources", file);
    if (!existsSync(full)) {
      problems.push(`resources/${file} is missing`);
      continue;
    }
    if (!readFileSync(full, "utf8").includes(marker)) problems.push(`resources/${file} does not contain "${marker}"`);
  }
  return problems;
}

function checkAsar() {
  const asarPath = path.join(unpacked, "resources", "app.asar");
  if (!existsSync(asarPath)) return ["resources/app.asar is missing"];
  let asar;
  try {
    asar = require("@electron/asar");
  } catch {
    return ["@electron/asar is not installed; cannot inspect app.asar (run npm install)"];
  }
  const entries = new Set(asar.listPackage(asarPath).map((entry) => entry.replace(/\\/gu, "/").replace(/^\//u, "")));
  return REQUIRED_ASAR_LICENSES.filter((relative) => !entries.has(relative)).map(
    (relative) => `${relative} is missing from app.asar`,
  );
}

const problems = [...checkFiles(), ...checkAsar()];
if (problems.length > 0) {
  for (const problem of problems) fail(problem);
  process.exitCode = 1;
} else {
  process.stdout.write("Packaged legal resources verified: LICENSE, notices, and Electron/Chromium notice bundles are present.\n");
}
