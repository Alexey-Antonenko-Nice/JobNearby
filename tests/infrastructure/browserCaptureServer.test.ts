import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";

import { DeterministicAcquisitionCaptureMapper } from "../../src/application/acquisition/DeterministicAcquisitionCaptureMapper.js";
import { createBrowserCaptureServer } from "../../src/infrastructure/http/createBrowserCaptureServer.js";
import { InMemorySourceObservationRepository } from "../../src/infrastructure/persistence/InMemorySourceObservationRepository.js";

const servers: ReturnType<typeof createBrowserCaptureServer>[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

async function startServer() {
  const repository = new InMemorySourceObservationRepository();
  const server = createBrowserCaptureServer({
    repository,
    acquisitionMapper: new DeterministicAcquisitionCaptureMapper(),
    generateAcquisitionId: () => "http-acquisition",
    generateObservationId: () => "http-observation",
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return { repository, url: `http://127.0.0.1:${port}/acquisition/browser` };
}

describe("local browser capture HTTP boundary", () => {
  it("accepts a browser extension request and confirms persisted observation identity", async () => {
    const { repository, url } = await startServer();
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
      sourceObservationId: "http-observation",
      acquisitionId: "http-acquisition",
      observedAt: "2026-08-28T11:00:00.000Z",
    });
    expect(await repository.findById("http-observation")).not.toBeNull();
  });

  it("rejects invalid payloads without persisting", async () => {
    const { repository, url } = await startServer();
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        pageUrl: "not a URL",
        pageTitle: "",
        visibleText: " ",
        capturedAt: "invalid",
      }),
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ success: false });
    expect(await repository.findById("http-observation")).toBeNull();
  });
});
