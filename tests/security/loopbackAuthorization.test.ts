import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import type { IncomingHttpHeaders } from "node:http";
import { createServer } from "node:net";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { createBrowserCaptureServer } from "../../src/infrastructure/http/createBrowserCaptureServer.js";
import {
  generateSessionToken,
  SESSION_TOKEN_BYTES,
} from "../../src/infrastructure/http/loopbackSecurity.js";
import { startJobNearbyServer, type JobNearbyServerRuntime } from "../../src/infrastructure/http/startJobNearbyServer.js";

const DESKTOP_HEADER = "x-job-nearby-session";
const EXTENSION_HEADER = "x-job-nearby-extension";

interface RawResult {
  readonly status: number;
  readonly headers: IncomingHttpHeaders;
  readonly body: string;
}

function rawRequest(
  port: number,
  path: string,
  options: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    omitContentType?: boolean;
  } = {},
): Promise<RawResult> {
  return new Promise((resolve, reject) => {
    const body = options.body ?? "";
    const headers: Record<string, string> = {
      ...(options.omitContentType === true ? {} : { "Content-Type": "application/json" }),
      ...(options.body === undefined ? {} : { "Content-Length": String(Buffer.byteLength(body)) }),
      ...options.headers,
    };
    const request = httpRequest(
      { host: "127.0.0.1", port, path, method: options.method ?? "POST", headers },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () =>
          resolve({ status: response.statusCode ?? 0, headers: response.headers, body: Buffer.concat(chunks).toString("utf8") }),
        );
      },
    );
    request.on("error", reject);
    if (body.length > 0) request.write(body);
    request.end();
  });
}

async function freeLoopbackPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const { port } = server.address() as AddressInfo;
  await new Promise<void>((done, fail) => server.close((error) => (error ? fail(error) : done())));
  return port;
}

const CAPTURE_BODY = JSON.stringify({
  pageUrl: "https://example.test/job/1",
  pageTitle: "Test vacancy",
  visibleText: "Test vacancy text",
  capturedAt: "2026-11-23T08:00:00.000Z",
  html: "<html><body>Test vacancy text</body></html>",
});

const captureResult = {
  capture: { observationId: "observation", acquisitionId: "acquisition", observedAt: new Date("2026-11-23T08:00:00Z") },
  processing: { status: "PROCESSED" },
};

async function startMockServer(security: {
  role: "desktop" | "extension";
  desktopToken: string;
  extensionToken: string;
  developmentUiOrigins?: readonly string[];
  captureRateLimit?: { capacity: number; refillPerSecond: number };
  staticUiDirectory?: string;
}): Promise<{ port: number; capture: ReturnType<typeof vi.fn>; close: () => Promise<void> }> {
  const capture = vi.fn(async () => captureResult);
  const server = createBrowserCaptureServer(
    { captureAndProcessBrowserVacancy: capture as never },
    {
      ...(security.staticUiDirectory === undefined ? {} : { staticUiDirectory: security.staticUiDirectory }),
      ...(security.role === "extension" ? { captureOnly: true } : {}),
      security: {
        role: security.role,
        desktopToken: security.desktopToken,
        extensionToken: security.extensionToken,
        ...(security.developmentUiOrigins === undefined ? {} : { developmentUiOrigins: security.developmentUiOrigins }),
        ...(security.captureRateLimit === undefined ? {} : { captureRateLimit: security.captureRateLimit }),
      },
    },
  );
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const { port } = server.address() as AddressInfo;
  return {
    port,
    capture,
    close: () => new Promise<void>((done, fail) => server.close((error) => (error ? fail(error) : done()))),
  };
}

const temporaryRoots: string[] = [];
let runtime: JobNearbyServerRuntime;
let capturePort: number;
let desktopHeader: Record<string, string>;
let sameOrigin: string;

beforeAll(async () => {
  const root = mkdtempSync(join(tmpdir(), "job-nearby-m252-"));
  temporaryRoots.push(root);
  capturePort = await freeLoopbackPort();
  runtime = await startJobNearbyServer({
    applicationDataRoot: join(root, "profile"),
    port: 0,
    extensionCapturePort: capturePort,
  });
  desktopHeader = { [DESKTOP_HEADER]: runtime.authorization.desktopToken };
  sameOrigin = `http://127.0.0.1:${runtime.port}`;
});

afterAll(async () => {
  await runtime.close();
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("session credential", () => {
  it("is generated per process with 256 bits of randomness", async () => {
    const second = await startJobNearbyServer({ applicationDataRoot: join(temporaryRoots[0]!, "second"), port: 0 });
    try {
      expect(runtime.authorization.desktopToken).not.toBe(second.authorization.desktopToken);
      expect(runtime.authorization.extensionToken).not.toBe(second.authorization.extensionToken);
      expect(runtime.authorization.desktopToken).not.toBe(runtime.authorization.extensionToken);
      for (const token of [runtime.authorization.desktopToken, runtime.authorization.extensionToken]) {
        expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/u);
        expect(Buffer.from(token, "base64url")).toHaveLength(SESSION_TOKEN_BYTES);
      }
      expect(generateSessionToken()).not.toBe(generateSessionToken());
    } finally {
      await second.close();
    }
  });

  it("is not exposed in the runtime URL or in error responses", async () => {
    expect(runtime.url).not.toContain(runtime.authorization.desktopToken);
    const response = await rawRequest(runtime.port, "/contacts", {
      method: "GET",
      headers: { [DESKTOP_HEADER]: "wrong-token-value" },
    });
    expect(response.status).toBe(401);
    expect(response.body).not.toContain(runtime.authorization.desktopToken);
    expect(response.body).not.toContain("wrong-token-value");
  });

  it("rotates when the desktop restarts", async () => {
    const restarted = await startJobNearbyServer({ applicationDataRoot: join(temporaryRoots[0]!, "restart"), port: 0 });
    try {
      const stale = await rawRequest(restarted.port, "/contacts", {
        method: "GET",
        headers: desktopHeader,
      });
      expect(stale.status).toBe(401);
      const fresh = await rawRequest(restarted.port, "/contacts", {
        method: "GET",
        headers: { [DESKTOP_HEADER]: restarted.authorization.desktopToken },
      });
      expect(fresh.status).toBe(200);
    } finally {
      await restarted.close();
    }
  });
});

describe("desktop API authorization", () => {
  it("rejects missing, malformed and wrong credentials before domain work", async () => {
    for (const headers of [{}, { [DESKTOP_HEADER]: "" }, { [DESKTOP_HEADER]: "short" }, { [DESKTOP_HEADER]: "x".repeat(43) }]) {
      const response = await rawRequest(runtime.port, "/contacts", { method: "GET", headers });
      expect(response.status).toBe(401);
    }
  });

  it("serves protected reads only with the desktop credential", async () => {
    expect((await rawRequest(runtime.port, "/contacts", { method: "GET" })).status).toBe(401);
    const authorized = await rawRequest(runtime.port, "/contacts", { method: "GET", headers: desktopHeader });
    expect(authorized.status).toBe(200);
    expect(authorized.headers["cache-control"]).toBe("no-store");
    expect(authorized.headers["content-security-policy"]).toBeUndefined();
  });

  it("protects document download and vacancy read routes", async () => {
    expect((await rawRequest(runtime.port, "/documents/versions/00000000-0000-4000-8000-000000000000/content", { method: "GET" })).status).toBe(401);
    expect((await rawRequest(runtime.port, "/vacancies", { method: "GET" })).status).toBe(401);
  });

  it("rejects the extension credential on desktop routes", async () => {
    const response = await rawRequest(runtime.port, "/contacts", {
      method: "GET",
      headers: { [EXTENSION_HEADER]: runtime.authorization.extensionToken },
    });
    expect(response.status).toBe(401);
  });

  it("exposes the extension pairing code only to the authorized desktop session", async () => {
    expect((await rawRequest(runtime.port, "/extension/pairing", { method: "GET" })).status).toBe(401);
    expect(
      (await rawRequest(runtime.port, "/extension/pairing", { method: "GET", headers: { [EXTENSION_HEADER]: runtime.authorization.extensionToken } })).status,
    ).toBe(401);
    const response = await rawRequest(runtime.port, "/extension/pairing", { method: "GET", headers: desktopHeader });
    expect(response.status).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ token: runtime.authorization.extensionToken });
    expect(response.headers["cache-control"]).toBe("no-store");
  });
});

describe("Host validation and DNS rebinding", () => {
  it("accepts the exact loopback host and rejects other names or ports", async () => {
    const ok = await rawRequest(runtime.port, "/contacts", { method: "GET", headers: desktopHeader });
    expect(ok.status).toBe(200);

    for (const host of ["localhost", `127.0.0.1:${runtime.port + 1}`, "attacker.example", `attacker.example:${runtime.port}`]) {
      const response = await rawRequest(runtime.port, "/contacts", {
        method: "GET",
        headers: { ...desktopHeader, Host: host },
      });
      expect(response.status, host).toBe(403);
    }
  });

  it("rejects a DNS-rebinding style request with a foreign Host and Origin", async () => {
    const response = await rawRequest(runtime.port, "/backup/create", {
      headers: { ...desktopHeader, Host: `attacker.example:${runtime.port}`, Origin: "https://attacker.example" },
      body: JSON.stringify({ destinationPath: join(tmpdir(), "rebind.zip") }),
    });
    expect(response.status).toBe(403);
    expect(existsSync(join(tmpdir(), "rebind.zip"))).toBe(false);
  });

  it("requires the capture listener Host to match its own port", async () => {
    const response = await rawRequest(capturePort, "/acquisition/browser", {
      headers: { [EXTENSION_HEADER]: runtime.authorization.extensionToken, Host: `127.0.0.1:${capturePort + 1}` },
      body: CAPTURE_BODY,
    });
    expect(response.status).toBe(403);
  });
});

describe("Origin policy", () => {
  it("accepts the same desktop origin and rejects foreign/null origins", async () => {
    const same = await rawRequest(runtime.port, "/contacts", {
      method: "GET",
      headers: { ...desktopHeader, Origin: sameOrigin },
    });
    expect(same.status).toBe(200);

    for (const origin of ["http://evil.example", "https://evil.example", "null"]) {
      const response = await rawRequest(runtime.port, "/contacts", {
        method: "GET",
        headers: { ...desktopHeader, Origin: origin },
      });
      expect(response.status, origin).toBe(403);
    }
  });

  it("checks Origin before the credential", async () => {
    const response = await rawRequest(runtime.port, "/backup/create", {
      headers: { Origin: "http://evil.example" },
      body: CAPTURE_BODY,
    });
    expect(response.status).toBe(403);
  });

  it("rejects the dev origin in the packaged/production configuration", async () => {
    const response = await rawRequest(runtime.port, "/contacts", {
      method: "GET",
      headers: { ...desktopHeader, Origin: "http://127.0.0.1:5173" },
    });
    expect(response.status).toBe(403);
  });

  it("allows the configured development origin and dev bootstrap only in dev mode", async () => {
    const root = mkdtempSync(join(tmpdir(), "job-nearby-dev-"));
    temporaryRoots.push(root);
    const dev = await startJobNearbyServer({
      applicationDataRoot: join(root, "profile"),
      port: 0,
      developmentUiOrigins: ["http://127.0.0.1:5173"],
    });
    try {
      const bootstrap = await rawRequest(dev.port, "/dev/session", {
        method: "GET",
        headers: { Origin: "http://127.0.0.1:5173" },
      });
      expect(bootstrap.status).toBe(200);
      expect(JSON.parse(bootstrap.body)).toEqual({ token: dev.authorization.desktopToken });
      expect(bootstrap.headers["access-control-allow-origin"]).toBe("http://127.0.0.1:5173");

      const api = await rawRequest(dev.port, "/contacts", {
        method: "GET",
        headers: { [DESKTOP_HEADER]: dev.authorization.desktopToken, Origin: "http://127.0.0.1:5173" },
      });
      expect(api.status).toBe(200);

      const foreign = await rawRequest(dev.port, "/dev/session", {
        method: "GET",
        headers: { Origin: "http://evil.example" },
      });
      expect(foreign.status).toBe(403);
    } finally {
      await dev.close();
    }

    const production = await rawRequest(runtime.port, "/dev/session", {
      method: "GET",
      headers: { Origin: "http://127.0.0.1:5173" },
    });
    expect(production.status).toBe(403);
  });
});

describe("preflight", () => {
  it("answers permitted extension preflight without exposing credentials", async () => {
    const response = await rawRequest(capturePort, "/acquisition/browser", {
      method: "OPTIONS",
      headers: { Origin: "chrome-extension://abcdefghijklmnop" },
    });
    expect(response.status).toBe(204);
    expect(response.headers["access-control-allow-origin"]).toBe("chrome-extension://abcdefghijklmnop");
    expect(response.headers["access-control-allow-headers"]).toContain(EXTENSION_HEADER);
    expect(response.headers["access-control-allow-methods"]).toContain("POST");
    expect(response.headers.vary).toContain("Origin");
    expect(response.body).toBe("");
  });

  it("rejects preflight from a foreign origin without CORS permissions", async () => {
    const response = await rawRequest(runtime.port, "/contacts", {
      method: "OPTIONS",
      headers: { Origin: "http://evil.example" },
    });
    expect(response.status).toBe(403);
    expect(response.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("uses the desktop header in same-origin preflight", async () => {
    const response = await rawRequest(runtime.port, "/contacts", {
      method: "OPTIONS",
      headers: { Origin: sameOrigin },
    });
    expect(response.status).toBe(204);
    expect(response.headers["access-control-allow-headers"]).toContain(DESKTOP_HEADER);
  });
});

describe("content type enforcement", () => {
  it("rejects text/plain and form requests before parsing or domain work", async () => {
    const destination = join(tmpdir(), `job-nearby-attack-${Date.now()}.zip`);
    for (const contentType of ["text/plain", "application/x-www-form-urlencoded", "multipart/form-data"]) {
      const response = await rawRequest(runtime.port, "/backup/create", {
        headers: { ...desktopHeader, Origin: sameOrigin, "Content-Type": contentType },
        body: JSON.stringify({ destinationPath: destination }),
      });
      expect(response.status, contentType).toBe(415);
      expect(existsSync(destination)).toBe(false);
    }
  });

  it("accepts JSON with a charset parameter", async () => {
    const destination = join(tmpdir(), `job-nearby-ok-${Date.now()}.zip`);
    const response = await rawRequest(runtime.port, "/backup/create", {
      headers: { ...desktopHeader, Origin: sameOrigin, "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({ destinationPath: destination }),
    });
    expect(response.status).toBe(201);
    expect(existsSync(destination)).toBe(true);
    if (existsSync(destination)) rmSync(destination, { force: true });
  });

  it("does not invoke capture processing for a text/plain capture", async () => {
    const desktopToken = "desktop-token-0123456789-0123456789-0123456789-0123456789";
    const extensionToken = "extension-token-0123456789-0123456789-0123456789";
    const server = await startMockServer({ role: "desktop", desktopToken, extensionToken });
    try {
      const response = await rawRequest(server.port, "/acquisition/browser", {
        headers: { [DESKTOP_HEADER]: desktopToken, "Content-Type": "text/plain" },
        body: CAPTURE_BODY,
      });
      expect(response.status).toBe(415);
      expect(server.capture).not.toHaveBeenCalled();
    } finally {
      await server.close();
    }
  });
});

describe("mutation side effects are blocked before work", () => {
  it("reproduces the M25.1 simple-request attack class and rejects it", async () => {
    const backupPath = join(tmpdir(), `job-nearby-m251-attack-${Date.now()}.zip`);
    const exportPath = join(tmpdir(), `job-nearby-m251-attack-${Date.now()}.json`);
    const attacks = [
      { port: capturePort, path: "/acquisition/browser", body: CAPTURE_BODY },
      { port: runtime.port, path: "/backup/create", body: JSON.stringify({ destinationPath: backupPath }) },
      { port: runtime.port, path: "/export/json", body: JSON.stringify({ destinationPath: exportPath }) },
      {
        port: runtime.port,
        path: "/backup/restore",
        body: JSON.stringify({ archivePath: join(tmpdir(), "does-not-exist.zip"), confirm: true }),
      },
    ];
    for (const attack of attacks) {
      const response = await rawRequest(attack.port, attack.path, {
        headers: { Origin: "http://evil.example", "Content-Type": "text/plain" },
        body: attack.body,
      });
      expect(response.status, attack.path).toBe(403);
    }
    expect(existsSync(backupPath)).toBe(false);
    expect(existsSync(exportPath)).toBe(false);
  });

  it("does not create backups, exports or restore state without authorization", async () => {
    const backupPath = join(tmpdir(), `job-nearby-unauthorized-${Date.now()}.zip`);
    const exportPath = join(tmpdir(), `job-nearby-unauthorized-${Date.now()}.json`);

    const backup = await rawRequest(runtime.port, "/backup/create", { body: JSON.stringify({ destinationPath: backupPath }) });
    expect(backup.status).toBe(401);
    expect(existsSync(backupPath)).toBe(false);

    const exported = await rawRequest(runtime.port, "/export/json", { body: JSON.stringify({ destinationPath: exportPath }) });
    expect(exported.status).toBe(401);
    expect(existsSync(exportPath)).toBe(false);

    const restore = await rawRequest(runtime.port, "/backup/restore", {
      body: JSON.stringify({ archivePath: join(tmpdir(), "does-not-exist.zip"), confirm: true }),
    });
    expect(restore.status).toBe(401);
  });

  it("rejects unauthorized capture on the fixed listener", async () => {
    const response = await rawRequest(capturePort, "/acquisition/browser", { body: CAPTURE_BODY });
    expect(response.status).toBe(401);
  });
});

describe("listener scope and extension capture", () => {
  it("does not expose desktop routes on the capture listener", async () => {
    const response = await rawRequest(capturePort, "/contacts", {
      method: "GET",
      headers: { [EXTENSION_HEADER]: runtime.authorization.extensionToken },
    });
    expect(response.status).toBe(404);
  });

  it("rejects the desktop credential on the capture listener", async () => {
    const response = await rawRequest(capturePort, "/acquisition/browser", {
      headers: { [DESKTOP_HEADER]: runtime.authorization.desktopToken },
      body: CAPTURE_BODY,
    });
    expect(response.status).toBe(401);
  });

  it("accepts authorized capture and keeps the extension credential scoped", async () => {
    const desktopToken = generateSessionToken();
    const extensionToken = generateSessionToken();
    const desktop = await startMockServer({ role: "desktop", desktopToken, extensionToken });
    const extension = await startMockServer({ role: "extension", desktopToken, extensionToken });
    try {
      const desktopCapture = await rawRequest(desktop.port, "/acquisition/browser", {
        headers: { [DESKTOP_HEADER]: desktopToken },
        body: CAPTURE_BODY,
      });
      expect(desktopCapture.status).toBe(201);

      const extensionCapture = await rawRequest(extension.port, "/acquisition/browser", {
        headers: { [EXTENSION_HEADER]: extensionToken, Origin: "chrome-extension://abcdefghijklmnop" },
        body: CAPTURE_BODY,
      });
      expect(extensionCapture.status).toBe(201);

      const wrongScope = await rawRequest(desktop.port, "/acquisition/browser", {
        headers: { [EXTENSION_HEADER]: extensionToken },
        body: CAPTURE_BODY,
      });
      expect(wrongScope.status).toBe(401);
    } finally {
      await desktop.close();
      await extension.close();
    }
  });
});

describe("rate limiting", () => {
  it("allows a burst then returns 429, and a new server resets the limiter", async () => {
    const desktopToken = generateSessionToken();
    const extensionToken = generateSessionToken();
    const limited = await startMockServer({
      role: "extension",
      desktopToken,
      extensionToken,
      captureRateLimit: { capacity: 1, refillPerSecond: 0 },
    });
    try {
      const first = await rawRequest(limited.port, "/acquisition/browser", {
        headers: { [EXTENSION_HEADER]: extensionToken },
        body: CAPTURE_BODY,
      });
      expect(first.status).toBe(201);
      const second = await rawRequest(limited.port, "/acquisition/browser", {
        headers: { [EXTENSION_HEADER]: extensionToken },
        body: CAPTURE_BODY,
      });
      expect(second.status).toBe(429);
    } finally {
      await limited.close();
    }

    const reset = await startMockServer({
      role: "extension",
      desktopToken,
      extensionToken,
      captureRateLimit: { capacity: 1, refillPerSecond: 0 },
    });
    try {
      const afterReset = await rawRequest(reset.port, "/acquisition/browser", {
        headers: { [EXTENSION_HEADER]: extensionToken },
        body: CAPTURE_BODY,
      });
      expect(afterReset.status).toBe(201);
    } finally {
      await reset.close();
    }
  });
});

describe("static bootstrap", () => {
  it("injects the session meta tag only into the desktop HTML shell and sets CSP/no-store", async () => {
    const root = mkdtempSync(join(tmpdir(), "job-nearby-ui-"));
    temporaryRoots.push(root);
    mkdirSync(join(root, "assets"));
    writeFileSync(join(root, "index.html"), "<!doctype html><html><head><title>Job Nearby</title></head><body><div id=\"root\"></div></body></html>");
    writeFileSync(join(root, "assets", "app.js"), "console.log('app');");
    const desktopToken = generateSessionToken();
    const extensionToken = generateSessionToken();
    const server = await startMockServer({ role: "desktop", desktopToken, extensionToken, staticUiDirectory: root });
    try {
      const html = await rawRequest(server.port, "/", { method: "GET", headers: { Accept: "text/html" } });
      expect(html.status).toBe(200);
      expect(html.body).toContain(`<meta name="job-nearby-session" content="${desktopToken}">`);
      expect(html.headers["cache-control"]).toBe("no-store");
      expect(html.headers["content-security-policy"]).toContain("default-src 'self'");
      expect(html.headers["referrer-policy"]).toBe("no-referrer");

      const asset = await rawRequest(server.port, "/assets/app.js", { method: "GET" });
      expect(asset.status).toBe(200);
      expect(asset.body).not.toContain(desktopToken);

      const foreign = await rawRequest(server.port, "/", {
        method: "GET",
        headers: { Accept: "text/html", Origin: "http://evil.example" },
      });
      expect(foreign.status).toBe(403);
      expect(foreign.body).not.toContain(desktopToken);
    } finally {
      await server.close();
    }
  });
});
