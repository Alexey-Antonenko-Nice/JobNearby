#!/usr/bin/env node
"use strict";

const { createHash } = require("node:crypto");
const { existsSync, readFileSync, readdirSync, statSync } = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const { version } = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
const releaseDir = path.join(root, "release");
const expectedInstaller = `Job-Nearby-Setup-${version}.exe`;

function fail(message) {
  console.error(`Release artifact verification failed: ${message}`);
  process.exit(1);
}

if (!existsSync(releaseDir)) {
  fail(`release directory does not exist: ${releaseDir}`);
}

const installers = readdirSync(releaseDir)
  .filter((name) => /^Job-Nearby-Setup-.+\.exe$/u.test(name))
  .filter((name) => !name.endsWith("__uninstaller.exe"));

if (installers.length !== 1) {
  fail(`expected exactly one installer, found ${installers.length}: ${installers.join(", ")}`);
}
if (installers[0] !== expectedInstaller) {
  fail(`expected ${expectedInstaller}, found ${installers[0]}`);
}

const installerPath = path.join(releaseDir, expectedInstaller);
const checksumPath = `${installerPath}.sha256`;
if (!existsSync(checksumPath)) {
  fail(`checksum file is missing: ${checksumPath}`);
}

const checksumLine = readFileSync(checksumPath, "utf8").trim();
const checksumMatch = /^([a-fA-F0-9]{64})\s{2}(.+)$/u.exec(checksumLine);
if (checksumMatch === null) {
  fail("checksum file must contain '<sha256>  <filename>'");
}
if (checksumMatch[2] !== expectedInstaller) {
  fail(`checksum names ${checksumMatch[2]}, expected ${expectedInstaller}`);
}

const digest = createHash("sha256").update(readFileSync(installerPath)).digest("hex");
if (digest.toLowerCase() !== checksumMatch[1].toLowerCase()) {
  fail(`checksum mismatch: file says ${checksumMatch[1]}, computed ${digest}`);
}

const result = {
  version,
  installer: expectedInstaller,
  checksum: path.basename(checksumPath),
  sha256: digest,
  sizeBytes: statSync(installerPath).size,
};

if (process.argv.includes("--json")) {
  console.log(JSON.stringify(result));
} else {
  console.log(`Version: ${result.version}`);
  console.log(`Installer: ${result.installer} (${result.sizeBytes} bytes)`);
  console.log(`Checksum: ${result.checksum}`);
  console.log(`SHA-256: ${result.sha256}`);
}
