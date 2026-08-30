import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createBrowserCaptureServer } from "../../src/infrastructure/http/createBrowserCaptureServer.js";

const servers: ReturnType<typeof createBrowserCaptureServer>[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

async function startServer() {
  const captureAndProcessBrowserVacancy = vi.fn();
  const server = createBrowserCaptureServer({
    captureAndProcessBrowserVacancy,
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    captureAndProcessBrowserVacancy,
    url: `http://127.0.0.1:${port}/acquisition/browser`,
  };
}

describe("local browser capture HTTP boundary", () => {
  it("accepts a browser extension request and confirms persisted observation identity", async () => {
    const { captureAndProcessBrowserVacancy, url } = await startServer();
    captureAndProcessBrowserVacancy.mockResolvedValue({
      capture: {
        observationId: "http-observation",
        acquisitionId: "http-acquisition",
        observedAt: new Date("2026-08-28T11:00:00.000Z"),
      },
      processing: {
        status: "PROCESSED",
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
});
