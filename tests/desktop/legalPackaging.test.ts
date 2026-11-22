import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const root = process.cwd();
const packageJson = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")) as {
  license?: string;
  scripts: Record<string, string>;
  build: {
    files: string[];
    extraResources?: Array<{ from: string; to: string }>;
  };
};

const read = (relativePath: string): string => readFileSync(resolve(root, relativePath), "utf8");

describe("job project license metadata", () => {
  it("declares MIT in package.json", () => {
    expect(packageJson.license).toBe("MIT");
  });

  it("ships the standard MIT license text with the established copyright holder", () => {
    const license = read("LICENSE");
    expect(license.startsWith("MIT License\n")).toBe(true);
    expect(license).toContain("Copyright (c) 2026 Alexey Antonenko");
    expect(license).toContain("Permission is hereby granted, free of charge");
    expect(license).toContain('THE SOFTWARE IS PROVIDED "AS IS"');
    expect(license).not.toMatch(/GNU|Apache License|BSD/iu);
  });

  it("keeps third-party notices separate from the project license", () => {
    const notices = read("THIRD_PARTY_NOTICES.md");
    for (const component of [
      "Electron",
      "Chromium",
      "Node.js",
      "SQLite",
      "better-sqlite3",
      "node-addon-api",
      "zod",
      "React",
      "scheduler",
      "NSIS",
      "7-Zip",
    ]) {
      expect(notices, component).toContain(component);
    }
    expect(notices).toContain("Third-Party Notices");
    expect(notices).toContain("docs/THIRD_PARTY_LICENSES.json");
  });
});

describe("packaging of legal resources", () => {
  it("installs LICENSE and third-party notices as immutable app resources", () => {
    expect(packageJson.build.extraResources).toContainEqual({ from: "LICENSE", to: "LICENSE.txt" });
    expect(packageJson.build.extraResources).toContainEqual({
      from: "THIRD_PARTY_NOTICES.md",
      to: "THIRD_PARTY_NOTICES.md",
    });
    // Legal documents are installed resources, not dev documentation inside app.asar.
    expect(packageJson.build.files).not.toContain("LICENSE");
    expect(packageJson.build.files).not.toContain("THIRD_PARTY_NOTICES.md");
    expect(packageJson.build.files).not.toContain("docs/**/*");
  });

  it("verifies packaged legal resources as part of desktop:package and as a dedicated command", () => {
    expect(packageJson.scripts["desktop:package"]).toContain("verifyPackagedLegal.cjs");
    expect(packageJson.scripts["verify:packaged-legal"]).toContain("verifyPackagedLegal.cjs");
    expect(packageJson.scripts["audit:licenses"]).toContain("tools/auditLicenses.cjs");
    expect(packageJson.scripts["check:repo"]).toContain("checkRepositoryHygiene.cjs");
  });

  it("keeps Electron's own canonical notices in the packaged app when artifacts exist", () => {
    const unpacked = resolve(root, "release", "win-unpacked");
    if (!existsSync(unpacked)) return;
    expect(existsSync(resolve(unpacked, "LICENSE.electron.txt"))).toBe(true);
    expect(existsSync(resolve(unpacked, "LICENSES.chromium.html"))).toBe(true);
    expect(readFileSync(resolve(unpacked, "LICENSE.electron.txt"), "utf8")).toContain("Permission is hereby granted");
  });

  it("installs legal resources beside app.asar when artifacts exist", () => {
    const resources = resolve(root, "release", "win-unpacked", "resources");
    if (!existsSync(resolve(root, "release", "win-unpacked"))) return;
    expect(existsSync(resolve(resources, "LICENSE.txt"))).toBe(true);
    expect(existsSync(resolve(resources, "THIRD_PARTY_NOTICES.md"))).toBe(true);
    expect(readFileSync(resolve(resources, "LICENSE.txt"), "utf8")).toContain("MIT License");
    expect(readFileSync(resolve(resources, "THIRD_PARTY_NOTICES.md"), "utf8")).toContain("Third-Party Notices");
  });
});
