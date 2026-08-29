import { describe, expect, it } from "vitest";

import { BrowserCaptureAcquisitionAdapter } from "../../src/application/acquisition/BrowserCaptureAcquisitionAdapter.js";
import { DeterministicAcquisitionCaptureMapper } from "../../src/application/acquisition/DeterministicAcquisitionCaptureMapper.js";
import { HostnameAcquisitionProviderRecognizer } from "../../src/application/acquisition/HostnameAcquisitionProviderRecognizer.js";
import { LinkedInSelectedVacancyContextLocator } from "../../src/application/acquisition/LinkedInSelectedVacancyContextLocator.js";
import { createAcquisitionPackage } from "../../src/domain/acquisition/AcquisitionPackage.js";

const recognizer = new HostnameAcquisitionProviderRecognizer();
const locator = new LinkedInSelectedVacancyContextLocator();
const adapter = new BrowserCaptureAcquisitionAdapter();
const mapper = new DeterministicAcquisitionCaptureMapper();

function linkedInHtml(id: string, options: {
  readonly primaryId?: string;
  readonly linkId?: string;
  readonly componentId?: string;
  readonly includeLink?: boolean;
  readonly includeComponent?: boolean;
  readonly duplicatePrimary?: boolean;
  readonly competingPrimaryId?: string;
  readonly competingLinkId?: string;
  readonly repeatedDetailLink?: boolean;
  readonly separateMatchingLinkBranch?: boolean;
} = {}): string {
  const primaryId = options.primaryId ?? id;
  const linkId = options.linkId ?? id;
  const componentId = options.componentId ?? id;
  const primary = `
    <div id="JobDetails_AboutTheJob_${primaryId}" class="job-details-section">
      <h2>À propos de l’offre d’emploi</h2>
      <p>Bounded LinkedIn vacancy description.</p>
    </div>`;
  return `
    <main id="workspace">
      <div class="results-list">
        <div role="button" componentkey="job-card-component-ref-9999999999">Other vacancy</div>
        ${options.includeComponent === false ? "" : `<div role="button" componentkey="job-card-component-ref-${componentId}">Selected result</div>`}
      </div>
      <div class="detail-pane">
        <div class="selected-job-detail">
          <div class="job-header">
            ${options.includeLink === false ? "" : `<a href="https://www.linkedin.com/jobs/view/${linkId}/?trackingId=abc">Selected vacancy title</a>`}
            ${options.repeatedDetailLink === true ? `<a href="/jobs/view/${linkId}/?alternateChannel=search">Repeated selected vacancy link</a>` : ""}
          </div>
          <div class="job-sections">
            ${primary}
            ${options.duplicatePrimary === true ? primary : ""}
            ${options.competingPrimaryId === undefined ? "" : `<div id="JobDetails_AboutTheJob_${options.competingPrimaryId}">Competing vacancy</div>`}
            <div id="JobDetails_AboutTheCompany_${primaryId}">Selected company details</div>
          </div>
          ${options.competingLinkId === undefined ? "" : `<a href="/jobs/view/${options.competingLinkId}/">Competing vacancy link</a>`}
        </div>
      </div>
      ${options.separateMatchingLinkBranch === true ? `<div class="separate-branch"><a href="/jobs/view/${linkId}/">Separate selected vacancy link</a></div>` : ""}
    </main>`;
}

function locate(id: string, html: string, sourceUrl = `https://www.linkedin.com/jobs/search/?currentJobId=${id}`) {
  return locator.locate({
    providerKey: "LINKEDIN",
    sourceUrl,
    externalId: id,
    html,
  });
}

describe("LinkedIn acquisition provider recognition", () => {
  it.each([
    ["linkedin.com", "https://linkedin.com/jobs/search/?currentJobId=4460344242"],
    ["linkedin.com", "https://www.linkedin.com/jobs/search/?currentJobId=4460344242"],
    ["linkedin.com", "https://fr.linkedin.com/jobs/search/?currentJobId=4460344242"],
  ])("recognizes normalized source %s at %s", (sourceName, sourceUrl) => {
    expect(recognizer.recognize({ sourceName, sourceUrl })).toBe("LINKEDIN");
  });

  it.each([
    ["fake-linkedin.com", "https://fake-linkedin.com/jobs/?currentJobId=1"],
    ["linkedin.example.com", "https://linkedin.example.com/jobs/?currentJobId=1"],
    ["example.com", "https://www.linkedin.com/jobs/?currentJobId=1"],
  ])("rejects lookalike or inconsistent source %s", (sourceName, sourceUrl) => {
    expect(recognizer.recognize({ sourceName, sourceUrl })).toBeUndefined();
  });
});

describe("LinkedInSelectedVacancyContextLocator", () => {
  it("uses the exact JobDetails section and job link to bound one selected vacancy", () => {
    const context = locate("4460344242", linkedInHtml("4460344242"));
    expect(context).toMatchObject({
      kind: "SELECTED_VACANCY",
      associationMethod: "PROVIDER_LOCATOR",
      providerKey: "LINKEDIN",
      providerExternalId: "4460344242",
      associationEvidence: [
        "URL_EXTERNAL_ID",
        "MATCHING_JOB_DETAILS",
        "BOUNDED_JOB_DETAIL",
        "MATCHING_LINKEDIN_JOB_LINK",
      ],
    });
    expect(context?.text).toContain("Bounded LinkedIn vacancy description");
    expect(context?.text).not.toContain("Other vacancy");
    expect(context?.html).toContain('id="JobDetails_AboutTheJob_4460344242"');
    expect(context?.html).not.toContain('id="workspace"');
  });

  it("uses the primary JobDetails section when a component reference is the corroboration", () => {
    const context = locate("4460344242", linkedInHtml("4460344242", { includeLink: false }));
    expect(context?.associationEvidence).toContain("MATCHING_LINKEDIN_COMPONENT_REFERENCE");
    expect(context?.html).toMatch(/^\s*<div id="JobDetails_AboutTheJob_/u);
  });

  it("accepts repeated same-ID job links inside one unambiguous detail branch", () => {
    const context = locate("4460344242", linkedInHtml("4460344242", {
      repeatedDetailLink: true,
    }));
    expect(context?.providerExternalId).toBe("4460344242");
    expect(context?.text).toContain("Repeated selected vacancy link");
  });

  it("rejects same-ID links split across structurally competing branches", () => {
    expect(locate("4460344242", linkedInHtml("4460344242", {
      separateMatchingLinkBranch: true,
    }))).toBeUndefined();
  });

  it("rejects a broad result-shell boundary without a defensible detail branch", () => {
    const id = "4460344242";
    const html = `
      <div class="results-shell">
        <div class="unrelated-results">
          <a href="/jobs/view/${id}/">Selected result link</a>
          <p>Many unrelated vacancy results</p>
        </div>
        <div class="detail-pane">
          <div id="JobDetails_AboutTheJob_${id}"><p>Selected description</p></div>
        </div>
      </div>`;
    expect(locate(id, html)).toBeUndefined();
  });

  it("rejects currentJobId mismatch or absence", () => {
    const html = linkedInHtml("4460344242");
    expect(locate("4460344242", html, "https://www.linkedin.com/jobs/search/"))
      .toBeUndefined();
    expect(locate("4460344242", html, "https://www.linkedin.com/jobs/search/?currentJobId=1"))
      .toBeUndefined();
  });

  it("rejects a primary JobDetails section for another vacancy", () => {
    expect(locate("4460344242", linkedInHtml("4460344242", { primaryId: "4458098323" })))
      .toBeUndefined();
  });

  it("rejects missing independent exact ID corroboration", () => {
    expect(locate("4460344242", linkedInHtml("4460344242", {
      includeLink: false,
      includeComponent: false,
    }))).toBeUndefined();
    expect(locate("4460344242", linkedInHtml("4460344242", {
      linkId: "4458098323",
      componentId: "4458098323",
    }))).toBeUndefined();
  });

  it("rejects duplicate or competing vacancy detail evidence", () => {
    expect(locate("4460344242", linkedInHtml("4460344242", { duplicatePrimary: true })))
      .toBeUndefined();
    expect(locate("4460344242", linkedInHtml("4460344242", {
      competingPrimaryId: "4458098323",
    }))).toBeUndefined();
    expect(locate("4460344242", linkedInHtml("4460344242", {
      competingLinkId: "4458098323",
    }))).toBeUndefined();
  });

  it("rejects a generic result shell even when the ID occurs elsewhere", () => {
    const html = '<main id="workspace"><div componentkey="job-card-component-ref-4460344242">Result only</div></main>';
    expect(locate("4460344242", html)).toBeUndefined();
  });
});

describe("LinkedIn selected-context acquisition integration", () => {
  it("preserves the full snapshot and adds context without projecting fields", () => {
    const acquisition = adapter.toAcquisitionPackage({
      pageUrl: "https://www.linkedin.com/jobs/search/?currentJobId=4460344242",
      pageTitle: "LinkedIn selected vacancy",
      visibleText: "FULL LINKEDIN PAGE WITH MULTIPLE VACANCIES",
      html: linkedInHtml("4460344242"),
      capturedAt: "2026-08-28T22:10:00Z",
    }, "linkedin-selected-context");
    const observation = mapper.toSourceObservation(acquisition, "linkedin-observation");

    expect(acquisition.source.sourceName).toBe("linkedin.com");
    expect(acquisition.externalId).toBe("4460344242");
    expect(acquisition.contexts).toHaveLength(1);
    expect(observation.rawContent).toBe("FULL LINKEDIN PAGE WITH MULTIPLE VACANCIES");
    expect(observation.metadata.acquisition).toMatchObject({ contexts: acquisition.contexts });
    expect(observation).not.toHaveProperty("title");
    expect(observation).not.toHaveProperty("displayedCompanyName");
    expect(observation).not.toHaveProperty("locationText");
  });

  it("keeps missing HTML non-fatal", () => {
    const acquisition = adapter.toAcquisitionPackage({
      pageUrl: "https://www.linkedin.com/jobs/search/?currentJobId=4460344242",
      pageTitle: "LinkedIn",
      visibleText: "Full visible page",
      capturedAt: "2026-08-28T22:10:00Z",
    }, "linkedin-no-html");
    expect(acquisition.externalId).toBe("4460344242");
    expect(acquisition.contexts).toBeUndefined();
  });

  it("keeps manual acquisition independent from browser context concepts", () => {
    const acquisition = createAcquisitionPackage({
      acquisitionId: "manual-linkedin-regression",
      acquiredAt: new Date("2026-08-29T10:00:00Z"),
      source: { sourceType: "MANUAL", sourceName: "Manual entry" },
      content: { text: "User-entered vacancy" },
      metadata: {},
    });
    expect(acquisition.contexts).toBeUndefined();
    expect(acquisition.externalId).toBeUndefined();
    expect(acquisition.sourceUrl).toBeUndefined();
  });

  it("keeps France Travail and Indeed locators working", () => {
    const franceTravail = adapter.toAcquisitionPackage({
      pageUrl: "https://candidat.francetravail.fr/offres/recherche/detail/213BBCX",
      pageTitle: "France Travail",
      visibleText: "Full page",
      html: '<li data-id-offre="213BBCX" class="active"></li><div id="PopinDetails" class="modal-details-offre in"><h1>Offre n° 213BBCX</h1></div>',
      capturedAt: "2026-08-29T05:21:25Z",
    }, "france-travail-regression");
    const indeedId = "73c6c191fddb1427";
    const indeed = adapter.toAcquisitionPackage({
      pageUrl: `https://fr.indeed.com/?vjk=${indeedId}`,
      pageTitle: "Indeed",
      visibleText: "Full page",
      html: `<div class="result vjs-highlight job_${indeedId}"><a data-jk="${indeedId}">Job</a></div><section id="job-full-details" class="jobsearch-ViewJobContainerWrapper"><a href="/cmp/x?fromjk=${indeedId}">Company</a></section>`,
      capturedAt: "2026-08-28T22:09:22Z",
    }, "indeed-regression");
    expect(franceTravail.contexts?.[0]?.providerKey).toBe("FRANCE_TRAVAIL");
    expect(indeed.contexts?.[0]?.providerKey).toBe("INDEED");
  });

  it("leaves Schema.org and unknown-provider acquisition unchanged", () => {
    const jobPosting = { "@type": "JobPosting", title: "Technician" };
    for (const pageUrl of [
      "https://www.hellowork.com/fr-fr/emplois/82745536.html",
      "https://www.meteojob.com/jobs/56378291",
      "https://example.com/jobs/42",
    ]) {
      const acquisition = adapter.toAcquisitionPackage({
        pageUrl,
        pageTitle: "Vacancy",
        visibleText: "Full page",
        html: `<script type="application/ld+json">${JSON.stringify(jobPosting)}</script>`,
        capturedAt: "2026-08-29T10:00:00Z",
      }, `regression-${pageUrl}`);
      expect(acquisition.content.structuredPayload).toMatchObject({ jobPostings: [jobPosting] });
      expect(acquisition.contexts).toBeUndefined();
    }
  });
});
