import type { PublicationCampaignContext } from "../../ui/src/api.js";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { contextFixture, seedPaths } from "../publication-identity/publicationContextFixture.js";
import { createBrowserCaptureServer } from "../../src/infrastructure/http/createBrowserCaptureServer.js";
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); });
async function start() {
  const f = await contextFixture("sqlite"); await seedPaths(f);
  const server = createBrowserCaptureServer({ ...f.workflow, captureAndProcessBrowserVacancy: vi.fn() });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  cleanups.push(async () => { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); f.close(); });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { ...f, base };
}
describe("publication/campaign review HTTP integration", () => {
  it("serializes complete relationship provenance and performs no writes during GET", async () => {
    const f = await start();
    const changes = () => f.db!.prepare("SELECT total_changes() AS count").get();
    const before = changes();
    const response = await fetch(`${f.base}/vacancies/current/review`);
    expect(response.status).toBe(200);
    const body = await response.json() as { review: { vacancyContext: PublicationCampaignContext & { readonly appliedBefore: boolean } } };
    const context = body.review.vacancyContext;
    expect(context.publicationFamilies).toHaveLength(2);
    expect(context.publicationFamilies[0]).toMatchObject({ id: "f1", observationCount: 3, currentVacancyObservationCount: 2, firstSeenAt: "2026-09-01T00:00:00.000Z" });
    expect(context.publicationFamilies[0]!.membershipEvidence[0]).toMatchObject({ membershipId: "f1-a", sourceObservationId: "a", evaluatedAt: "2026-10-01T00:00:00.000Z", confidence: 0.87 });
    expect(context.recruitmentCampaigns[0]).toMatchObject({ id: "c1", employerClusterId: "campaign-employer", status: "ENDED", firstObservedAt: "2025-01-01T00:00:00.000Z" });
    expect(context.recruitmentCampaigns[0]!.relationshipPaths).toHaveLength(3);
    expect(context.appliedBefore).toBe(false);
    expect(changes()).toEqual(before);
    const repeat = await (await fetch(`${f.base}/vacancies/current/review`)).json();
    expect(repeat).toEqual(body); expect(changes()).toEqual(before);
  });
  it("refreshes the same context after a private action without identity writes", async () => {
    const f = await start();
    const identitySnapshot = () => ["publication_families", "publication_family_memberships", "recruitment_campaigns", "recruitment_campaign_memberships", "source_observations", "canonical_vacancies"].map((table) => f.db!.prepare(`SELECT * FROM ${table} ORDER BY id`).all());
    const before = identitySnapshot();
    const response = await fetch(`${f.base}/vacancies/current/interactions`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "APPLIED" }) });
    expect(response.status).toBe(201);
    const body = await response.json() as { review: { vacancyContext: PublicationCampaignContext & { readonly appliedBefore: boolean } } };
    expect(body.review.vacancyContext.appliedBefore).toBe(true);
    expect(body.review.vacancyContext.publicationFamilies).toHaveLength(2);
    expect(body.review.vacancyContext.recruitmentCampaigns).toHaveLength(2);
    expect(identitySnapshot()).toEqual(before);
  });
});
