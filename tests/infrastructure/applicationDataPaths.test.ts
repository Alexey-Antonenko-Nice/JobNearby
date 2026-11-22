import { describe, expect, it } from "vitest";

import { resolveApplicationDataPaths } from "../../src/infrastructure/storage/applicationDataPaths.js";

describe("application data paths", () => {
  it("places production database, managed documents and backup defaults under stable per-user roots", () => {
    const paths = resolveApplicationDataPaths({
      applicationDataRoot: "C:\\Users\\fixture\\AppData\\Local\\JobNearby",
      env: {},
      platform: "win32",
      home: "C:\\Users\\fixture",
    });
    expect(paths.databasePath).toBe("C:\\Users\\fixture\\AppData\\Local\\JobNearby\\job-nearby.sqlite");
    expect(paths.documentDataDir).toBe("C:\\Users\\fixture\\AppData\\Local\\JobNearby");
    expect(paths.defaultBackupDir).toBe("C:\\Users\\fixture\\AppData\\Local\\JobNearby-Backups");
  });

  it("retains explicit database and document overrides", () => {
    const paths = resolveApplicationDataPaths({
      applicationDataRoot: "C:\\Users\\fixture\\AppData\\Local\\JobNearby",
      databasePath: "D:\\JobNearby\\custom.sqlite",
      documentDataDir: "D:\\JobNearby\\documents",
      env: {},
      platform: "win32",
    });
    expect(paths.databasePath).toBe("D:\\JobNearby\\custom.sqlite");
    expect(paths.documentDataDir).toBe("D:\\JobNearby\\documents");
  });
});
