#!/usr/bin/env node
"use strict";

// Repeated, deterministic dependency-license audit for Job Nearby.
//
// Usage:
//   node tools/auditLicenses.cjs            # check only; exits 1 on distributed blockers
//   node tools/auditLicenses.cjs --write    # regenerate docs/THIRD_PARTY_LICENSES.json
//   node tools/auditLicenses.cjs --json     # print the machine-readable inventory
//   node tools/auditLicenses.cjs --root DIR # audit another checkout (tests)

const { mkdirSync, writeFileSync } = require("node:fs");
const path = require("node:path");

const { buildInventory, formatInventoryJson, summarize } = require("./licenseAudit.cjs");

const OUTPUT_RELATIVE_PATH = path.join("docs", "THIRD_PARTY_LICENSES.json");

function parseArguments(argv) {
  const options = { write: false, json: false, rootDir: path.resolve(__dirname, "..") };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--write") options.write = true;
    else if (argument === "--json") options.json = true;
    else if (argument === "--root") {
      const value = argv[index + 1];
      if (!value) throw new Error("--root requires a directory argument");
      options.rootDir = path.resolve(value);
      index += 1;
    } else if (argument === "--help" || argument === "-h") options.help = true;
    else throw new Error(`Unknown argument: ${argument}`);
  }
  return options;
}

function main() {
  let options;
  try {
    options = parseArguments(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    return 2;
  }
  if (options.help) {
    process.stdout.write(
      "Usage: node tools/auditLicenses.cjs [--write] [--json] [--root <directory>]\n" +
        "Checks resolved dependency licenses; --write regenerates docs/THIRD_PARTY_LICENSES.json.\n",
    );
    return 0;
  }

  const inventory = buildInventory({ rootDir: options.rootDir });
  const outputPath = path.join(options.rootDir, OUTPUT_RELATIVE_PATH);

  if (options.write) {
    mkdirSync(path.dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, formatInventoryJson(inventory));
    process.stdout.write(`Wrote ${path.relative(process.cwd(), outputPath)}\n\n`);
  }

  process.stdout.write(summarize(inventory));
  if (options.json) process.stdout.write(`\n${formatInventoryJson(inventory)}`);

  return inventory.summary.blockers > 0 ? 1 : 0;
}

process.exitCode = main();
