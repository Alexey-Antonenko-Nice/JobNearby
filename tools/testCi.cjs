#!/usr/bin/env node
"use strict";

const { spawnSync } = require("node:child_process");
const { existsSync } = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const vitestEntry = path.join(root, "node_modules", "vitest", "vitest.mjs");

// These files have historically hit Vitest's 5-second per-test limit under
// aggregate load. They are run independently, then excluded from the rest of
// the suite. This avoids log parsing and does not tolerate real failures.
const TIMING_SENSITIVE_FILES = [
  "tests/infrastructure/DailyWorkQueue.test.ts",
  "tests/infrastructure/SqliteUserVacancyInteractionRepository.test.ts",
  "tests/persistence/PromanHistoricalRemediation.test.ts",
];

if (!existsSync(vitestEntry)) {
  console.error(`Vitest entry point not found at ${vitestEntry}. Run npm ci first.`);
  process.exit(1);
}

function runVitest(args) {
  console.log(`\n> node ${path.relative(root, vitestEntry)} run ${args.join(" ")}`);
  const result = spawnSync(process.execPath, [vitestEntry, "run", ...args], {
    cwd: root,
    env: process.env,
    stdio: "inherit",
  });
  if (result.error) {
    console.error(result.error);
    return 1;
  }
  return result.status ?? 1;
}

for (const file of TIMING_SENSITIVE_FILES) {
  console.log(`\n=== Timing-sensitive file: ${file} ===`);
  const status = runVitest([file]);
  if (status !== 0) {
    console.error(`\nTiming-sensitive file failed independently: ${file}`);
    process.exit(status);
  }
}

const excludeArgs = TIMING_SENSITIVE_FILES.flatMap((file) => ["--exclude", file]);
console.log("\n=== Remaining backend suite ===");
const status = runVitest([...excludeArgs, "tests"]);
if (status !== 0) {
  process.exit(status);
}

console.log("\nAll backend tests passed (timing-sensitive files run independently).");
