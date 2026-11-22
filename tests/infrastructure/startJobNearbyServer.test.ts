import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { startJobNearbyServer, type JobNearbyServerRuntime } from "../../src/infrastructure/http/startJobNearbyServer.js";

const temporaryRoots: string[] = [];
const runtimes: JobNearbyServerRuntime[] = [];

afterEach(async () => {
  await Promise.all(runtimes.splice(0).map(runtime => runtime.close()));
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("programmatic server lifecycle", () => {
  it("starts on an available loopback port, initializes data, serves requests and closes idempotently", async () => {
    const root = mkdtempSync(join(tmpdir(), "job-nearby-runtime-"));
    temporaryRoots.push(root);
    const dataRoot = join(root, "profile");
    const runtime = await startJobNearbyServer({ applicationDataRoot: dataRoot, port: 0 });
    runtimes.push(runtime);

    expect(runtime.host).toBe("127.0.0.1");
    expect(runtime.port).toBeGreaterThan(0);
    expect(runtime.databasePath).toBe(join(dataRoot, "job-nearby.sqlite"));
    expect(existsSync(runtime.databasePath)).toBe(true);
    expect(existsSync(runtime.documentDataDir)).toBe(true);
    expect((await fetch(`${runtime.url}/contacts`)).status).toBe(200);

    await Promise.all([runtime.close(), runtime.close()]);
    await expect(fetch(`${runtime.url}/contacts`)).rejects.toThrow();
    const reopened = await startJobNearbyServer({ applicationDataRoot: dataRoot, port: 0 });
    runtimes.push(reopened);
    expect((await fetch(`${reopened.url}/contacts`)).status).toBe(200);
  });

  it("refuses to bind outside loopback", async () => {
    await expect(startJobNearbyServer({ host: "0.0.0.0", port: 0 })).rejects.toThrow(/loopback/);
  });

  it("fails startup when the stable extension capture port is occupied", async () => {
    const root = mkdtempSync(join(tmpdir(), "job-nearby-runtime-"));
    temporaryRoots.push(root);
    const occupied = createServer();
    await new Promise<void>(resolve => occupied.listen(0, "127.0.0.1", resolve));
    const { port } = occupied.address() as AddressInfo;
    try {
      await expect(startJobNearbyServer({
        applicationDataRoot: join(root, "profile"),
        port: 0,
        extensionCapturePort: port,
      })).rejects.toThrow(`loopback port ${port} is already in use`);
    } finally {
      await new Promise<void>((resolve, reject) => occupied.close(error => error ? reject(error) : resolve()));
    }
  });
});
