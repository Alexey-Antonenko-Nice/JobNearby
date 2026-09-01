import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createBrowserCaptureServer } from "../../src/infrastructure/http/createBrowserCaptureServer.js";

const servers: ReturnType<typeof createBrowserCaptureServer>[] = [];
afterEach(async () => Promise.all(servers.splice(0).map((server) =>
  new Promise<void>((resolve) => server.close(() => resolve())))));

describe("vacancy review HTTP workflow", () => {
  it("GET returns 404 for an unknown canonical vacancy", async () => {
    const fixture = await start({ getError: new Error('CanonicalVacancy "missing" does not exist.') });
    const response = await fetch(`${fixture.base}/vacancies/missing/review`);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ success: false, error: 'CanonicalVacancy "missing" does not exist.' });
  });

  it("GET returns an existing NEW review without recording an interaction", async () => {
    const fixture = await start();
    const response = await fetch(`${fixture.base}/vacancies/canonical-1/review`);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ review: { user: { currentState: "NEW" } } });
    expect(fixture.getVacancyReview).toHaveBeenCalledWith("canonical-1");
    expect(fixture.recordVacancyReviewAction).not.toHaveBeenCalled();
  });

  it.each(["REVIEWED", "APPLIED"] as const)("POST %s returns the event and refreshed review", async (type) => {
    const fixture = await start({ actionType: type });
    const response = await fetch(`${fixture.base}/vacancies/canonical-1/interactions`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type }),
    });
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ event: { type }, review: { user: { currentState: type } } });
    expect(fixture.recordVacancyReviewAction).toHaveBeenCalledWith({ canonicalVacancyId: "canonical-1", type });
  });

  it.each([
    [{ type: "NEW" }, /NEW is derived/u],
    [{ type: "INVALID" }, /type is invalid/u],
    [{ type: "APPLIED", occurredAt: "not-a-date" }, /occurredAt must be a valid date/u],
    [{ type: "APPLIED", extra: true }, /unsupported field/u],
    [[], /payload must be an object/u],
  ] as const)("rejects invalid POST payload %j", async (body, error) => {
    const fixture = await start();
    const response = await fetch(`${fixture.base}/vacancies/canonical-1/interactions`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    expect(response.status).toBe(400);
    expect((await response.json() as { error: string }).error).toMatch(error);
    expect(fixture.recordVacancyReviewAction).not.toHaveBeenCalled();
  });

  it("maps M6.1 metadata validation to 400 without exposing a stack", async () => {
    const fixture = await start({ actionError: new Error('Metadata field "channel" has an invalid value for APPLIED.') });
    const response = await fetch(`${fixture.base}/vacancies/canonical-1/interactions`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "APPLIED", metadata: { channel: "INVALID" } }),
    });
    expect(response.status).toBe(400);
    const body = await response.json() as Record<string, unknown>;
    expect(body.error).toMatch(/invalid value/u);
    expect(body).not.toHaveProperty("stack");
  });

  it("returns 404 when POST targets an unknown canonical vacancy", async () => {
    const fixture = await start({ actionError: new Error('CanonicalVacancy "missing" does not exist.') });
    const response = await fetch(`${fixture.base}/vacancies/missing/interactions`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "REVIEWED" }),
    });
    expect(response.status).toBe(404);
  });

  it("uses 500 for unexpected review failures without exposing a stack", async () => {
    const fixture = await start({ getError: new Error("database unavailable") });
    const response = await fetch(`${fixture.base}/vacancies/canonical-1/review`);
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ success: false, error: "database unavailable" });
  });
});

async function start(options: {
  getError?: Error;
  actionError?: Error;
  actionType?: string;
} = {}) {
  const review = { user: { currentState: "NEW" }, reviewSignals: { isNewVacancy: true } };
  const getVacancyReview = options.getError === undefined
    ? vi.fn().mockResolvedValue(review)
    : vi.fn().mockRejectedValue(options.getError);
  const type = options.actionType ?? "REVIEWED";
  const recordVacancyReviewAction = options.actionError === undefined
    ? vi.fn().mockResolvedValue({ event: { id: "event-1", type }, review: {
      ...review, user: { currentState: type }, reviewSignals: { isNewVacancy: false },
    } })
    : vi.fn().mockRejectedValue(options.actionError);
  const server = createBrowserCaptureServer({
    captureAndProcessBrowserVacancy: vi.fn(), getVacancyReview, recordVacancyReviewAction,
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return { base: `http://127.0.0.1:${port}`, getVacancyReview, recordVacancyReviewAction };
}
