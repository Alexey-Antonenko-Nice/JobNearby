import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { checkTrackedFiles, classifyTrackedPath, findSecret } from "../../tools/checkRepositoryHygiene.cjs";
import { buildInventory } from "../../tools/licenseAudit.cjs";

const root = process.cwd();
const gitignore = readFileSync(resolve(root, ".gitignore"), "utf8").split(/\r?\n/u);

function ignores(pattern: string): boolean {
  return gitignore.some((line) => line.trim() === pattern);
}

describe(".gitignore covers generated and private runtime data", () => {
  it("ignores build outputs and dependency directories", () => {
    for (const pattern of ["node_modules/", "dist/", "release/", "coverage/"]) {
      expect(ignores(pattern), pattern).toBe(true);
    }
  });

  it("ignores local databases, environment files and logs", () => {
    for (const pattern of ["*.sqlite", "*.sqlite-wal", "*.sqlite-shm", "*.db", "*.db-wal", "*.db-shm", ".env", ".env.*", "*.log"]) {
      expect(ignores(pattern), pattern).toBe(true);
    }
  });

  it("ignores backup archives, exports and the managed document store", () => {
    for (const pattern of ["*.zip", "backups/", "exports/", "managed-documents/"]) {
      expect(ignores(pattern), pattern).toBe(true);
    }
  });

  it("does not ignore legal files or source required for builds", () => {
    expect(ignores("LICENSE")).toBe(false);
    expect(ignores("THIRD_PARTY_NOTICES.md")).toBe(false);
    expect(ignores("src/")).toBe(false);
  });
});

describe("tracked-path classification", () => {
  it("rejects generated artifacts and local data", () => {
    expect(classifyTrackedPath("release/win-unpacked/Job Nearby.exe")?.category).toBe("forbidden-directory");
    expect(classifyTrackedPath("dist/infrastructure/app.js")?.category).toBe("forbidden-directory");
    expect(classifyTrackedPath("ui/dist/assets/index.js")?.category).toBe("forbidden-directory");
    expect(classifyTrackedPath("job-nearby.sqlite")?.category).toBe("forbidden-extension");
    expect(classifyTrackedPath("job-nearby.sqlite-wal")?.category).toBe("forbidden-extension");
    expect(classifyTrackedPath("backups/job-nearby-backup.zip")?.category).toBe("forbidden-directory");
    expect(classifyTrackedPath("managed-documents/abc/cv.pdf")?.category).toBe("forbidden-directory");
  });

  it("allows source, tests and documentation", () => {
    for (const path of ["src/domain/vacancy.ts", "tests/fixtures/greenhouse.html", "docs/ARCHITECTURE.md", "package-lock.json"]) {
      expect(classifyTrackedPath(path), path).toBeNull();
    }
  });

  it("reports the line and category of a high-confidence secret without echoing it", () => {
    // Built at runtime so this test file never matches the repository secret scan itself.
    const awsKey = ["AKIA", "ABCDEFGHIJKLMNOP"].join("");
    const privateKey = ["-----BEGIN", "RSA PRIVATE KEY-----"].join(" ");
    expect(findSecret(`const key = "${awsKey}";`)).toMatchObject({ line: 1, category: "AWS access key id" });
    expect(findSecret(privateKey)).toMatchObject({ category: "private key block" });
    expect(findSecret("normal source line")).toBeNull();
  });

  it("returns no findings for the repository's own tracked source paths", () => {
    const tracked = [
      "src/domain/vacancy.ts",
      "ui/src/main.tsx",
      "tools/auditLicenses.cjs",
      "docs/LICENSING.md",
      "package-lock.json",
      "tests/fixtures/example.html",
    ];
    expect(checkTrackedFiles(root, tracked)).toEqual([]);
  });
});

describe("production dependency license readiness", () => {
  const inventory = buildInventory({ rootDir: root });

  it("uses the audited MIT project license", () => {
    expect(inventory.project.license).toBe("MIT");
  });

  it("has no distributed dependency with an unreviewed license", () => {
    expect(inventory.summary.blockers).toBe(0);
    for (const pkg of inventory.packages.filter((entry) => entry.distributed)) {
      expect(pkg.status, `${pkg.name}@${pkg.version}`).toBe("OK");
    }
  });

  it("keeps the shipped npm runtime to the audited set", () => {
    const distributed = inventory.packages
      .filter((pkg) => pkg.distributed)
      .map((pkg) => pkg.name)
      .sort();
    expect(distributed).toEqual(["better-sqlite3", "node-addon-api", "react", "react-dom", "scheduler", "zod"]);
  });
});
