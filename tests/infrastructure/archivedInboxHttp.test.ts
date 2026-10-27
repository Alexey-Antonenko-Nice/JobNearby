import type { AddressInfo } from "node:net";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDatabase } from "../../src/infrastructure/database/createDatabase.js";
import { createBrowserCaptureServer } from "../../src/infrastructure/http/createBrowserCaptureServer.js";
import { createCaptureProcessingRuntime } from "../../src/infrastructure/runtime/createCaptureProcessingRuntime.js";
import { createVacancyReviewWorkflow } from "../../src/application/user/createVacancyReviewWorkflow.js";
import { SqliteCanonicalVacancyRepository } from "../../src/infrastructure/persistence/SqliteCanonicalVacancyRepository.js";
import { SqliteSourceObservationRepository } from "../../src/infrastructure/persistence/SqliteSourceObservationRepository.js";
import { SqliteUserVacancyInteractionRepository } from "../../src/infrastructure/persistence/SqliteUserVacancyInteractionRepository.js";
import { SqliteEmployerClusterRepository } from "../../src/infrastructure/persistence/SqliteEmployerClusterRepository.js";
import { SqliteEmployerMemoryPublicDataSource } from "../../src/infrastructure/persistence/SqliteEmployerMemoryPublicDataSource.js";
import { SqliteVacancyCleanup } from "../../src/infrastructure/persistence/SqliteVacancyCleanup.js";

const html = readFileSync("tests/fixtures/greenhouseSelectedVacancy.html", "utf8");
let db: ReturnType<typeof createDatabase>;
let server: ReturnType<typeof createBrowserCaptureServer>;
let base: string;
let id: string;
beforeEach(async () => {
  db = createDatabase(":memory:");
  const runtime = createCaptureProcessingRuntime(db);
  const result = await runtime.captureAndProcessBrowserVacancy({ pageUrl: "https://job-boards.eu.greenhouse.io/agilerobotsse/jobs/4964827101", pageTitle: "Selected job", html, visibleText: "Selected job", capturedAt: "2026-10-27T12:00:00Z" });
  if (result.processing.status !== "PROCESSED") throw Error("Fixture capture failed");
  id = result.processing.canonicalVacancyId;
  const workflow = createVacancyReviewWorkflow({
    canonicalVacancyRepository: new SqliteCanonicalVacancyRepository(db),
    sourceObservationRepository: new SqliteSourceObservationRepository(db),
    interactionRepository: new SqliteUserVacancyInteractionRepository(db),
    employerClusterRepository: new SqliteEmployerClusterRepository(db),
    employerMemoryPublicDataSource: new SqliteEmployerMemoryPublicDataSource(db),
  });
  server = createBrowserCaptureServer({ ...workflow, vacancyCleanup: new SqliteVacancyCleanup(db), captureAndProcessBrowserVacancy: runtime.captureAndProcessBrowserVacancy });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/vacancies`;
});
afterEach(async () => {
  server?.closeAllConnections();
  if (server) await new Promise<void>(resolve => server.close(() => resolve()));
  db?.close();
});
async function list(query = "") {
  const response = await fetch(base + query);
  const body = await response.json() as { vacancies: { canonicalVacancyId: string; title: string }[] };
  expect(response.status, JSON.stringify(body)).toBe(200);
  return body.vacancies;
}
async function archive(archived: boolean) {
  const state = await (await fetch(`${base}/${id}/cleanup`)).json() as { cleanup: { token: string } };
  const response = await fetch(`${base}/${id}/archive`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ archived, token: state.cleanup.token }) });
  expect(response.status).toBe(200);
}
describe("archived inbox HTTP contract with an in-memory database", () => {
  it("loads archived records and excludes them from default and explicit active lists", async () => {
    await archive(true);
    const archived = await list("?archived=true");
    expect(archived).toHaveLength(1);
    expect(archived[0]).toMatchObject({ canonicalVacancyId: id, title: "Manufacturing Engineer (m/f/d)" });
    expect(await list()).toEqual([]);
    expect(await list("?archived=false")).toEqual([]);
    expect(await list("?limit=1&archived=true")).toEqual(archived);
  });
  it("returns an empty archive successfully when only active vacancies exist", async () => {
    expect(await list("?archived=true")).toEqual([]);
    expect((await list()).map(v => v.canonicalVacancyId)).toEqual([id]);
  });
  it("restores into the active list, empties the archive and keeps deletion guarded", async () => {
    await archive(true);
    expect((await list("?archived=true")).map(v => v.canonicalVacancyId)).toEqual([id]);
    await archive(false);
    expect(await list("?archived=true")).toEqual([]);
    expect((await list()).map(v => v.canonicalVacancyId)).toEqual([id]);
    expect((await fetch(`${base}/${id}/deletion-preview`)).status).toBe(409);
  });
  it.each(["?archived=yes", "?archived=", "?unrecognized=true", "?archived=true&limit=invalid"])("still rejects invalid query %s", async query => {
    expect((await fetch(base + query)).status).toBe(400);
  });
});
