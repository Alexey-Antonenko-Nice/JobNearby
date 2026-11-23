import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const ci = readFileSync(resolve(root, ".github", "workflows", "ci.yml"), "utf8");
const packageWorkflow = readFileSync(resolve(root, ".github", "workflows", "windows-package.yml"), "utf8");
const testCiTool = readFileSync(resolve(root, "tools", "testCi.cjs"), "utf8");
const packageJson = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")) as {
  scripts: Record<string, string>;
};
const contributing = readFileSync(resolve(root, "CONTRIBUTING.md"), "utf8");

function expectContains(text: string, needles: string[], label: string): void {
  for (const needle of needles) {
    expect(text, `${label}: ${needle}`).toContain(needle);
  }
}

describe("CI workflow", () => {
  it("exists and runs for pull requests, main pushes and manual reruns", () => {
    expect(existsSync(resolve(root, ".github", "workflows", "ci.yml"))).toBe(true);
    expectContains(ci, ["name: CI", "pull_request:", "push:", "workflow_dispatch:"], "ci.yml");
  });

  it("uses read-only permissions and no pull_request_target or secrets", () => {
    expectContains(ci, ["permissions:", "contents: read"], "ci.yml");
    expect(ci).not.toContain("pull_request_target");
    expect(ci).not.toContain("contents: write");
    expect(ci).not.toContain("packages: write");
    expect(ci).not.toContain("id-token: write");
    expect(ci).not.toContain("secrets.");
  });

  it("checks out full history where repository history is checked", () => {
    expect(ci).toContain("fetch-depth: 0");
    expect(ci).toContain("npm run check:contributor");
    expect(packageJson.scripts["check:contributor"]).toContain("check:history");
  });

  it("pins an explicit Node version and uses npm lockfile caching", () => {
    expectContains(ci, [
      "node-version: 22.19.0",
      "cache: npm",
      "cache-dependency-path: package-lock.json",
    ], "ci.yml");
    expect(ci).not.toContain("node-version: latest");
  });

  it("uses npm ci and runs quality, production audit and security tests", () => {
    expect(ci).toContain("npm ci");
    expect(ci).toContain("npm run check:contributor");
    expect(ci).toContain("npm audit --omit=dev");
    expect(ci).toContain("npm run test:security");
  });

  it("runs backend and UI suites separately", () => {
    expect(ci).toContain("npm run test:ci");
    expect(ci).toContain("npm run test:ui");
    expect(ci).toContain("windows-latest");
    expect(ci).toContain("timeout-minutes:");
  });

  it("does not blanket-retry or ignore failures", () => {
    expect(ci).not.toContain("continue-on-error");
    expect(ci).not.toContain("--retry");
    expect(packageWorkflow).not.toContain("continue-on-error");
  });
});

describe("Windows package workflow", () => {
  it("is manual-only and uses read-only permissions", () => {
    expectContains(packageWorkflow, ["name: Windows package", "workflow_dispatch:", "contents: read"], "windows-package.yml");
    expect(packageWorkflow).not.toContain("push:");
    expect(packageWorkflow).not.toContain("pull_request");
    expect(packageWorkflow).not.toContain("pull_request_target");
    expect(packageWorkflow).not.toContain("contents: write");
    expect(packageWorkflow).not.toContain("secrets.");
  });

  it("uses full history, Node 22 and npm ci", () => {
    expectContains(packageWorkflow, [
      "fetch-depth: 0",
      "node-version: 22.19.0",
      "cache: npm",
      "npm ci",
      "CSC_IDENTITY_AUTO_DISCOVERY: \"false\"",
    ], "windows-package.yml");
    expect(packageWorkflow).not.toContain("node-version: latest");
  });

  it("runs contributor checks, security tests, packaging and legal verification", () => {
    expectContains(packageWorkflow, [
      "npm run check:contributor",
      "npm run test:security",
      "npm run desktop:package",
      "npm run verify:packaged-legal",
      "npm run package:verify",
    ], "windows-package.yml");
  });

  it("stages and uploads only the verified installer and checksum", () => {
    expectContains(packageWorkflow, [
      "actions/upload-artifact@v4",
      "release/ci-artifact/*",
      "if-no-files-found: error",
      "retention-days: 14",
      "$artifact.checksum",
      "job-nearby-windows-x64",
    ], "windows-package.yml");
    expect(packageWorkflow).not.toContain("win-unpacked");
    expect(packageWorkflow).not.toContain("latest.yml");
    expect(packageWorkflow).not.toContain("blockmap");
  });

  it("does not create releases, tags or version bumps", () => {
    for (const forbidden of [
      "gh release",
      "actions/create-release",
      "softprops/action-gh-release",
      "git tag",
      "npm version",
      "--publish always",
      "GITHUB_TOKEN",
    ]) {
      expect(packageWorkflow, forbidden).not.toContain(forbidden);
    }
  });

  it("summarizes the unsigned workflow artifact without claiming a release", () => {
    expect(packageWorkflow).toContain("GITHUB_STEP_SUMMARY");
    expect(packageWorkflow).toContain("unsigned");
    expect(packageWorkflow).toContain("workflow artifact");
  });
});

describe("CI support scripts and documentation", () => {
  it("exposes semantic local/CI scripts", () => {
    expect(packageJson.scripts["test:ci"]).toBe("node tools/testCi.cjs");
    expect(packageJson.scripts["test:security"]).toContain("tests/security");
    expect(packageJson.scripts["test:security"]).toContain("popupPairing");
    expect(packageJson.scripts["package:verify"]).toBe("node tools/verifyReleaseArtifact.cjs");
  });

  it("keeps the timing-sensitive list exact and does not increase timeouts", () => {
    for (const file of [
      "tests/infrastructure/DailyWorkQueue.test.ts",
      "tests/infrastructure/SqliteUserVacancyInteractionRepository.test.ts",
      "tests/persistence/PromanHistoricalRemediation.test.ts",
    ]) {
      expect(testCiTool).toContain(file);
    }
    expect(testCiTool).toContain("--exclude");
    expect(testCiTool).not.toMatch(/testTimeout|--timeout/u);
    expect(testCiTool).not.toContain("--retry");
  });

  it("documents the CI and manual packaging workflow for contributors", () => {
    expect(contributing).toContain("npm run test:ci");
    expect(contributing).toContain("npm run test:security");
    expect(contributing).toContain("npm run package:verify");
    expect(contributing.toLowerCase()).toContain("windows package");
    expect(contributing.toLowerCase()).toContain("workflow artifact");
  });
});
