import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { BrowserCaptureAcquisitionAdapter } from "../../src/application/acquisition/BrowserCaptureAcquisitionAdapter.js";
import { DeterministicAcquisitionCaptureMapper } from "../../src/application/acquisition/DeterministicAcquisitionCaptureMapper.js";
import { IndeedSelectedVacancyEvidenceExtractor } from "../../src/application/evidence/IndeedSelectedVacancyEvidenceExtractor.js";
import { LinkedInSelectedVacancyEvidenceExtractor } from "../../src/application/evidence/LinkedInSelectedVacancyEvidenceExtractor.js";
import { createVacancyEvidenceExtractor } from "../../src/application/evidence/createVacancyEvidenceExtractor.js";
import { scopeProviderVacancyEvidence } from "../../src/application/evidence/scopeProviderVacancyEvidence.js";
import { evidenceExtractionInputFor } from "../../src/application/vacancies/processVacancyObservation.js";
import type { AcquisitionContext } from "../../src/domain/acquisition/AcquisitionContext.js";
import { fromSelectedVacancyContext } from "../../src/domain/evidence/VacancyEvidenceInput.js";
import { createDatabase } from "../../src/infrastructure/database/createDatabase.js";
import { createCaptureProcessingRuntime } from "../../src/infrastructure/runtime/createCaptureProcessingRuntime.js";
import { SqliteCanonicalVacancyRepository } from "../../src/infrastructure/persistence/SqliteCanonicalVacancyRepository.js";
import type { SourceObservation } from "../../src/domain/capture/SourceObservation.js";
import { normalizeVacancyEvidenceInput } from "../../src/domain/evidence/VacancyEvidenceInput.js";

const ID = "4449077982";
const DIRECT_URL = `https://www.linkedin.com/jobs/view/ingenieur-conception-mecanique-h-f-at-akkodis-${ID}/`;
const POISON = /POISON|Competing Title|Competing Co|Neighbor City|Similar Job/u;

interface Options {
  readonly headerId?: string;
  readonly detailId?: string;
  readonly competingDetailId?: string;
  readonly competingHeaderLink?: boolean;
}

function directViewHtml(options: Options = {}): string {
  const headerId = options.headerId ?? ID;
  const detailId = options.detailId ?? ID;
  return `<div data-sdui-screen="com.linkedin.sdui.flagshipnav.jobs.JobDetails">
    <main id="workspace">
      <div data-testid="lazy-column" data-component-type="LazyColumn">
        <div id="JobDetails_ManageJobBanner_${ID}" componentkey="JobDetails_ManageJobBanner_${ID}"></div>
        <div data-testid="job-header">
          <a href="/jobs/view/ingenieur-conception-mecanique-h-f-at-akkodis-${headerId}/">Akkodis</a>
          <h1>Ingénieur conception mécanique H/F</h1>
          <p>Pays de la Loire, France · il y a 3 semaines</p>
          <p>Hybride</p><p>CDD</p>
          ${options.competingHeaderLink === true ? '<a href="/jobs/view/4458098323/">Competing Title</a>' : ""}
        </div>
        <div data-testid="details-and-extras">
          <div id="JobDetails_AboutTheJob_${detailId}" componentkey="JobDetails_AboutTheJob_${detailId}">
            <h2>À propos de l’offre d’emploi</h2>
            <p>Akkodis France accompagne ce projet de conception.</p>
          </div>
          ${options.competingDetailId === undefined ? "" : `<div id="JobDetails_AboutTheJob_${options.competingDetailId}" componentkey="JobDetails_AboutTheJob_${options.competingDetailId}">Other vacancy</div>`}
          <div id="JobDetailsSimilarJobsSlot_${ID}">Similar Job recommendations</div>
        </div>
      </div>
      <aside data-testid="neighbors">
        <a href="/jobs/view/4458098323/">Competing Title</a><p>Competing Co</p><p>Neighbor City, France</p>
      </aside>
    </main>
  </div>`;
}

function capture(html: string, pageUrl = DIRECT_URL) {
  const acquisition = new BrowserCaptureAcquisitionAdapter().toAcquisitionPackage({
    pageUrl, pageTitle: "LinkedIn vacancy", visibleText: "Full page POISON text", html,
    capturedAt: "2026-11-01T10:00:00Z",
  }, "acquisition");
  return new DeterministicAcquisitionCaptureMapper().toSourceObservation(acquisition, "observation");
}

function withoutStoredContext(observation: SourceObservation): SourceObservation {
  const { contexts: _contexts, ...acquisition } = observation.metadata.acquisition as Record<string, unknown>;
  return { ...observation, metadata: { ...observation.metadata, acquisition } };
}

function poisoned(observation: SourceObservation): SourceObservation {
  const acquisition = observation.metadata.acquisition as Record<string, unknown>;
  return {
    ...observation,
    title: "POISON title",
    displayedCompanyName: "POISON company",
    locationText: "POISON location",
    contactText: "POISON contact",
    description: "POISON description",
    metadata: {
      ...observation.metadata,
      acquisition: {
        ...acquisition,
        structuredPayload: { jobPostings: [{ "@type": "JobPosting", title: "POISON posting", hiringOrganization: { name: "POISON org" } }] },
      },
    },
  };
}

function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const item of Object.values(value)) deepFreeze(item);
  }
  return value;
}

const extract = (observation: SourceObservation) =>
  createVacancyEvidenceExtractor().extract(evidenceExtractionInputFor(observation));

describe("LinkedIn direct-view evidence routing", () => {
  it("scopes a fresh SOURCE_OBSERVATION through the locator when no context is stored", () => {
    const input = withoutStoredContext(capture(directViewHtml()));
    expect(input.metadata.acquisition).not.toHaveProperty("contexts");
    expect("evidenceContent" in input).toBe(false);

    const scoped = normalizeVacancyEvidenceInput(scopeProviderVacancyEvidence(input));
    expect(scoped.evidenceContent.kind).toBe("SELECTED_VACANCY_CONTEXT");
    if (scoped.evidenceContent.kind !== "SELECTED_VACANCY_CONTEXT") throw new Error("not scoped");
    expect(scoped.evidenceContent.context).toMatchObject({
      providerKey: "LINKEDIN",
      providerExternalId: ID,
      associationEvidence: expect.arrayContaining(["LINKEDIN_DIRECT_JOB_DETAILS_SCREEN"]),
    });
    expect(scoped.rawContent).toBe(scoped.evidenceContent.context.text);
  });

  it("scopes a fresh SOURCE_OBSERVATION from the stored acquisition context", () => {
    const input = capture(directViewHtml());
    expect("evidenceContent" in input).toBe(false);
    const scoped = normalizeVacancyEvidenceInput(scopeProviderVacancyEvidence(input));
    expect(scoped.evidenceContent.kind).toBe("SELECTED_VACANCY_CONTEXT");
    expect(scoped.metadata.acquisition).toMatchObject({ metadata: { vacancyEvidenceScope: "SELECTED_VACANCY_REQUIRED" } });
  });

  it("scopes the production path, where the stored context is already attached", () => {
    const scoped = normalizeVacancyEvidenceInput(evidenceExtractionInputFor(capture(directViewHtml())));
    expect(scoped.evidenceContent.kind).toBe("SELECTED_VACANCY_CONTEXT");
    expect(scoped.rawContent).not.toMatch(POISON);
    expect((scoped.metadata.acquisition as { html: string }).html).not.toMatch(/Competing|Similar Job/u);
  });

  it("activates the LinkedIn extractor only on the scoped input", async () => {
    const raw = withoutStoredContext(capture(directViewHtml()));
    const linkedIn = new LinkedInSelectedVacancyEvidenceExtractor();
    const before = await linkedIn.extract(raw);
    expect(before.vacancyTitles).toEqual([]);
    expect(before.organizations).toEqual([]);

    const after = await linkedIn.extract(scopeProviderVacancyEvidence(raw));
    expect(after.vacancyTitles).toEqual([
      expect.objectContaining({ value: "Ingénieur conception mécanique H/F", provenance: expect.objectContaining({ contentOrigin: "SELECTED_VACANCY_CONTEXT" }) }),
    ]);
    expect(after.organizations).toEqual([expect.objectContaining({ value: "Akkodis", role: "DISPLAYED_COMPANY" })]);
  });

  it("never lets the Indeed extractor process LinkedIn input", async () => {
    const scoped = scopeProviderVacancyEvidence(withoutStoredContext(capture(directViewHtml())));
    const evidence = await new IndeedSelectedVacancyEvidenceExtractor().extract(scoped);
    expect(evidence.vacancyTitles).toEqual([]);
    expect(evidence.organizations).toEqual([]);
    expect(evidence.locations).toEqual([]);
  });
});

function paneHtml(id: string, withLink: boolean): string {
  return `<main id="workspace">
    <div class="results-list">
      <div role="button" componentkey="job-card-component-ref-9999999999">Other vacancy</div>
      <div role="button" componentkey="job-card-component-ref-${id}">Selected result</div>
    </div>
    <div class="detail-pane"><div class="selected-job-detail">
      <div class="job-header">${withLink ? `<a href="https://www.linkedin.com/jobs/view/${id}/?trackingId=abc">Selected vacancy title</a>` : ""}</div>
      <div class="job-sections">
        <div id="JobDetails_AboutTheJob_${id}"><h2>À propos de l’offre d’emploi</h2><p>Bounded LinkedIn vacancy description.</p></div>
        <div id="JobDetails_AboutTheCompany_${id}">Selected company details</div>
      </div>
    </div></div>
  </main>`;
}

describe("LinkedIn layout isolation", () => {
  const fixture = (name: string) => {
    const meta = JSON.parse(readFileSync(`tests/fixtures/${name}.meta.json`, "utf8")) as { pageUrl: string; pageTitle: string };
    const acquisition = new BrowserCaptureAcquisitionAdapter().toAcquisitionPackage({
      ...meta, html: readFileSync(`tests/fixtures/${name}.html`, "utf8"),
      visibleText: readFileSync(`tests/fixtures/${name}.visible.txt`, "utf8"), capturedAt: "2026-10-24T23:27:18.851Z",
    }, "acquisition");
    return new DeterministicAcquisitionCaptureMapper().toSourceObservation(acquisition, "observation");
  };

  it.each([
    ["search-results pane (carries the direct-view screen marker)", "linkedinSearchResultsWestinghouse"],
    ["B-Hive header", "linkedinBHiveSelectedPane"],
    ["B-Hive scrolled", "linkedinBHiveScrolledAbout"],
  ])("leaves %s unscoped", (_name, name) => {
    const observation = fixture(name);
    const proof = selectedContext(observation).associationEvidence!;
    if (name === "linkedinBHiveScrolledAbout") {
      expect(proof).toContain("MATCHING_LINKEDIN_COMPONENT_REFERENCE");
      expect(proof).not.toContain("MATCHING_LINKEDIN_JOB_LINK");
    } else {
      expect(proof).toContain("MATCHING_LINKEDIN_JOB_LINK");
      expect(proof).toContain("LINKEDIN_DIRECT_JOB_DETAILS_SCREEN");
    }
    expect(scopeProviderVacancyEvidence(observation)).toBe(observation);
    expect(scopeProviderVacancyEvidence(withoutStoredContext(observation))).toEqual(withoutStoredContext(observation));
    const production = evidenceExtractionInputFor(observation);
    expect(production).toEqual({ ...observation, evidenceContent: expect.objectContaining({ kind: "SELECTED_VACANCY_CONTEXT" }) });
    expect(production.rawContent).toBe(observation.rawContent);
  });

  it("scopes only the matching-link layout and leaves component-ref legacy", () => {
    const id = "4460344242";
    const evidence = [] as string[][];
    for (const withLink of [true, false]) {
      const observation = capture(paneHtml(id, withLink), `https://www.linkedin.com/jobs/search/?currentJobId=${id}`);
      const context = (observation.metadata.acquisition as { contexts: Array<{ associationEvidence: string[] }> }).contexts[0]!;
      evidence.push(context.associationEvidence);
      expect(context.associationEvidence).not.toContain("LINKEDIN_DIRECT_JOB_DETAILS_SCREEN");
      if (withLink) expect(scopeProviderVacancyEvidence(observation)).not.toBe(observation);
      else expect(scopeProviderVacancyEvidence(observation)).toBe(observation);
    }
    expect(evidence[0]).toContain("MATCHING_LINKEDIN_JOB_LINK");
    expect(evidence[1]).toContain("MATCHING_LINKEDIN_COMPONENT_REFERENCE");
  });

  it("does not treat a non-SDUI context on a /jobs/view/ URL as the direct view", () => {
    const id = "4460344242";
    const observation = capture(paneHtml(id, true), `https://www.linkedin.com/jobs/view/title-${id}/`);
    const context = (observation.metadata.acquisition as { contexts: Array<{ associationEvidence: string[] }> }).contexts[0]!;
    expect(context.associationEvidence).not.toContain("LINKEDIN_DIRECT_JOB_DETAILS_SCREEN");
    expect(scopeProviderVacancyEvidence(observation)).toBe(observation);
  });

  it("does not scope the direct-view DOM when it is captured from a search-results URL", () => {
    const observation = capture(directViewHtml(), `https://www.linkedin.com/jobs/search-results/?currentJobId=${ID}`);
    expect(scopeProviderVacancyEvidence(observation)).toBe(observation);
  });
});

describe("LinkedIn direct-view contamination", () => {
  it("excludes page-level title, company, location, contact, description and foreign structured payload", async () => {
    const dirty = poisoned(capture(directViewHtml()));
    const scoped = normalizeVacancyEvidenceInput(scopeProviderVacancyEvidence(dirty));
    expect(scoped.title).toBeUndefined();
    expect(scoped.displayedCompanyName).toBeUndefined();
    expect(scoped.locationText).toBeUndefined();
    expect(scoped.contactText).toBeUndefined();
    expect(scoped.description).toBeUndefined();
    const acquisition = scoped.metadata.acquisition as Record<string, unknown>;
    expect(acquisition).not.toHaveProperty("structuredPayload");
    expect(acquisition.contexts).toHaveLength(1);
    expect(JSON.stringify(scoped)).not.toMatch(POISON);

    const clean = await extract(capture(directViewHtml()));
    const evidence = await extract(dirty);
    expect(JSON.stringify(evidence)).not.toMatch(POISON);
    expect(evidence).toEqual(clean);
    expect([...new Set(evidence.vacancyTitles.map((item) => item.value))]).toEqual(["Ingénieur conception mécanique H/F"]);
  });

  it("excludes neighbouring and similar-job content outside the selected boundary", async () => {
    const observation = capture(directViewHtml());
    const scoped = normalizeVacancyEvidenceInput(scopeProviderVacancyEvidence(observation));
    if (scoped.evidenceContent.kind !== "SELECTED_VACANCY_CONTEXT") throw new Error("not scoped");
    expect(scoped.evidenceContent.context.text).not.toMatch(POISON);
    expect(scoped.evidenceContent.context.html).not.toMatch(POISON);
    expect(JSON.stringify(await extract(observation))).not.toMatch(POISON);
  });

  it.each([
    ["detail ID differs from URL and header", { detailId: "4458098323" }],
    ["header link ID differs from URL and detail", { headerId: "4458098323" }],
    ["a competing JobDetails ID is present", { competingDetailId: "4458098323" }],
    ["a competing job link sits in the header", { competingHeaderLink: true }],
  ] satisfies Array<[string, Options]>)("fails closed when %s", async (_name, options) => {
    const observation = capture(directViewHtml(options));
    expect(observation.metadata.acquisition).not.toHaveProperty("contexts");
    const scoped = normalizeVacancyEvidenceInput(scopeProviderVacancyEvidence(observation));
    expect(scoped.evidenceContent.kind).toBe("SOURCE_OBSERVATION");
    const evidence = await new LinkedInSelectedVacancyEvidenceExtractor().extract(scoped);
    expect(evidence.vacancyTitles).toEqual([]);
    expect(evidence.organizations).toEqual([]);
  });

  it("does not trust a stored context whose ID disagrees with the source ID", () => {
    const observation = capture(directViewHtml());
    const acquisition = observation.metadata.acquisition as { contexts: Array<Record<string, unknown>> };
    const tampered: SourceObservation = {
      ...observation,
      metadata: { ...observation.metadata, acquisition: { ...acquisition, contexts: [{ ...acquisition.contexts[0], providerExternalId: "4458098323" }] } },
    };
    expect(scopeProviderVacancyEvidence(tampered)).toBe(tampered);
  });

  it("does not mutate the input", () => {
    const input = deepFreeze(poisoned(capture(directViewHtml())));
    const snapshot = JSON.stringify(input);
    const scoped = scopeProviderVacancyEvidence(input);
    expect(scoped).not.toBe(input);
    expect(JSON.stringify(input)).toBe(snapshot);
    const withoutContext = deepFreeze(withoutStoredContext(capture(directViewHtml())));
    const before = JSON.stringify(withoutContext);
    expect(scopeProviderVacancyEvidence(withoutContext)).not.toBe(withoutContext);
    expect(JSON.stringify(withoutContext)).toBe(before);
  });
});

const SEARCH_ID = "4460344242";
const SEARCH_URL = "https://www.linkedin.com/jobs/search-results/?currentJobId=" + SEARCH_ID;
function matchingPaneHtml(): string {
  return paneHtml(SEARCH_ID, true)
    .replace('<div class="job-header">', '<div class="job-header"><p>Selected Engineering</p><p>')
    .replace("</a></div>", "</a></p><p>Strasbourg, France</p></div>")
    .replace("Other vacancy", "Competing Title Competing Co Neighbor City");
}
function searchObservation() { return capture(matchingPaneHtml(), SEARCH_URL); }
function selectedContext(input: SourceObservation): AcquisitionContext {
  return (input.metadata.acquisition as { contexts: AcquisitionContext[] }).contexts[0]!;
}
function withContext(input: SourceObservation, context: AcquisitionContext): SourceObservation {
  return { ...input, metadata: { ...input.metadata, acquisition: {
    ...(input.metadata.acquisition as Record<string, unknown>), contexts: [context],
  } } };
}

describe("LinkedIn matching-link search pane scoping", () => {
  it.each(["search", "search/", "search-results", "search-results/"])("accepts /jobs/%s with selected identity", (path) => {
    for (const host of ["linkedin.com", "www.linkedin.com", "fr.linkedin.com"]) {
      const observation = capture(matchingPaneHtml(), "https://" + host + "/jobs/" + path + "?currentJobId=" + SEARCH_ID);
      for (const input of [observation, withoutStoredContext(observation), fromSelectedVacancyContext(observation, selectedContext(observation))]) {
        const scoped = normalizeVacancyEvidenceInput(scopeProviderVacancyEvidence(input));
        expect(scoped.evidenceContent.kind).toBe("SELECTED_VACANCY_CONTEXT");
        expect(scoped.rawContent).toBe(selectedContext(observation).text);
        expect(scoped.metadata.acquisition).toMatchObject({ metadata: { vacancyEvidenceScope: "SELECTED_VACANCY_REQUIRED" } });
      }
    }
  });

  it("preserves locator context and extracts selected header facts without projections or page poison", async () => {
    const clean = searchObservation();
    const context = selectedContext(clean);
    expect(context.associationEvidence).toEqual([
      "URL_EXTERNAL_ID", "MATCHING_JOB_DETAILS", "BOUNDED_JOB_DETAIL", "MATCHING_LINKEDIN_JOB_LINK",
    ]);
    expect(context.text).toContain("Selected Engineering");
    expect(context.text).toContain("Selected vacancy title");
    expect(context.text).toContain("Strasbourg, France");
    const input = deepFreeze(poisoned(clean));
    const snapshot = JSON.stringify(input);
    const scoped = normalizeVacancyEvidenceInput(scopeProviderVacancyEvidence(input));
    expect(scoped.evidenceContent).toEqual({ kind: "SELECTED_VACANCY_CONTEXT", context });
    if (scoped.evidenceContent.kind !== "SELECTED_VACANCY_CONTEXT") throw new Error("not scoped");
    expect(scoped.evidenceContent.context).toBe(context);
    for (const field of ["title", "displayedCompanyName", "locationText", "description", "contactText"]) {
      expect(scoped).not.toHaveProperty(field);
    }
    expect(scoped.metadata.acquisition).not.toHaveProperty("structuredPayload");
    expect(JSON.stringify(scoped)).not.toMatch(POISON);
    expect(JSON.stringify(input)).toBe(snapshot);
    const raw = deepFreeze(withoutStoredContext(input));
    const before = JSON.stringify(raw);
    expect(scopeProviderVacancyEvidence(raw)).not.toBe(raw);
    expect(JSON.stringify(raw)).toBe(before);
    const extractor = new LinkedInSelectedVacancyEvidenceExtractor();
    expect((await extractor.extract(withoutStoredContext(clean))).vacancyTitles).toEqual([]);
    const evidence = await extractor.extract(scoped);
    expect(evidence.vacancyTitles).toEqual([expect.objectContaining({
      value: "Selected vacancy title", provenance: expect.objectContaining({ contentOrigin: "SELECTED_VACANCY_CONTEXT" }),
    })]);
    expect(evidence.organizations).toEqual([expect.objectContaining({ value: "Selected Engineering", role: "DISPLAYED_COMPANY" })]);
    expect(evidence.locations).toEqual([expect.objectContaining({ value: "Strasbourg, France" })]);
    expect(await extract(input)).toEqual(await extract(clean));
    expect(JSON.stringify(await extract(input))).not.toMatch(POISON);
    expect(scopeProviderVacancyEvidence(scoped)).toEqual(scoped);
  });

  it.each(["URL_EXTERNAL_ID", "MATCHING_JOB_DETAILS", "BOUNDED_JOB_DETAIL", "MATCHING_LINKEDIN_JOB_LINK"])(
    "keeps legacy passthrough when locator proof lacks %s", (marker) => {
      const input = searchObservation();
      const context = { ...selectedContext(input), associationEvidence: selectedContext(input).associationEvidence!.filter((value) => value !== marker) };
      const stored = withContext(input, context);
      expect(scopeProviderVacancyEvidence(stored)).toBe(stored);
      const attached = fromSelectedVacancyContext(input, context);
      expect(scopeProviderVacancyEvidence(attached)).toBe(attached);
    },
  );

  it.each([
    { providerExternalId: "9999999999" },
    { providerExternalId: undefined },
    { associationMethod: "USER_SELECTED" as const },
    { associationEvidence: ["MATCHING_LINKEDIN_JOB_LINK"] },
    { associationEvidence: undefined },
  ])("rejects insufficient context proof: %j", (change) => {
    const input = searchObservation();
    const stored = withContext(input, Object.fromEntries(Object.entries({ ...selectedContext(input), ...change }).filter(([, value]) => value !== undefined)) as unknown as AcquisitionContext);
    expect(scopeProviderVacancyEvidence(stored)).toBe(stored);
  });

  it("does not promote a foreign provider context", () => {
    const input = withoutStoredContext(searchObservation());
    const noHtml = { ...input, metadata: {} };
    const attached = fromSelectedVacancyContext(noHtml, { ...selectedContext(searchObservation()), providerKey: "INDEED" });
    expect(scopeProviderVacancyEvidence(attached)).toBe(attached);
  });

  it.each([
    undefined, "invalid", "https://www.linkedin.com/jobs/search/",
    "https://www.linkedin.com/jobs/search/?currentJobId=9999999999",
    "https://www.linkedin.com/jobs/collections/?currentJobId=4460344242",
    "https://www.linkedin.com/jobs/search/extra?currentJobId=4460344242",
    "https://fake-linkedin.com/jobs/search/?currentJobId=4460344242",
    "https://linkedin.com.example.com/jobs/search/?currentJobId=4460344242",
    "ftp://linkedin.com/jobs/search/?currentJobId=4460344242",
  ])("rejects missing, mismatching or unsupported URL %s", (sourceUrl) => {
    const input = searchObservation();
    const { sourceUrl: _sourceUrl, ...source } = input.source;
    const changed = { ...input, source: { ...source, ...(sourceUrl === undefined ? {} : { sourceUrl }) } };
    expect(scopeProviderVacancyEvidence(changed)).toBe(changed);
  });

  it.each([undefined, "9999999999"])("rejects source ID %s", (externalId) => {
    const input = searchObservation();
    const { externalId: _externalId, ...source } = input.source;
    const changed = { ...input, source: { ...source, ...(externalId === undefined ? {} : { externalId }) } };
    expect(scopeProviderVacancyEvidence(changed)).toBe(changed);
  });

  it.each([
    '<div><a href="/jobs/view/4460344242/">Separate matching link</a></div>',
    '<div id="JobDetails_AboutTheJob_9999999999">Other detail</div>',
  ])("fails closed on competing ownership: %s", async (extra) => {
    const input = capture(matchingPaneHtml().replace("</main>", extra + "</main>"), SEARCH_URL);
    expect(input.metadata.acquisition).not.toHaveProperty("contexts");
    expect(scopeProviderVacancyEvidence(input)).toBe(input);
    expect((await new LinkedInSelectedVacancyEvidenceExtractor().extract(input)).vacancyTitles).toEqual([]);
  });

  it("rejects a competing foreign link inside the selected header", () => {
    const html = matchingPaneHtml().replace("</a>", '</a><a href="/jobs/view/9999999999/">Competing Title</a>');
    const input = capture(html, SEARCH_URL);
    expect(input.metadata.acquisition).not.toHaveProperty("contexts");
    expect(scopeProviderVacancyEvidence(input)).toBe(input);
  });

  it("preserves locator acceptance of repeated same-ID links inside one boundary", () => {
    const html = matchingPaneHtml().replace("</a>", '</a><a href="/jobs/view/4460344242/">Selected vacancy title</a>');
    const input = capture(html, SEARCH_URL);
    expect(normalizeVacancyEvidenceInput(scopeProviderVacancyEvidence(input)).evidenceContent.kind).toBe("SELECTED_VACANCY_CONTEXT");
  });

  it("leaves unknown and Kickmaker legacy captures unchanged, without promotion from ID alone", () => {
    for (const html of ["<main>Unknown LinkedIn layout</main>", "<main></main>"]) {
      const input = withoutStoredContext(capture(html, SEARCH_URL));
      expect(scopeProviderVacancyEvidence(input)).toBe(input);
    }
    const input = { ...capture("<main></main>", SEARCH_URL), rawContent: readFileSync("tests/fixtures/linkedinKickmaker.txt", "utf8") };
    expect(scopeProviderVacancyEvidence(input)).toBe(input);
  });

  it("recaptures matching-link search into the same canonical without changing stored source or human state", async () => {
    const db = createDatabase(":memory:");
    try {
      const runtime = createCaptureProcessingRuntime(db);
      const payload = { pageUrl: SEARCH_URL, pageTitle: "LinkedIn vacancy", html: matchingPaneHtml(),
        visibleText: "Full page POISON text", capturedAt: "2026-11-01T10:00:00Z" };
      const first = await runtime.captureAndProcessBrowserVacancy(payload);
      if (first.processing.status !== "PROCESSED") throw new Error("Initial processing failed");
      const canonicalId = first.processing.canonicalVacancyId;
      db.prepare("INSERT INTO user_vacancy_interaction_events (id,canonical_vacancy_id,event_type,occurred_at,recorded_at,metadata_json) VALUES ('human-interest',?,'INTERESTED','2026-11-01T10:01:00Z','2026-11-01T10:01:00Z',NULL)").run(canonicalId);
      const snapshot = () => ["source_observations", "observation_cluster_assignments", "employer_clusters", "user_vacancy_interaction_events"]
        .map((table) => db.prepare("SELECT * FROM " + table + " ORDER BY rowid").all());
      const before = snapshot();
      const again = await runtime.captureAndProcessBrowserVacancy({ ...payload, capturedAt: "2026-11-02T10:00:00Z" });
      expect(again.capture.observationId).toBe(first.capture.observationId);
      expect(again.processing).toMatchObject({ status: "PROCESSED", canonicalVacancyId: canonicalId, observationAdded: false });
      expect(snapshot()).toEqual(before);
      const canonical = await new SqliteCanonicalVacancyRepository(db).findById(canonicalId);
      expect(canonical?.role.value?.title).toBe("Selected vacancy title");
      expect(canonical?.location.value?.rawText).toBe("Strasbourg, France");
      expect(JSON.stringify(canonical)).not.toMatch(POISON);
    } finally { db.close(); }
  });
});
