import type { AddressInfo } from "node:net";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createTestCaptureServer as createBrowserCaptureServer } from "../support/httpAuthorization.js";

const servers: ReturnType<typeof createBrowserCaptureServer>[] = [];
const staticRoots: string[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
  for (const root of staticRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

async function startServer(captureOnly = false) {
  const captureAndProcessBrowserVacancy = vi.fn();
  const server = createBrowserCaptureServer({
    captureAndProcessBrowserVacancy,
  }, { captureOnly });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    captureAndProcessBrowserVacancy,
    url: `http://127.0.0.1:${port}/acquisition/browser`,
  };
}

describe("local browser capture HTTP boundary", () => {
  it("limits the stable extension listener to the capture endpoint", async () => {
    const server = createBrowserCaptureServer(
      { captureAndProcessBrowserVacancy: vi.fn() },
      { captureOnly: true },
    );
    servers.push(server);
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;
    const response = await fetch(`http://127.0.0.1:${port}/contacts`);
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ success: false });
  });

  it("serves built UI routes and assets without treating API paths as SPA fallbacks", async () => {
    const root = mkdtempSync(join(tmpdir(), "job-nearby-ui-"));
    staticRoots.push(root);
    mkdirSync(join(root, "assets"));
    writeFileSync(join(root, "index.html"), "<main>built ui</main>");
    writeFileSync(join(root, "assets", "app.js"), "console.log('built');");
    const server = createBrowserCaptureServer({ captureAndProcessBrowserVacancy: vi.fn() }, { staticUiDirectory: root });
    servers.push(server);
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;
    const base = `http://127.0.0.1:${port}`;

    for (const route of ["/", "/today", "/contacts", "/documents", "/backup", "/export", "/review/vacancy-1"]) {
      const page = await fetch(`${base}${route}`, { headers: { Accept: "text/html" } });
      expect(page.status).toBe(200);
      expect(await page.text()).toContain("built ui");
    }
    const asset = await fetch(`${base}/assets/app.js`);
    expect(asset.headers.get("content-type")).toContain("text/javascript");
    expect(await asset.text()).toContain("console.log");
    const api = await fetch(`${base}/contacts`);
    expect(api.status).toBe(404);
    expect(api.headers.get("content-type")).toContain("application/json");
    const unknown = await fetch(`${base}/not-an-app-route`, { headers: { Accept: "text/html" } });
    expect(unknown.status).toBe(404);
    expect(unknown.headers.get("content-type")).toContain("application/json");
  });

  it("accepts a browser extension request and confirms persisted observation identity", async () => {
    const { captureAndProcessBrowserVacancy, url } = await startServer(true);
    captureAndProcessBrowserVacancy.mockResolvedValue({
      capture: {
        observationId: "http-observation",
        acquisitionId: "http-acquisition",
        observedAt: new Date("2026-08-28T11:00:00.000Z"),
      },
      processing: {
        status: "PROCESSED",
        captureAcceptedAsVacancy: true,
        canonicalVacancyId: "canonical-1",
        vacancyOutcome: "CREATED",
        observationAdded: true,
        canonicalizationStatus: "USABLE",
        employerStatus: "UNRESOLVED_RECORD_CREATED",
      },
    });
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "chrome-extension://fixture-extension-id",
      },
      body: JSON.stringify({
        pageUrl: "https://example.test/jobs/1",
        pageTitle: "Example vacancy",
        visibleText: "Visible vacancy text",
        capturedAt: "2026-08-28T11:00:00Z",
      }),
    });
    expect(response.status).toBe(201);
    expect(response.headers.get("access-control-allow-origin")).toBe(
      "chrome-extension://fixture-extension-id",
    );
    expect(await response.json()).toEqual({
      success: true,
      capture: {
        observationId: "http-observation",
        acquisitionId: "http-acquisition",
        observedAt: "2026-08-28T11:00:00.000Z",
      },
      processing: {
        status: "PROCESSED",
        captureAcceptedAsVacancy: true,
        canonicalVacancyId: "canonical-1",
        vacancyOutcome: "CREATED",
        observationAdded: true,
        canonicalizationStatus: "USABLE",
        employerStatus: "UNRESOLVED_RECORD_CREATED",
      },
    });
    expect(captureAndProcessBrowserVacancy).toHaveBeenCalledOnce();
  });

  it("returns a safe 201 response when processing fails after capture", async () => {
    const { captureAndProcessBrowserVacancy, url } = await startServer();
    captureAndProcessBrowserVacancy.mockResolvedValue({
      capture: {
        observationId: "persisted-observation",
        acquisitionId: "http-acquisition",
        observedAt: new Date("2026-08-28T11:00:00.000Z"),
      },
      processing: { status: "FAILED" },
    });
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        pageUrl: "https://example.test/jobs/1",
        pageTitle: "Example vacancy",
        visibleText: "Visible vacancy text",
        capturedAt: "2026-08-28T11:00:00Z",
      }),
    });
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({
      success: true,
      capture: {
        observationId: "persisted-observation",
        acquisitionId: "http-acquisition",
        observedAt: "2026-08-28T11:00:00.000Z",
      },
      processing: { status: "FAILED", code: "PROCESSING_FAILED" },
    });
  });

  it("rejects invalid payloads without persisting", async () => {
    const { captureAndProcessBrowserVacancy, url } = await startServer();
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        pageUrl: 42,
        pageTitle: "",
        visibleText: " ",
        capturedAt: "invalid",
      }),
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ success: false });
    expect(captureAndProcessBrowserVacancy).not.toHaveBeenCalled();
  });

  it("posts a validated employer confirmation action", async () => {
    const confirmVacancyEmployer = vi.fn().mockResolvedValue({ vacancy: { canonicalVacancyId: "canonical-1" } });
    const server = createBrowserCaptureServer({
      captureAndProcessBrowserVacancy: vi.fn(),
      confirmVacancyEmployer,
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;
    const response = await fetch(`http://127.0.0.1:${port}/vacancies/canonical-1/employer-confirmation`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ candidateName: "Air Products S.A.S (FR)" }),
    });
    expect(response.status).toBe(201);
    expect(confirmVacancyEmployer).toHaveBeenCalledWith({ canonicalVacancyId: "canonical-1", candidateName: "Air Products S.A.S (FR)" });
  });
});
