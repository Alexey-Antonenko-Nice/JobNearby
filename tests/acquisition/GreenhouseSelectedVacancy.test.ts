import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { BrowserCaptureAcquisitionAdapter } from "../../src/application/acquisition/BrowserCaptureAcquisitionAdapter.js";
import { DeterministicAcquisitionCaptureMapper } from "../../src/application/acquisition/DeterministicAcquisitionCaptureMapper.js";
import { GreenhouseSelectedVacancyContextLocator, greenhouseFacts, greenhouseVacancyId } from "../../src/application/acquisition/GreenhouseVacancy.js";
import { createVacancyEvidenceExtractor } from "../../src/application/evidence/createVacancyEvidenceExtractor.js";
import { createDatabase } from "../../src/infrastructure/database/createDatabase.js";
import { createCaptureProcessingRuntime } from "../../src/infrastructure/runtime/createCaptureProcessingRuntime.js";
import { SqliteCanonicalVacancyRepository } from "../../src/infrastructure/persistence/SqliteCanonicalVacancyRepository.js";
const html = readFileSync("tests/fixtures/greenhouseSelectedVacancy.html", "utf8");
const url = "https://job-boards.eu.greenhouse.io/agilerobotsse/jobs/4964827101";
const payload = { pageUrl: url, pageTitle: "Job Application", html, visibleText: "Unrelated Paris CDI 999999 EUR / YEAR", capturedAt: "2026-10-27T12:00:00Z" };
const locate = (page = html) => new GreenhouseSelectedVacancyContextLocator().locate({ providerKey: "GREENHOUSE", sourceUrl: url, html: page });
function capture(page = html) {
  const acquisition = new BrowserCaptureAcquisitionAdapter().toAcquisitionPackage({ ...payload, html: page }, "acquisition");
  return { acquisition, observation: new DeterministicAcquisitionCaptureMapper().toSourceObservation(acquisition, "observation") };
}
describe("Greenhouse saved selected vacancy", () => {
  it("extracts route ID, title, location and complete bounded description", async () => {
    const { acquisition, observation } = capture();
    expect(observation.source.externalId).toBe("4964827101");
    expect(observation.title).toBe("Manufacturing Engineer (m/f/d)");
    expect(observation.locationText).toBe("Fürstenfeldbruck, Bavaria, Germany");
    const context = acquisition.contexts![0]!;
    expect(context.html).toContain(greenhouseFacts(html)!.descriptionHtml);
    expect(context.text).toContain("Prozessoptimierung");
    expect(context.text).toContain("Find out more at:");
    expect(context.text).not.toMatch(/Apply for this job|salary expectation|English level proficiency|Afghanistan|Back to jobs|999999/);
    const result = await createVacancyEvidenceExtractor().extract(observation);
    expect(result.vacancyTitles.map(t => t.value)).toEqual(["Manufacturing Engineer (m/f/d)"]);
    expect(result.locations.map(l => l.value)).toEqual(["Fürstenfeldbruck, Bavaria, Germany"]);
    expect(result.compensations).toEqual([]);
    expect(result.workModes).toEqual([]);
  });
  it.each(["missing", "duplicate", "hidden", "canonical", "application", "tenant", "og"])("fails closed on %s boundary or identity disagreement", async variant => {
    const facts = greenhouseFacts(html)!;
    const page = variant === "missing" ? html.replace(facts.descriptionHtml, "")
      : variant === "duplicate" ? html.replace(facts.titleRegion, facts.titleRegion + facts.titleRegion)
      : variant === "hidden" ? html.replace(facts.descriptionHtml, facts.descriptionHtml.replace('<div ', '<div hidden '))
      : variant === "canonical" ? html.replace('http://job-boards.eu.greenhouse.io/agilerobotsse/jobs/4964827101', 'http://job-boards.eu.greenhouse.io/agilerobotsse/jobs/99999')
      : variant === "application" ? html.replace('action="/agilerobotsse/jobs/4964827101"', 'action="/agilerobotsse/jobs/99999"')
      : variant === "tenant" ? html.replace('action="/agilerobotsse/jobs/4964827101"', 'action="/another/jobs/4964827101"')
      : html.replace('content="https://job-boards.eu.greenhouse.io/agilerobotsse/jobs/4964827101"', 'content="https://job-boards.eu.greenhouse.io/agilerobotsse/jobs/99999"');
    expect(locate(page)).toBeUndefined();
    const result = await createVacancyEvidenceExtractor().extract({ ...capture(page).observation, title: "Stale", locationText: "Paris", salaryText: "999999 EUR / YEAR" });
    expect(result.vacancyTitles).toEqual([]); expect(result.locations).toEqual([]); expect(result.compensations).toEqual([]);
  });
  it("ignores application and outside-page noise", () => {
    const page = html.replace('What is your salary expectation?', 'Paris 999999 EUR / YEAR Other job') + '<footer><h1>Another job</h1>Berlin CDI</footer>';
    expect(locate(page)?.text).toBe(locate()?.text);
  });
  it("rejects hidden selected containers and locations", () => {
    expect(locate(html.replace('class="job-post-container"', 'hidden class="job-post-container"'))).toBeUndefined();
    expect(locate(html.replace('class="job__location"', 'aria-hidden="true" class="job__location"'))).toBeUndefined();
  });
  it("limits ID extraction to the supported host and exact route", () => {
    expect(greenhouseVacancyId(url + '?gh_src=tracking#application')).toBe("4964827101");
    for (const bad of [url.replace('job-boards.eu.greenhouse.io', 'other.io'), url + '/apply', url.replace('/jobs/', '/other/'), url.replace('/4964827101', '/abc')]) expect(greenhouseVacancyId(bad)).toBeUndefined();
    expect(new GreenhouseSelectedVacancyContextLocator().locate({ providerKey: "GREENHOUSE", sourceUrl: url, html, externalId: "99999" })).toBeUndefined();
  });
  it("replays and recaptures entirely in memory", async () => {
    const db = createDatabase(":memory:");
    try {
      const runtime = createCaptureProcessingRuntime(db);
      const first = await runtime.captureAndProcessBrowserVacancy(payload);
      if (first.processing.status !== "PROCESSED") throw Error("Capture failed");
      const canonical = (await new SqliteCanonicalVacancyRepository(db).findById(first.processing.canonicalVacancyId))!;
      expect(canonical.role.value?.title).toBe("Manufacturing Engineer (m/f/d)");
      expect(canonical.location.value?.rawText).toBe("Fürstenfeldbruck, Bavaria, Germany");
      const second = await runtime.captureAndProcessBrowserVacancy({ ...payload, capturedAt: "2026-10-27T12:01:00Z" });
      expect(second.capture.observationId).toBe(first.capture.observationId);
      expect(second.processing).toMatchObject({ canonicalVacancyId: first.processing.canonicalVacancyId, observationAdded: false });
    } finally { db.close(); }
  });
});
