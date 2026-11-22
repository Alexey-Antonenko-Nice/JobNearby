import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const packageJson = JSON.parse(readFileSync(resolve(process.cwd(), "package.json"), "utf8")) as {
  name: string;
  version: string;
  main: string;
  scripts: Record<string, string>;
  allowScripts: Record<string, boolean>;
  build: {
    appId: string;
    productName: string;
    directories: { output: string };
    files: string[];
    asar: boolean;
    asarUnpack: string[];
    npmRebuild: boolean;
    win: {
      target: Array<{ target: string; arch: string[] }>;
      executableName: string;
      artifactName: string;
    };
    nsis: {
      perMachine: boolean;
      allowElevation: boolean;
      createDesktopShortcut: boolean;
      createStartMenuShortcut: boolean;
      deleteAppDataOnUninstall: boolean;
    };
  };
};

describe("Windows desktop packaging configuration", () => {
  it("defines stable Windows x64 app metadata and versioned NSIS installer output", () => {
    expect(packageJson.name).toBe("job-nearby");
    expect(packageJson.version).toMatch(/^\d+\.\d+\.\d+$/u);
    expect(packageJson.main).toBe("desktop/main.cjs");
    expect(packageJson.build.appId).toBe("com.jobnearby.desktop");
    expect(packageJson.build.productName).toBe("Job Nearby");
    expect(packageJson.build.directories.output).toBe("release");
    expect(packageJson.build.win.target).toContainEqual({ target: "nsis", arch: ["x64"] });
    expect(packageJson.build.win.executableName).toBe("Job Nearby");
    expect(packageJson.build.win.artifactName).toContain("${version}");
    expect(packageJson.build.nsis).toMatchObject({
      perMachine: false,
      allowElevation: false,
      createDesktopShortcut: false,
      createStartMenuShortcut: true,
      deleteAppDataOnUninstall: false,
    });
    expect(packageJson.allowScripts).toMatchObject({
      "better-sqlite3@13.0.3": true,
      "electron@42.11.18": true,
    });
  });

  it("packages only built app resources and rebuilds/unpacks the native SQLite module", () => {
    const { files, asar, asarUnpack, npmRebuild } = packageJson.build;
    for (const resource of ["desktop/main.cjs", "dist/**/*", "ui/dist/**/*", "package.json"]) {
      expect(files).toContain(resource);
    }
    for (const exclusion of [
      "!tests/**",
      "!**/fixtures/**",
      "!node_modules/better-sqlite3/build/**",
      "!node_modules/better-sqlite3/src/**",
      "!node_modules/better-sqlite3/deps/**",
      "!node_modules/better-sqlite3/binding.gyp",
      "!node_modules/better-sqlite3/prebuilds/darwin-*.node",
      "!node_modules/better-sqlite3/prebuilds/linux*.node",
      "!node_modules/better-sqlite3/prebuilds/win32-arm64.node",
      "!**/*.map",
      "!**/*.sqlite",
      "!**/*.db",
      "!**/.env*",
    ]) {
      expect(files).toContain(exclusion);
    }
    expect(asar).toBe(true);
    expect(asarUnpack).toContain("**/*.node");
    expect(npmRebuild).toBe(false);
    expect(packageJson.scripts["desktop:package"]).toContain("desktop:rebuild-native");
    expect(packageJson.scripts["desktop:package"]).toContain("writeInstallerChecksum.cjs");
    expect(packageJson.scripts["desktop:clean"]).toContain("cleanDesktopArtifacts.cjs");
    expect(readFileSync(resolve(process.cwd(), ".gitignore"), "utf8")).toMatch(/^release\/$/mu);
  });
});
