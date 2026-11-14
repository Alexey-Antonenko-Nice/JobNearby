import { describe, expect, it } from "vitest";
import { BrowserCaptureAcquisitionAdapter } from "../../src/application/acquisition/BrowserCaptureAcquisitionAdapter.js";
import { DeterministicAcquisitionCaptureMapper } from "../../src/application/acquisition/DeterministicAcquisitionCaptureMapper.js";
import { assessBrowserVacancyCapture } from "../../src/application/acquisition/assessBrowserVacancyCapture.js";
import { trustedDaimlerVacancy } from "../../src/application/acquisition/DaimlerTruckVacancy.js";
import { createVacancyEvidenceExtractor } from "../../src/application/evidence/createVacancyEvidenceExtractor.js";
import { directEmployerOrganizationNames } from "../../src/application/evidence/TrustedDirectEmployerSource.js";
import { scopeDaimlerTruckVacancyEvidence } from "../../src/application/evidence/scopeDaimlerTruckVacancyEvidence.js";
import { createDatabase } from "../../src/infrastructure/database/createDatabase.js";
import { createCaptureProcessingRuntime } from "../../src/infrastructure/runtime/createCaptureProcessingRuntime.js";

const sourceName = "jobsearch.daimlertruck.com";
const route = (id: string) => "https://" + sourceName + "/index.php?ac=jobad&id=" + id;
const apply = (id: string) => "https://fa-exdu-saasfaprod1.fa.ocs.oraclecloud.com/hcmUI/CandidateExperience/fr-CA/sites/CX_1/job/" + id + "/apply/email";
const script = (value: unknown) => '<script type="application/ld+json">' + JSON.stringify(value) + '</script>';
const posting = { "@type": "JobPosting", title: "Peintre Industriel (H/F)", hiringOrganization: { name: "Mercedes-Benz Trucks Molsheim SASU" },
  jobLocation: { address: { addressLocality: "Molsheim" } }, employmentType: "FULL_TIME" };
function page(id = "425026", secondary: number | string = 9913): string {
  return '<input type="hidden" name="jobad_id" value="' + id + '"><div id="jobad-container" data-jobad-id="' + id
    + '" data-uri="https://' + sourceName + '//index.php?ac=jobad&amp;id=' + id + '"><h1>' + posting.title + '</h1>'
    + '<div class="hidden-print"><h4>Job number: </h4><span>' + secondary + '</span></div><a href="' + apply(String(secondary)) + '">Apply online now</a>'
    + script({ ...posting, identifier: { "@type": "PropertyValue", name: posting.hiringOrganization.name, value: secondary } }) + '</div>';
}
function input(html = page(), id = "425026") {
  return new DeterministicAcquisitionCaptureMapper().toSourceObservation(new BrowserCaptureAcquisitionAdapter().toAcquisitionPackage({
    pageUrl: route(id), pageTitle: "Poison title", visibleText: "Employeur: Poison company", html, capturedAt: "2026-11-14T20:00:00Z",
  }, "a"), "o");
}
const extractor = createVacancyEvidenceExtractor();
describe("Daimler secondary job-number namespace", () => {
  it.each([["425026", 9913], ["425255", 10027], ["406648", 5092], ["420369", 7298], ["424504", 9590], ["425092", 9947], ["425026", "9913"]] as const)(
    "accepts corroborated real pair %s / %s", async (id, secondary) => {
      const observation = input(page(id, secondary), id);
      expect(observation.source.externalId).toBe(id);
      expect(await assessBrowserVacancyCapture(observation, extractor)).toMatchObject({ captureAcceptedAsVacancy: true });
      expect(trustedDaimlerVacancy({ sourceName, sourceUrl: route(id), externalId: id, html: page(id, secondary) })).toMatchObject({ routeId: id, secondaryJobNumber: String(secondary) });
      const evidence = await extractor.extract(observation);
      expect(evidence.externalIdentifiers).toEqual([expect.objectContaining({ value: id, identifierType: "SOURCE_EXTERNAL_ID" })]);
      expect(evidence.organizations).toContainEqual(expect.objectContaining({ value: posting.hiringOrganization.name, role: "EMPLOYER" }));
      const scoped = scopeDaimlerTruckVacancyEvidence(observation);
      expect(scopeDaimlerTruckVacancyEvidence(scoped)).toEqual(scoped);
      expect(JSON.stringify(scoped)).not.toContain("Poison");
      expect(directEmployerOrganizationNames(scoped)).toEqual([posting.hiringOrganization.name]);
    });
  it("preserves route-only compatibility", async () => {
    const observation = input(script(posting));
    expect(await assessBrowserVacancyCapture(observation, extractor)).toMatchObject({ captureAcceptedAsVacancy: true });
    expect(observation.source.externalId).toBe("425026");
  });
  it("compares structured URLs to the public route, not the job number", async () => {
    const html = page().replace('"identifier":', '"url":' + JSON.stringify(route("425026")) + ',"identifier":');
    expect(await assessBrowserVacancyCapture(input(html), extractor)).toMatchObject({ captureAcceptedAsVacancy: true });
  });
  it.each([
    ["JSON vs visible", (h: string) => h.replace('<span>9913</span>', '<span>9914</span>')],
    ["JSON vs apply", (h: string) => h.replace('/job/9913/', '/job/9914/')],
    ["visible vs apply without JSON", (h: string) => h.replace('/job/9913/', '/job/9914/').replace(/,"identifier":\{[^}]+\}/u, '')],
    ["other labelled number", (h: string) => h + '<p>Job number: 9914</p>'],
    ["unclosed apply link", (h: string) => h + '<a href="' + apply("9914") + '">Apply'],
    ["two visible numbers", (h: string) => h.replace('</h1>', '</h1><h4>Job number:</h4><span>9914</span>')],
    ["duplicate visible number", (h: string) => h.replace('</h1>', '</h1><h4>Job number:</h4><span>9913</span>')],
    ["conflicting apply links", (h: string) => h.replace('</h1>', '</h1><a href="' + apply("9914") + '">Apply</a>')],
    ["missing visible proof", (h: string) => h.replace('<h4>Job number: </h4><span>9913</span>', '')],
    ["missing apply proof", (h: string) => h.replace(/<a[^>]*>.*?<\/a>/u, '')],
    ["missing structured secondary", (h: string) => h.replace(/,"identifier":\{[^}]+\}/u, '')],
    ["hidden visible value", (h: string) => h.replace('<span>', '<span hidden>')],
    ["hidden number ancestor", (h: string) => h.replace('<div class="hidden-print"><h4>', '<div style="display:none"><h4>')],
    ["neighbor number", (h: string) => h.replace('<h4>Job number: </h4><span>9913</span>', '') + '<h4>Job number:</h4><span>9913</span>'],
    ["hidden route input mismatch", (h: string) => h.replace('value="425026"', 'value="425027"')],
    ["container ID mismatch", (h: string) => h.replace('data-jobad-id="425026"', 'data-jobad-id="425027"')],
    ["unquoted URI mismatch", (h: string) => h.replace('data-uri="https://' + sourceName + '//index.php?ac=jobad&amp;id=425026"', 'data-uri = https://' + sourceName + '/index.php?ac=jobad&amp;id=999')],
    ["duplicate route attribute", (h: string) => h.replace('data-jobad-id="425026"', 'data-jobad-id="425026" data-jobad-id="999"')],
    ["container URI mismatch", (h: string) => h.replace('id=425026', 'id=425027')],
    ["structured URL mismatch", (h: string) => h.replace('"identifier":', '"url":' + JSON.stringify(route("9913")) + ',"identifier":')],
    ["multiple postings", (h: string) => h + script({ ...posting, hiringOrganization: { name: "Foreign employer" } })],
    ["duplicate container", (h: string) => h + '<div id="jobad-container" data-jobad-id="425026"></div>'],
    ["hidden container", (h: string) => h.replace('id="jobad-container"', 'hidden id="jobad-container"')],
    ["duplicate hidden ID", (h: string) => h + '<input name="jobad_id" value="425026">'],
    ["foreign apply host", (h: string) => h.replace('fa-exdu-saasfaprod1.fa.ocs.oraclecloud.com', 'foreign.example')],
    ["wrong Oracle site", (h: string) => h.replace('/sites/CX_1/', '/sites/CX_2/')],
  ] as const)("rejects %s without employer leakage", async (_name, mutate) => {
    const observation = input(mutate(page()));
    expect(await assessBrowserVacancyCapture(observation, extractor)).toMatchObject({ captureAcceptedAsVacancy: false });
    expect(directEmployerOrganizationNames(observation)).toEqual([]);
    const evidence = await extractor.extract(observation);
    expect(evidence.organizations).toEqual([]);
    expect(evidence.vacancyTitles).toEqual([]);
    expect(evidence.locations).toEqual([]);
  });
  it.each([null, "JR9913", "09913", "9913.0", " 9913 ", -1, 1.5, Number.MAX_SAFE_INTEGER + 1, [9913], { value: 9913 }])(
    "rejects malformed secondary value %j", async value => {
      const html = page().replace('"value":9913', '"value":' + JSON.stringify(value));
      expect(await assessBrowserVacancyCapture(input(html), extractor)).toMatchObject({ captureAcceptedAsVacancy: false });
    });
  it("does not accept a matching route number as an uncorroborated secondary", async () => {
    expect(await assessBrowserVacancyCapture(input(script({ ...posting, identifier: { "@type": "PropertyValue", value: "425026" } })), extractor))
      .toMatchObject({ captureAcceptedAsVacancy: false });
  });
  it("keeps repeated captures and exact claims route-based without secondary aliases", async () => {
    const db = createDatabase(":memory:");
    try {
      const runtime = createCaptureProcessingRuntime(db);
      const capture = (id: string, time: string) => runtime.captureAndProcessBrowserVacancy({ pageUrl: route(id), pageTitle: posting.title,
        visibleText: posting.title, html: page(id), capturedAt: time });
      const first = await capture("425026", "2026-11-14T10:00:00Z");
      const second = await capture("425026", "2026-11-14T11:00:00Z");
      const different = await capture("425027", "2026-11-14T12:00:00Z");
      if (first.processing.status !== "PROCESSED" || second.processing.status !== "PROCESSED" || different.processing.status !== "PROCESSED") throw new Error("Expected processing");
      expect(first.processing.canonicalVacancyId).toBe(second.processing.canonicalVacancyId);
      expect(different.processing.canonicalVacancyId).not.toBe(first.processing.canonicalVacancyId);
      expect(db.prepare("select provider_namespace, external_id from canonical_vacancy_exact_identity_claims order by external_id").all()).toEqual([
        { provider_namespace: sourceName, external_id: "425026" }, { provider_namespace: sourceName, external_id: "425027" },
      ]);
      expect(db.prepare("select distinct external_id from source_observations order by external_id").all()).toEqual([{ external_id: "425026" }, { external_id: "425027" }]);
      expect(db.prepare("select count(*) as n from capture_occurrences").get()).toEqual({ n: 3 });
    } finally { db.close(); }
  });
});
