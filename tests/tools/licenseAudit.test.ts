import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  buildInventory,
  classifyLicenseExpression,
  classifyLicenseId,
  detectLicenseFromText,
  formatInventoryJson,
  resolveLicense,
  severityFor,
} from "../../tools/licenseAudit.cjs";

const temporaryDirectories: string[] = [];

function makeDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "job-nearby-license-audit-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(() => {
  while (temporaryDirectories.length > 0) {
    const directory = temporaryDirectories.pop();
    if (directory) rmSync(directory, { recursive: true, force: true });
  }
});

function createFixtureRoot(
  packages: Record<string, unknown>,
  rootPackage: Record<string, unknown> = { name: "fixture", version: "1.0.0", license: "MIT" },
): string {
  const rootDir = makeDirectory();
  writeFileSync(join(rootDir, "package.json"), JSON.stringify(rootPackage));
  writeFileSync(
    join(rootDir, "package-lock.json"),
    JSON.stringify({ lockfileVersion: 3, packages: { "": {}, ...packages } }),
  );
  return rootDir;
}

function packageEntry(name: string, version: string, license: string, extra: Record<string, unknown> = {}): [string, unknown] {
  return [`node_modules/${name}`, { version, license, ...extra }];
}

describe("license identifier classification", () => {
  it("accepts MIT", () => {
    expect(classifyLicenseId("MIT")).toMatchObject({ kind: "accepted", licenseIds: ["MIT"] });
  });

  it("accepts ISC, BSD and Apache-2.0", () => {
    for (const identifier of ["ISC", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0"]) {
      expect(classifyLicenseId(identifier).kind, identifier).toBe("accepted");
    }
  });

  it("rejects unknown and missing identifiers", () => {
    expect(classifyLicenseId("Proprietary").kind).toBe("unknown");
    expect(classifyLicenseId("UNKNOWN").kind).toBe("unknown");
    expect(classifyLicenseId("").kind).toBe("unknown");
  });

  it("classifies copyleft licenses for explicit review rather than auto-rejecting them", () => {
    for (const identifier of ["GPL-3.0-only", "AGPL-3.0", "LGPL-2.1", "MPL-2.0", "SSPL-1.0", "BUSL-1.1"]) {
      expect(classifyLicenseId(identifier).kind, identifier).toBe("review");
    }
  });

  it("maps severity by distribution status", () => {
    expect(severityFor("accepted", true)).toBe("none");
    expect(severityFor("review", true)).toBe("blocker");
    expect(severityFor("review", false)).toBe("warning");
    expect(severityFor("unknown", true)).toBe("blocker");
  });
});

describe("SPDX expressions", () => {
  it("preserves and parses a parenthesised OR expression", () => {
    const result = classifyLicenseExpression("(MIT OR CC0-1.0)");
    expect(result.expression).toBe("(MIT OR CC0-1.0)");
    expect(result.parsed).toBe(true);
    expect(result.kind).toBe("accepted");
    expect(result.licenseIds).toEqual(["CC0-1.0", "MIT"]);
  });

  it("treats AND as the sum of obligations and OR as a choice", () => {
    expect(classifyLicenseExpression("MIT AND GPL-3.0").kind).toBe("review");
    expect(classifyLicenseExpression("MIT OR GPL-3.0").kind).toBe("accepted");
    expect(classifyLicenseExpression("(WTFPL OR MIT)").kind).toBe("accepted");
  });

  it("does not truncate expressions to their first token", () => {
    const result = classifyLicenseExpression("BSD-3-Clause AND Apache-2.0");
    expect(result.licenseIds).toEqual(["Apache-2.0", "BSD-3-Clause"]);
    expect(result.kind).toBe("accepted");
  });

  it("marks WITH exceptions for review", () => {
    expect(classifyLicenseExpression("Apache-2.0 WITH LLVM-exception").kind).toBe("review");
  });
});

describe("license file resolution", () => {
  it("resolves SEE LICENSE IN references by reading the referenced file", () => {
    const packageDir = makeDirectory();
    writeFileSync(join(packageDir, "LICENSE.custom"), "Permission is hereby granted, free of charge, to any person obtaining a copy\n");
    const resolved = resolveLicense(packageDir, "SEE LICENSE IN LICENSE.custom");
    expect(resolved).toEqual({ license: "MIT", source: "SEE LICENSE IN LICENSE.custom" });
  });

  it("falls back to an installed license file when metadata is missing", () => {
    const packageDir = makeDirectory();
    writeFileSync(join(packageDir, "COPYING"), "Apache License, Version 2.0\n");
    expect(resolveLicense(packageDir, undefined)).toMatchObject({ license: "Apache-2.0", source: "license file text" });
  });

  it("reports UNKNOWN when neither metadata nor a license file exists", () => {
    expect(resolveLicense(join(makeDirectory(), "absent"), undefined).license).toBe("UNKNOWN");
  });

  it("detects common license texts", () => {
    expect(detectLicenseFromText("Permission is hereby granted, free of charge")).toBe("MIT");
    expect(detectLicenseFromText("Redistribution and use in source and binary forms, with or without modification")).toBe(
      "BSD-2-Clause",
    );
    expect(detectLicenseFromText("Redistribution and use in source and binary forms\nNeither the name")).toBe("BSD-3-Clause");
    expect(detectLicenseFromText("GNU AFFERO GENERAL PUBLIC LICENSE")).toBe("AGPL-3.0");
    expect(detectLicenseFromText("something custom")).toBe("UNKNOWN");
  });
});

describe("inventory building", () => {
  it("distinguishes direct and transitive packages", () => {
    const rootDir = createFixtureRoot(
      Object.fromEntries([
        packageEntry("direct-mit", "1.0.0", "MIT"),
        packageEntry("transitive-mit", "2.0.0", "MIT"),
      ]),
      { name: "fixture", version: "1.0.0", license: "MIT", dependencies: { "direct-mit": "^1.0.0" } },
    );
    const inventory = buildInventory({ rootDir });
    const direct = inventory.packages.find((pkg) => pkg.name === "direct-mit");
    const transitive = inventory.packages.find((pkg) => pkg.name === "transitive-mit");
    expect(direct?.direct).toBe(true);
    expect(transitive?.direct).toBe(false);
  });

  it("blocks a copyleft production package but only warns for a dev-only one", () => {
    const rootDir = createFixtureRoot(
      Object.fromEntries([
        packageEntry("shipped-gpl", "1.0.0", "GPL-3.0-only"),
        packageEntry("dev-gpl", "1.0.0", "GPL-3.0-only", { dev: true }),
        packageEntry("dev-unknown", "1.0.0", "", { dev: true }),
        packageEntry("shipped-mit", "1.0.0", "MIT"),
      ]),
      { name: "fixture", version: "1.0.0", dependencies: { "shipped-mit": "^1.0.0" } },
    );
    const inventory = buildInventory({ rootDir });
    expect(inventory.packages.find((pkg) => pkg.name === "shipped-gpl")).toMatchObject({
      status: "REVIEW",
      severity: "blocker",
      distributed: true,
    });
    expect(inventory.packages.find((pkg) => pkg.name === "dev-gpl")).toMatchObject({
      status: "REVIEW",
      severity: "warning",
      distributed: false,
    });
    expect(inventory.packages.find((pkg) => pkg.name === "dev-unknown")).toMatchObject({
      status: "UNKNOWN",
      severity: "warning",
    });
    expect(inventory.summary.blockers).toBe(1);
    expect(inventory.summary.warnings).toBe(2);
  });

  it("treats UI libraries that are dev dependencies as distributed bundle code", () => {
    const rootDir = createFixtureRoot(
      Object.fromEntries([
        packageEntry("react", "19.2.8", "MIT", { dev: true }),
        packageEntry("react-dom", "19.2.8", "MIT", { dev: true }),
        packageEntry("scheduler", "0.27.0", "MIT", { dev: true }),
        packageEntry("vitest", "4.1.12", "MIT", { dev: true }),
      ]),
    );
    const inventory = buildInventory({ rootDir });
    expect(inventory.packages.find((pkg) => pkg.name === "react")).toMatchObject({
      production: false,
      distributed: true,
      distributedVia: "ui/dist bundle",
    });
    expect(inventory.packages.find((pkg) => pkg.name === "vitest")).toMatchObject({
      production: false,
      distributed: false,
    });
  });

  it("reports missing package metadata as UNKNOWN rather than assuming a license", () => {
    const rootDir = createFixtureRoot({ "node_modules/no-metadata": { version: "1.0.0" } });
    const inventory = buildInventory({ rootDir });
    expect(inventory.packages[0]).toMatchObject({ name: "no-metadata", license: "UNKNOWN", severity: "blocker" });
  });

  it("produces deterministic output for repeated runs", () => {
    const rootDir = createFixtureRoot(
      Object.fromEntries([
        packageEntry("zod", "4.6.7", "MIT"),
        packageEntry("better-sqlite3", "13.0.3", "MIT"),
      ]),
    );
    const first = formatInventoryJson(buildInventory({ rootDir }));
    const second = formatInventoryJson(buildInventory({ rootDir }));
    expect(second).toBe(first);
    expect(first).not.toMatch(/\d{4}-\d{2}-\d{2}T/u);
  });
});
