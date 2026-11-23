import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("desktop shell security configuration", () => {
  const main = readFileSync(resolve(process.cwd(), "desktop", "main.cjs"), "utf8");

  it("binds the UI/API server and the extension capture listener to loopback only", () => {
    expect(main).toContain('host: "127.0.0.1"');
    expect(main).toContain("port: 0");
    expect(main).toContain("extensionCapturePort: 4317");
  });

  it("hardens the BrowserWindow and does not expose privileged bridges", () => {
    expect(main).toMatch(/contextIsolation:\s*true/u);
    expect(main).toMatch(/nodeIntegration:\s*false/u);
    expect(main).toMatch(/sandbox:\s*true/u);
    expect(main).not.toMatch(/preload\s*:/u);
    expect(main).not.toMatch(/ipcMain|ipcRenderer|contextBridge/u);
    expect(main).not.toMatch(/shell\.(openExternal|openPath|showItemInFolder)/u);
    expect(main).not.toMatch(/child_process|execSync|spawnSync|spawn\(/u);
    expect(main).not.toMatch(/developmentUiOrigins/u);
  });
});

describe("browser extension permissions", () => {
  const manifest = JSON.parse(readFileSync(resolve(process.cwd(), "browser-extension", "manifest.json"), "utf8")) as {
    manifest_version: number;
    permissions: string[];
    host_permissions: string[];
    background?: unknown;
    content_scripts?: unknown;
    externally_connectable?: unknown;
  };

  it("requests only active-tab scripting, session storage and the local capture endpoint", () => {
    expect(manifest.manifest_version).toBe(3);
    expect(manifest.permissions).toEqual(["activeTab", "scripting", "storage"]);
    expect(manifest.host_permissions).toEqual(["http://127.0.0.1:4317/*"]);
    expect(manifest.background).toBeUndefined();
    expect(manifest.content_scripts).toBeUndefined();
    expect(manifest.externally_connectable).toBeUndefined();
  });

  it("captures a pairing credential through extension storage and sends an auth header", () => {
    const popup = readFileSync(resolve(process.cwd(), "browser-extension", "popup.js"), "utf8");
    expect(popup).toContain("chrome.storage");
    expect(popup).toContain("X-Job-Nearby-Extension");
    expect(popup).toContain("http://127.0.0.1:4317");
  });
});

describe("privacy and security documentation", () => {
  it("tracks the public privacy and security documents and links them from the README", () => {
    const readme = readFileSync(resolve(process.cwd(), "README.md"), "utf8");
    for (const file of ["SECURITY.md", "docs/PRIVACY.md", "docs/SECURITY_MODEL.md", "LICENSE", "THIRD_PARTY_NOTICES.md"]) {
      expect(existsSync(resolve(process.cwd(), file)), file).toBe(true);
    }
    for (const link of ["(docs/PRIVACY.md)", "(docs/SECURITY_MODEL.md)", "(SECURITY.md)", "(LICENSE)", "(THIRD_PARTY_NOTICES.md)"]) {
      expect(readme, link).toContain(link);
    }
  });

  it("does not contain unsupported absolute privacy claims", () => {
    const readme = readFileSync(resolve(process.cwd(), "README.md"), "utf8");
    for (const claim of [
      "never connects to the internet",
      "no data is sent anywhere",
      "all data stays on your device",
      "secure by design",
      "fully encrypted",
    ]) {
      expect(readme.toLowerCase()).not.toContain(claim);
    }
  });

  it("documents loopback authorization as resolved rather than an open blocker", () => {
    const model = readFileSync(resolve(process.cwd(), "docs", "SECURITY_MODEL.md"), "utf8");
    expect(model).toMatch(/loopback/i);
    expect(model).toContain("session credential");
    expect(model).not.toMatch(/F1[\s\S]{0,200}release blocker/iu);
  });
});
