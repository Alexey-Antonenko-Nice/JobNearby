import { describe, expect, it } from "vitest";

import { BrowserCaptureAcquisitionAdapter } from "../../src/application/acquisition/BrowserCaptureAcquisitionAdapter.js";
import { DeterministicAcquisitionCaptureMapper } from "../../src/application/acquisition/DeterministicAcquisitionCaptureMapper.js";
import { HostnameAcquisitionProviderRecognizer } from "../../src/application/acquisition/HostnameAcquisitionProviderRecognizer.js";
import { IndeedSelectedVacancyContextLocator } from "../../src/application/acquisition/IndeedSelectedVacancyContextLocator.js";
import { createDatabase } from "../../src/infrastructure/database/createDatabase.js";
import { SqliteSourceObservationRepository } from "../../src/infrastructure/persistence/SqliteSourceObservationRepository.js";

const recognizer = new HostnameAcquisitionProviderRecognizer();
const locator = new IndeedSelectedVacancyContextLocator();
const adapter = new BrowserCaptureAcquisitionAdapter();
const mapper = new DeterministicAcquisitionCaptureMapper();

function indeedHtml(id: string, options: {
  readonly selectedId?: string;
  readonly jobKey?: string;
  readonly detailId?: string;
  readonly includeDetail?: boolean;
  readonly duplicateDetail?: boolean;
  readonly duplicateSelectedResult?: boolean;
} = {}): string {
  const selectedId = options.selectedId ?? id;
  const jobKey = options.jobKey ?? selectedId;
  const detailId = options.detailId ?? id;
  const selectedResult = `
    <div class="cardOutline result job_${selectedId} vjs-highlight">
      <h3><a id="sj_${selectedId}" data-jk="${jobKey}">Selected vacancy title</a></h3>
    </div>`;
  const detail = `
    <section id="job-full-details" class="jobsearch-ViewJobContainerWrapper is-twoPaneWidthNew">
      <div id="vjs-container">
        <h2>Selected vacancy title - job post</h2>
        <a href="https://fr.indeed.com/cmp/Example?from=mobviewjob&amp;fromjk=${detailId}">Example Company</a>
        <div id="jobDescriptionText"><p>Bounded selected vacancy description.</p></div>
      </div>
    </section>`;
  return `
    <main>
      <div class="results-list">
        <div class="cardOutline result job_other"><h3>Other vacancy</h3></div>
        ${selectedResult}
        ${options.duplicateSelectedResult === true ? selectedResult : ""}
      </div>
      ${options.includeDetail === false ? "" : detail}
      ${options.duplicateDetail === true ? detail : ""}
    </main>`;
}

function locate(id: string, html: string, sourceUrl = `https://fr.indeed.com/?vjk=${id}`) {
  return locator.locate({
    providerKey: "INDEED",
    sourceUrl,
    externalId: id,
    html,
  });
}

describe("Indeed acquisition provider recognition", () => {
  it.each([
    ["indeed.com", "https://indeed.com/?vjk=abc"],
    ["indeed.com", "https://fr.indeed.com/?vjk=abc"],
    ["indeed.com", "https://de.indeed.com/jobs?vjk=abc"],
  ])("recognizes normalized source %s at %s", (sourceName, sourceUrl) => {
    expect(recognizer.recognize({ sourceName, sourceUrl })).toBe("INDEED");
  });

  it.each([
    ["fake-indeed.com", "https://fake-indeed.com/?vjk=abc"],
    ["indeed.example.com", "https://indeed.example.com/?vjk=abc"],
    ["example.com", "https://fr.indeed.com/?vjk=abc"],
  ])("rejects unsafe or inconsistent recognition for %s", (sourceName, sourceUrl) => {
    expect(recognizer.recognize({ sourceName, sourceUrl })).toBeUndefined();
  });
});

describe("IndeedSelectedVacancyContextLocator", () => {
  it("associates the URL ID, selected card, and bounded detail independently", () => {
    const context = locate("73c6c191fddb1427", indeedHtml("73c6c191fddb1427"));
    expect(context).toMatchObject({
      kind: "SELECTED_VACANCY",
      associationMethod: "PROVIDER_LOCATOR",
      providerKey: "INDEED",
      providerExternalId: "73c6c191fddb1427",
      associationEvidence: [
        "URL_EXTERNAL_ID",
        "MATCHING_SELECTED_RESULT",
        "BOUNDED_JOB_DETAIL",
        "DETAIL_EXTERNAL_ID_MATCH",
      ],
    });
    expect(context?.text).toContain("Bounded selected vacancy description");
    expect(context?.text).not.toContain("Other vacancy");
    expect(context?.html).toMatch(/^\s*<section/u);
  });

  it("rejects absent or mismatched URL identity", () => {
    const html = indeedHtml("73c6c191fddb1427");
    expect(locate("73c6c191fddb1427", html, "https://fr.indeed.com/jobs"))
      .toBeUndefined();
    expect(locate("73c6c191fddb1427", html, "https://fr.indeed.com/?vjk=other"))
      .toBeUndefined();
  });

  it("rejects a missing, mismatched, or ambiguous selected result", () => {
    expect(locate("target", indeedHtml("target", { selectedId: "other" }))).toBeUndefined();
    expect(locate("target", indeedHtml("target", { jobKey: "other" }))).toBeUndefined();
    expect(locate("target", indeedHtml("target", { duplicateSelectedResult: true })))
      .toBeUndefined();
  });

  it("rejects a missing, mismatched, or ambiguous detail region", () => {
    expect(locate("target", indeedHtml("target", { includeDetail: false }))).toBeUndefined();
    expect(locate("target", indeedHtml("target", { detailId: "other" }))).toBeUndefined();
    expect(locate("target", indeedHtml("target", { duplicateDetail: true }))).toBeUndefined();
  });

  it("does not accept a generic region or title match as a detail boundary", () => {
    const html = indeedHtml("target", { includeDetail: false })
      + '<section role="region"><h2>Selected vacancy title</h2></section>';
    expect(locate("target", html)).toBeUndefined();
  });
});

describe("Indeed selected-context acquisition integration", () => {
  it("adds bounded context without replacing or projecting the full-page snapshot", () => {
    const acquisition = adapter.toAcquisitionPackage({
      pageUrl: "https://fr.indeed.com/?vjk=73c6c191fddb1427",
      pageTitle: "Selected vacancy | Indeed",
      visibleText: "FULL INDEED PAGE INCLUDING MANY VACANCIES",
      html: indeedHtml("73c6c191fddb1427"),
      capturedAt: "2026-08-28T22:09:22Z",
    }, "indeed-context-capture");
    const observation = mapper.toSourceObservation(acquisition, "indeed-context-observation");

    expect(acquisition.source.sourceName).toBe("indeed.com");
    expect(acquisition.externalId).toBe("73c6c191fddb1427");
    expect(acquisition.contexts).toHaveLength(1);
    expect(observation.rawContent).toBe("FULL INDEED PAGE INCLUDING MANY VACANCIES");
    expect(observation.metadata.acquisition).toMatchObject({ contexts: acquisition.contexts });
    expect(observation).not.toHaveProperty("title");
    expect(observation).not.toHaveProperty("displayedCompanyName");
  });

  it("round-trips the context through existing SQLite metadata persistence", async () => {
    const db = createDatabase(":memory:");
    const repository = new SqliteSourceObservationRepository(db);
    const acquisition = adapter.toAcquisitionPackage({
      pageUrl: "https://fr.indeed.com/?vjk=73c6c191fddb1427",
      pageTitle: "Indeed",
      visibleText: "Full page",
      html: indeedHtml("73c6c191fddb1427"),
      capturedAt: "2026-08-28T22:09:22Z",
    }, "indeed-round-trip");
    const observation = mapper.toSourceObservation(acquisition, "indeed-round-trip");
    await repository.save(observation);
    const restored = await repository.findById(observation.id);

    expect(restored?.metadata.acquisition).toMatchObject({
      contexts: [{
        kind: "SELECTED_VACANCY",
        associationMethod: "PROVIDER_LOCATOR",
        providerKey: "INDEED",
        providerExternalId: "73c6c191fddb1427",
        associationEvidence: [
          "URL_EXTERNAL_ID",
          "MATCHING_SELECTED_RESULT",
          "BOUNDED_JOB_DETAIL",
          "DETAIL_EXTERNAL_ID_MATCH",
        ],
        text: expect.stringContaining("Bounded selected vacancy description"),
        html: expect.stringContaining('id="job-full-details"'),
      }],
    });
    db.close();
  });

  it("keeps France Travail working and LinkedIn unsupported", () => {
    const franceTravail = adapter.toAcquisitionPackage({
      pageUrl: "https://candidat.francetravail.fr/offres/recherche/detail/213BBCX",
      pageTitle: "France Travail",
      visibleText: "Full page",
      html: '<li data-id-offre="213BBCX" class="active"></li><div id="PopinDetails" class="modal-details-offre in"><h1>Offre n° 213BBCX</h1></div>',
      capturedAt: "2026-08-29T05:21:25Z",
    }, "france-travail-regression");
    const linkedIn = adapter.toAcquisitionPackage({
      pageUrl: "https://www.linkedin.com/jobs/search-results/?currentJobId=4460344242",
      pageTitle: "LinkedIn",
      visibleText: "Full page",
      html: '<main id="workspace">Selected vacancy</main>',
      capturedAt: "2026-08-28T22:10:00Z",
    }, "linkedin-regression");

    expect(franceTravail.contexts).toHaveLength(1);
    expect(linkedIn.externalId).toBe("4460344242");
    expect(linkedIn.contexts).toBeUndefined();
  });

  it("succeeds without context when Indeed HTML is absent", () => {
    const acquisition = adapter.toAcquisitionPackage({
      pageUrl: "https://fr.indeed.com/?vjk=73c6c191fddb1427",
      pageTitle: "Indeed",
      visibleText: "Full visible page",
      capturedAt: "2026-08-28T22:09:22Z",
    }, "indeed-no-html");
    expect(acquisition.externalId).toBe("73c6c191fddb1427");
    expect(acquisition.contexts).toBeUndefined();
  });
});
