import type { Server } from "node:http";

import {
  createBrowserCaptureServer,
  type BrowserCaptureServerDependencies,
} from "../../src/infrastructure/http/createBrowserCaptureServer.js";

/** Deterministic credentials for HTTP-level tests only. Production generates fresh ones. */
export const TEST_DESKTOP_TOKEN = "test-desktop-session-token-0123456789abcdef0123456789";
export const TEST_EXTENSION_TOKEN = "test-extension-session-token-0123456789abcdef0123456789";

const portTokens = new Map<number, string>();
let fetchInstalled = false;

export function registerTokenForPort(port: number, token: string): void {
  portTokens.set(port, token);
}

export function clearRegisteredPorts(): void {
  portTokens.clear();
}

export function createTestCaptureServer(
  dependencies: BrowserCaptureServerDependencies,
  options: { readonly staticUiDirectory?: string; readonly captureOnly?: boolean } = {},
): Server {
  const role = options.captureOnly === true ? "extension" : "desktop";
  const server = createBrowserCaptureServer(dependencies, {
    ...options,
    security: {
      role,
      desktopToken: TEST_DESKTOP_TOKEN,
      extensionToken: TEST_EXTENSION_TOKEN,
    },
  });
  server.on("listening", () => {
    const address = server.address();
    if (address !== null && typeof address !== "string") {
      registerTokenForPort(address.port, role === "extension" ? TEST_EXTENSION_TOKEN : TEST_DESKTOP_TOKEN);
    }
  });
  return server;
}

/**
 * Adds the correct test credential to loopback fetch calls whose server was started
 * with createTestCaptureServer (or explicitly registered). The production server
 * never relies on this; unauthorized tests use node:http directly.
 */
export function installAuthorizedFetch(): void {
  if (fetchInstalled || typeof globalThis.fetch !== "function") return;
  fetchInstalled = true;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: RequestInfo | URL, init: RequestInit = {}) => {
    let url: URL;
    try {
      url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, "http://127.0.0.1");
    } catch {
      return originalFetch(input, init);
    }
    if (url.hostname === "127.0.0.1" && url.port.length > 0) {
      const token = portTokens.get(Number(url.port));
      if (token !== undefined) {
        const headers = new Headers(init.headers);
        if (!headers.has("X-Job-Nearby-Session") && !headers.has("X-Job-Nearby-Extension")) {
          headers.set(token === TEST_EXTENSION_TOKEN ? "X-Job-Nearby-Extension" : "X-Job-Nearby-Session", token);
        }
        return originalFetch(input, { ...init, headers });
      }
    }
    return originalFetch(input, init);
  };
}
