import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { startJobNearbyServer, type JobNearbyServerRuntime, type StartJobNearbyServerOptions } from "../../src/infrastructure/http/startJobNearbyServer.js";

const roots: string[] = [];
const runtimes: JobNearbyServerRuntime[] = [];

afterEach(async () => {
  await Promise.all(runtimes.splice(0).map((runtime) => runtime.close()));
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "job-nearby-security-"));
  roots.push(root);
  return root;
}

async function freeLoopbackPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const { port } = server.address() as AddressInfo;
  await new Promise<void>((done, fail) => server.close((error) => (error ? fail(error) : done())));
  return port;
}

async function startRuntime(options: StartJobNearbyServerOptions = {}): Promise<JobNearbyServerRuntime> {
  const runtime = await startJobNearbyServer({ applicationDataRoot: join(tempRoot(), "profile"), port: 0, ...options });
  runtimes.push(runtime);
  return runtime;
}

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

  it("requests only the active-tab scripting permissions and the local capture endpoint", () => {
    expect(manifest.manifest_version).toBe(3);
    expect(manifest.permissions).toEqual(["activeTab", "scripting"]);
    expect(manifest.host_permissions).toEqual(["http://127.0.0.1:4317/*"]);
    expect(manifest.background).toBeUndefined();
    expect(manifest.content_scripts).toBeUndefined();
    expect(manifest.externally_connectable).toBeUndefined();
  });
});

describe("loopback listeners", () => {
  it("refuses a non-loopback bind address", async () => {
    await expect(startJobNearbyServer({ host: "0.0.0.0", port: 0 })).rejects.toThrow(/loopback/u);
  });

  it("serves the API on 127.0.0.1 and reflects CORS only for the documented origins", async () => {
    const runtime = await startRuntime();
    expect(runtime.host).toBe("127.0.0.1");
    expect(runtime.url.startsWith("http://127.0.0.1:")).toBe(true);

    const sameOrigin = await fetch(`${runtime.url}/contacts`);
    expect(sameOrigin.status).toBe(200);
    expect(sameOrigin.headers.get("access-control-allow-origin")).toBeNull();

    const extension = await fetch(`${runtime.url}/contacts`, {
      headers: { Origin: "chrome-extension://abcdefghijklmnop" },
    });
    expect(extension.headers.get("access-control-allow-origin")).toBe("chrome-extension://abcdefghijklmnop");

    const unrelatedOrigin = await fetch(`${runtime.url}/contacts`, {
      headers: { Origin: "http://example.test" },
    });
    expect(unrelatedOrigin.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("exposes only the capture route on the fixed-port capture listener", async () => {
    const capturePort = await freeLoopbackPort();
    const runtime = await startRuntime({ extensionCapturePort: capturePort });

    const otherRoute = await fetch(`http://127.0.0.1:${capturePort}/contacts`);
    expect(otherRoute.status).toBe(404);

    const captureRoute = await fetch(`http://127.0.0.1:${capturePort}/acquisition/browser`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    expect(captureRoute.status).toBe(400);
    expect(runtime.port).toBeGreaterThan(0);
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
});
