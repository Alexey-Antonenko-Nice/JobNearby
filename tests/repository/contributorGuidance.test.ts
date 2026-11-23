import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (relative: string): string => readFileSync(resolve(root, relative), "utf8");
const packageJson = JSON.parse(read("package.json")) as {
  scripts: Record<string, string>;
};
const contributing = read("CONTRIBUTING.md");
const readme = read("README.md");
const bugTemplate = read(".github/ISSUE_TEMPLATE/bug_report.yml");
const featureTemplate = read(".github/ISSUE_TEMPLATE/feature_request.yml");
const issueConfig = read(".github/ISSUE_TEMPLATE/config.yml");
const pullRequestTemplate = read(".github/pull_request_template.md");

function relativeLinks(text: string): string[] {
  return [...text.matchAll(/\[[^\]]*\]\(([^)]+)\)/gu)]
    .map((match) => match[1]!.trim().split(/\s+/u)[0]!)
    .filter((target) => target.length > 0 && !target.startsWith("http") && !target.startsWith("mailto:") && !target.startsWith("#"))
    .map((target) => target.replace(/^<|>$/gu, "").split("#")[0]!)
    .filter((target) => target.length > 0);
}

function expectLinksToResolve(file: string): void {
  for (const target of relativeLinks(read(file))) {
    const resolved = resolve(root, dirname(resolve(root, file)), target);
    expect(existsSync(resolved), `${file}: ${target}`).toBe(true);
    expect(statSync(resolved).isFile() || statSync(resolved).isDirectory(), `${file}: ${target}`).toBe(true);
  }
}

function yamlIds(text: string): string[] {
  return [...text.matchAll(/-\s+type:[^\n]*\n\s+id:\s*([a-z_]+)/gu)].map((match) => match[1]!);
}

describe("contributor documentation", () => {
  it("links contributor, architecture, product, privacy, security, fixture and licensing guidance", () => {
    for (const target of [
      "README.md",
      "SECURITY.md",
      "LICENSE",
      "CONTRIBUTING.md",
      "docs/ARCHITECTURE.md",
      "docs/PRODUCT_SPECIFICATION.md",
      "docs/PRIVACY.md",
      "docs/SECURITY_MODEL.md",
      "docs/LICENSING.md",
      "docs/DESKTOP_DISTRIBUTION.md",
      "tests/fixtures/README.md",
      "THIRD_PARTY_NOTICES.md",
    ]) {
      expect(existsSync(resolve(root, target)), target).toBe(true);
    }
    expect(contributing).toContain("tests/fixtures/README.md");
    expect(contributing).toContain("docs/LICENSING.md");
    expect(contributing).toContain("docs/SECURITY_MODEL.md");
    expect(contributing).toContain("docs/PRIVACY.md");
    expect(contributing).toContain("SECURITY.md");
    expect(readme).toContain("[Contributing](CONTRIBUTING.md)");
  });

  it("resolves all relative links in the contributor-facing README and guide", () => {
    expectLinksToResolve("README.md");
    expectLinksToResolve("CONTRIBUTING.md");
  });

  it("documents the tested fresh-clone and development commands", () => {
    for (const command of [
      "git clone https://github.com/Alexey-Antonenko-Nice/JobNearby.git",
      "npm ci",
      "npm run typecheck",
      "npm run build",
      "npm run ui:build",
      "npm run capture:server",
      "npm run ui:dev",
      "npm run desktop",
      "npm run desktop:package",
      "npm run test",
      "npm run test:ui",
      "npm run check:contributor",
      "npm audit --omit=dev",
    ]) {
      expect(contributing).toContain(command);
    }
  });

  it("only documents npm scripts that exist in package.json", () => {
    const documented = [...contributing.matchAll(/npm run ([a-z0-9:-]+)/gu)].map((match) => match[1]!);
    expect(documented.length).toBeGreaterThan(0);
    for (const script of new Set(documented)) {
      expect(packageJson.scripts[script], script).toBeTypeOf("string");
    }
  });

  it("composes the existing guards instead of duplicating them", () => {
    const composed = packageJson.scripts["check:contributor"] ?? "";
    expect(composed).toBeTypeOf("string");
    for (const script of [
      "check:repo",
      "check:fixtures",
      "check:history",
      "audit:licenses",
      "typecheck",
      "build",
      "ui:build",
    ]) {
      expect(composed).toContain(`npm run ${script}`);
    }
  });

  it("documents development-data isolation and known timeout guidance", () => {
    expect(contributing).toContain("JOB_NEARBY_APP_DATA_DIR");
    expect(contributing).toContain("JOB_NEARBY_DOCUMENT_DATA_DIR");
    expect(contributing).toContain("JOB_NEARBY_DATABASE_PATH");
    expect(contributing).toContain("%LOCALAPPDATA%\\JobNearby");
    expect(contributing).toContain("tests/infrastructure/DailyWorkQueue.test.ts");
    expect(contributing).toContain("tests/infrastructure/SqliteUserVacancyInteractionRepository.test.ts");
    expect(contributing).toContain("tests/persistence/PromanHistoricalRemediation.test.ts");
    expect(contributing).toContain("Do not raise timeouts");
  });

  it("does not contain machine-specific absolute paths", () => {
    for (const file of ["CONTRIBUTING.md", "README.md", ".github/pull_request_template.md"]) {
      expect(read(file)).not.toMatch(/[A-Za-z]:\\/u);
    }
  });
});

describe("GitHub issue configuration", () => {
  it("provides bug and feature forms with unique field ids", () => {
    for (const [file, template] of [
      [".github/ISSUE_TEMPLATE/bug_report.yml", bugTemplate],
      [".github/ISSUE_TEMPLATE/feature_request.yml", featureTemplate],
    ] as const) {
      expect(template.startsWith("name:"), file).toBe(true);
      expect(template).toContain("description:");
      expect(template).toContain("body:");
      const ids = yamlIds(template);
      expect(ids.length, file).toBeGreaterThan(0);
      expect(new Set(ids).size, file).toBe(ids.length);
    }
  });

  it("enables blank issues and routes security reports without encouraging public disclosure", () => {
    expect(issueConfig).toContain("blank_issues_enabled: true");
    expect(issueConfig).toContain("security/policy");
    expect(issueConfig).toContain("SECURITY.md");
    expect(issueConfig).not.toContain("@");
    const templates = readdirSync(resolve(root, ".github/ISSUE_TEMPLATE"));
    expect(templates.filter((file) => /security/iu.test(file))).toEqual([]);
  });

  it("puts the privacy warning and prohibited-data list in the bug form", () => {
    for (const term of [
      "Privacy warning",
      "job-nearby.sqlite",
      "backups",
      "exports",
      "CVs",
      "pairing",
      "synthetic or redacted",
      "SECURITY.md",
    ]) {
      expect(bugTemplate).toContain(term);
    }
    expect(bugTemplate).toContain("I have not attached a database");
    expect(bugTemplate).toContain("reproduction uses synthetic or redacted data");
  });

  it("keeps the feature form focused on the problem and local-first impact", () => {
    expect(featureTemplate).toContain("Problem or use case");
    expect(featureTemplate).toContain("Proposed behavior");
    expect(featureTemplate).toContain("Alternatives and workarounds");
    expect(featureTemplate).toContain("Local-first and privacy impact");
  });
});

describe("pull request template", () => {
  it("asks for testing, risk, security impact and the private-data check", () => {
    for (const term of [
      "What changed",
      "Why",
      "Testing",
      "Risk and compatibility",
      "Security impact",
      "Loopback HTTP APIs",
      "Extension permissions",
      "No real/private database",
      "Fixtures follow",
      "License/provenance",
      "Screenshots",
    ]) {
      expect(pullRequestTemplate).toContain(term);
    }
  });
});
