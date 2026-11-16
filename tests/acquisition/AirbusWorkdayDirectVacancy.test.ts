import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
const { JSDOM } = require("jsdom");
import { AIRBUS_WORKDAY_HOST, AirbusDirectVacancyContextLocator, airbusDirectRoute } from "../../src/application/acquisition/AirbusWorkdayVacancy.js";
import { BrowserCaptureAcquisitionAdapter } from "../../src/application/acquisition/BrowserCaptureAcquisitionAdapter.js";
import { ConservativeProviderVacancyIdExtractor } from "../../src/application/acquisition/ConservativeProviderVacancyIdExtractor.js";
import { DeterministicAcquisitionCaptureMapper } from "../../src/application/acquisition/DeterministicAcquisitionCaptureMapper.js";
import { ProviderCaptureRegistry } from "../../src/application/acquisition/ProviderCaptureRegistry.js";
import { assessBrowserVacancyCapture } from "../../src/application/acquisition/assessBrowserVacancyCapture.js";
import { isGenericWorkdaySource } from "../../src/application/acquisition/GenericWorkdayVacancy.js";
import { extractWorkdayVacancyId } from "../../src/application/acquisition/WorkdayVacancy.js";
import { scopeAirbusWorkdayVacancyEvidence } from "../../src/application/evidence/scopeAirbusWorkdayVacancyEvidence.js";
import { scopeProviderVacancyEvidence, hasExplicitVacancyEvidenceScopeRoute } from "../../src/application/evidence/scopeProviderVacancyEvidence.js";
import { createVacancyEvidenceExtractor } from "../../src/application/evidence/createVacancyEvidenceExtractor.js";
import { createDatabase } from "../../src/infrastructure/database/createDatabase.js";
import { createCaptureProcessingRuntime } from "../../src/infrastructure/runtime/createCaptureProcessingRuntime.js";

const digital = readFileSync("tests/fixtures/airbusDirectDigitalBoard.html", "utf8");
const aero = readFileSync("tests/fixtures/airbusDirectAerodynamics.html", "utf8");
const digitalUrl = "https://ag.wd3.myworkdayjobs.com/en-US/airbus/job/Toulouse-Area/Concepteur-de-cartes-numriques--f-h-_JR10448154-1?utm_source=chatgpt.com";
const aeroUrl = "https://ag.wd3.myworkdayjobs.com/Airbus/job/Toulouse-Area/Experimental-aerodynamics---Wind-tunnel-model-designer-and-stress-calculation--m-f-_JR10453159?utm_source=chatgpt.com";
const extractor = createVacancyEvidenceExtractor(), locator = new AirbusDirectVacancyContextLocator();
const q = (id: string) => `[data-automation-id="${id}"]`;
function change(html: string, edit: (document: Document) => void): string {
  const dom = new JSDOM(html); try { edit(dom.window.document); return dom.serialize(); } finally { dom.window.close(); }
}
function json(document: Document, edit: (value: Record<string, any>) => void) {
  const script = document.querySelector('script[type="application/ld+json"]')!;
  const value = JSON.parse(script.textContent!); edit(value); script.textContent = JSON.stringify(value);
}
function capture(html = aero, pageUrl = aeroUrl) {
  const acquisition = new BrowserCaptureAcquisitionAdapter().toAcquisitionPackage({ pageUrl, pageTitle: "OUTSIDE_PAGE_TITLE",
    visibleText: "Employeur: OUTSIDE_RAW_COMPANY", html, capturedAt: "2026-11-15T20:00:00Z" }, "a");
  return { acquisition, observation: new DeterministicAcquisitionCaptureMapper().toSourceObservation(acquisition, "o") };
}
function locate(html = aero, sourceUrl = aeroUrl) { return locator.locate({ providerKey: "AIRBUS_WORKDAY", sourceUrl, html }); }
async function rejected(html: string, url = aeroUrl) {
  const { acquisition, observation } = capture(html, url);
  expect(acquisition.contexts).toBeUndefined(); expect(acquisition.externalId).toBeUndefined();
  const acceptance = await assessBrowserVacancyCapture(observation, extractor);
  expect(acceptance).toMatchObject({ captureAcceptedAsVacancy: false }); expect(acceptance).not.toHaveProperty("partialRecaptureIdentity");
  const evidence = await extractor.extract(observation);
  expect(evidence.vacancyTitles).toEqual([]); expect(evidence.organizations).toEqual([]); expect(evidence.people).toEqual([]);
  expect(evidence.locations).toEqual([]); expect(evidence.engagements).toEqual([]);
}

describe("Airbus direct Workday boundary", () => {
  it.each([
    { label: "Digital Board Designer", html: digital, url: digitalUrl, id: "JR10448154", title: "Digital Board Designer (f/m)" },
    { label: "Experimental aerodynamics", html: aero, url: aeroUrl, id: "JR10453159", title: "Experimental aerodynamics - Wind tunnel model designer and stress calculation (m/f)" },
  ])("accepts reduced real $label capture with bounded fields", async ({ html, url, id, title }) => {
    const { acquisition, observation } = capture(html, url);
    expect(acquisition.source.sourceName).toBe(AIRBUS_WORKDAY_HOST); expect(acquisition.externalId).toBe(id);
    expect(acquisition.contexts).toHaveLength(1);
    expect(observation).toMatchObject({ title, locationText: "Toulouse Area", contractText: "Full time" });
    expect(observation.displayedCompanyName).toBeUndefined();
    expect(await assessBrowserVacancyCapture(observation, extractor)).toMatchObject({ captureAcceptedAsVacancy: true });
    const scoped = scopeAirbusWorkdayVacancyEvidence(observation);
    expect(scoped.description).toBeTruthy(); expect(JSON.stringify(scoped)).not.toContain("OUTSIDE_");
    expect((await extractor.extract(observation)).vacancyTitles).toContainEqual(expect.objectContaining({ value: title }));
  });
  it("does not publish a suffixed ID based on the route alone", () => {
    expect(airbusDirectRoute(digitalUrl)).toEqual({ routeId: "JR10448154-1", requisitionId: "JR10448154", suffixed: true });
    expect(new ConservativeProviderVacancyIdExtractor().extract({ sourceName: AIRBUS_WORKDAY_HOST, sourceUrl: digitalUrl })).toBeUndefined();
    expect(new ProviderCaptureRegistry().capture({ sourceName: AIRBUS_WORKDAY_HOST, sourceUrl: digitalUrl }).externalId).toBeUndefined();
  });
  it.each(["/Airbus/", "/airbus/", "/AIRBUS/", "/en-US/Airbus/", "/fr-FR/airbus/"])("supports observed direct tenant/locale grammar %s", async prefix => {
    const url = aeroUrl.replace("/Airbus/", prefix) + "&irrelevant=value#fragment";
    expect(capture(aero, url).acquisition.externalId).toBe("JR10453159");
    expect(await assessBrowserVacancyCapture(capture(aero, url).observation, extractor)).toMatchObject({ captureAcceptedAsVacancy: true });
  });
  it("rejects route/DOM disagreement without optional corroboration", () => {
    const html = change(aero, d => { d.querySelectorAll('script,' + q('adventureButton')).forEach(e => e.remove()); });
    expect(Boolean(locate(html, aeroUrl.replace("JR10453159", "JR10453160")))).toBe(false);
  });
  it("normalizes -1 only with a matching owned DOM requisition", async () => {
    await rejected(change(digital, d => d.querySelector(q('requisitionId'))!.remove()), digitalUrl);
    await rejected(change(digital, d => { d.querySelector(q('requisitionId') + ' dd')!.textContent = 'JR999'; }), digitalUrl);
  });
  it.each([
    { label: "route differs from DOM", edit: (d: Document) => { d.querySelector(q('requisitionId') + ' dd')!.textContent = 'JR999'; } },
    { label: "route and DOM differ from JSON-LD", edit: (d: Document) => json(d, p => p.identifier.value = 'JR999') },
    { label: "DOM and JSON-LD disagree", edit: (d: Document) => { d.querySelector(q('requisitionId') + ' dd')!.textContent = 'JR999'; json(d, p => p.identifier.value = 'JR10453159'); } },
    { label: "unparseable structured ID", edit: (d: Document) => json(d, p => p.identifier = {}) },
    { label: "multiple JobPostings", edit: (d: Document) => d.head.appendChild(d.querySelector('script')!.cloneNode(true)) },
    { label: "malformed JSON-LD", edit: (d: Document) => { d.querySelector('script')!.textContent = '{'; } },
    { label: "apply ID conflict", edit: (d: Document) => { const a = d.querySelector(q('adventureButton'))!; a.setAttribute('href', a.getAttribute('href')!.replace('JR10453159', 'JR999')); } },
    { label: "duplicate headers", edit: (d: Document) => d.body.appendChild(d.querySelector(q('jobPostingHeader'))!.cloneNode(true)) },
    { label: "duplicate detail regions", edit: (d: Document) => d.body.appendChild(d.querySelector(q('job-posting-details'))!.cloneNode(true)) },
    { label: "missing requisition", edit: (d: Document) => d.querySelector(q('requisitionId'))!.remove() },
    { label: "duplicate owned requisitions", edit: (d: Document) => d.querySelector(q('job-posting-details'))!.appendChild(d.querySelector(q('requisitionId'))!.cloneNode(true)) },
    { label: "missing description", edit: (d: Document) => d.querySelector(q('jobPostingDescription'))!.remove() },
    { label: "meaningless title", edit: (d: Document) => { d.querySelector(q('jobPostingHeader'))!.textContent = 'Search jobs'; } },
    { label: "unowned header", edit: (d: Document) => d.body.appendChild(d.querySelector(q('jobPostingHeader'))!) },
  ])("rejects $label", async ({ edit }) => rejected(change(aero, edit)));
  it.each(['hidden', 'aria-hidden', 'display', 'visibility', 'ancestor'])("rejects hidden header/detail: %s", async kind => {
    for (const id of ['jobPostingHeader', 'job-posting-details']) {
      await rejected(change(aero, d => {
        const e = d.querySelector(q(id))!;
        if (kind === 'hidden') e.setAttribute('hidden', '');
        else if (kind === 'aria-hidden') e.setAttribute('aria-hidden', 'true');
        else if (kind === 'ancestor') { const wrapper = d.createElement('section'); wrapper.hidden = true; e.replaceWith(wrapper); wrapper.appendChild(e); }
        else e.setAttribute('style', kind === 'display' ? 'display:none' : 'visibility:hidden');
      }));
    }
  });
  it.each(['JRabc', 'JR', 'JR-10453159', 'JR10453159-2', 'JR10453159-1-1', 'JR10453159x'])("rejects malformed or unsupported ID %s", async id => {
    await rejected(aero, aeroUrl.replace('JR10453159', id));
  });
  it("excludes all three similar-job cards and their poisoned fields", async () => {
    let count = 0;
    const html = change(aero, d => {
      for (const card of d.querySelectorAll(q('similarJobsCard'))) {
        count++; card.innerHTML = '<a href="/Airbus/job/Paris/Other_JR999">OUTSIDE_RECOMMENDATION_TITLE</a>'
          + '<div data-automation-id="requisitionId">JR999</div><div data-automation-id="jobTitle">OUTSIDE_JOB_TITLE</div>'
          + '<div data-automation-id="locations">OUTSIDE_LOCATION</div><div data-automation-id="company">OUTSIDE_COMPANY</div>'
          + '<div data-automation-id="time">Part time</div><p>Employeur : OUTSIDE_EMPLOYER</p>';
      }
    });
    expect(count).toBe(3);
    const { observation, acquisition } = capture(html);
    expect(acquisition.externalId).toBe('JR10453159');
    expect(await assessBrowserVacancyCapture(observation, extractor)).toMatchObject({ captureAcceptedAsVacancy: true });
    expect(JSON.stringify(acquisition.contexts)).not.toMatch(/OUTSIDE_|JR999|Part time/);
    expect(JSON.stringify(await extractor.extract(observation))).not.toMatch(/OUTSIDE_|JR999|Part time/);
  });
  it("rejects recommendation cards alone", async () => {
    await rejected(change(aero, d => { d.querySelector(q('jobPostingHeader'))!.parentElement!.parentElement!.remove(); d.querySelector(q('job-posting-details'))!.remove(); }));
  });
  it("excludes page-global JSON-LD fields, sidebar prose, time and location", async () => {
    const html = change(aero, d => {
      json(d, p => { p.title = 'OUTSIDE_TITLE'; p.description = 'Employeur : OUTSIDE_EMPLOYER'; p.hiringOrganization = { name: 'OUTSIDE_COMPANY' }; p.employmentType = 'OUTSIDE_TIME'; p.jobLocation = { address: { addressLocality: 'OUTSIDE_LOCATION' } }; });
      d.body.insertAdjacentHTML('beforeend', '<aside>Employeur : OUTSIDE_SIDEBAR</aside><div data-automation-id="locations">OUTSIDE_LOCATION</div><div data-automation-id="time">OUTSIDE_TIME</div>');
    });
    const { observation } = capture(html);
    expect(await assessBrowserVacancyCapture(observation, extractor)).toMatchObject({ captureAcceptedAsVacancy: true });
    expect(JSON.stringify(await extractor.extract(observation))).not.toContain('OUTSIDE_');
  });
  it("retains a company only from an explicit owned field", async () => {
    const html = change(aero, d => d.querySelector(q('job-posting-details'))!.insertAdjacentHTML('beforeend', '<div data-automation-id="company"><dl><dd>OWNED_COMPANY</dd></dl></div>'));
    const { observation } = capture(html);
    expect(observation.displayedCompanyName).toBe('OWNED_COMPANY');
    expect((await extractor.extract(observation)).organizations).toContainEqual(expect.objectContaining({ value: 'OWNED_COMPANY' }));
  });
  it("does not admit nested widget prose or hidden descendants", async () => {
    const html = change(aero, d => d.querySelector(q('jobPostingDescription'))!.insertAdjacentHTML('beforeend', '<aside>Employeur : OUTSIDE_WIDGET</aside><div hidden>OUTSIDE_HIDDEN</div><div data-automation-id="similarJobsCard">Employeur : OUTSIDE_CARD</div>'));
    expect(JSON.stringify(await extractor.extract(capture(html).observation))).not.toContain('OUTSIDE_');
  });
  it.each(['/en-US/Airbus/details/Engineer_JR10453159', '/Airbus/details/Engineer_JR10453159', '/Airbus', '/en-US/Airbus', '/en-US/Other/job/Toulouse/Engineer_JR10453159'])("rejects unsupported route %s", async route => rejected(aero, 'https://' + AIRBUS_WORKDAY_HOST + route));
  it("rejects a selected result list and pane even on a forged direct route", async () => {
    const html = change(aero, d => { d.querySelector(q('job-posting-details'))!.setAttribute('data-automation-id', 'jobDetails'); d.body.insertAdjacentHTML('beforeend', '<section data-automation-id="jobResults"><div data-automation-id="jobTitle">Other job</div></section>'); });
    await rejected(html);
  });
  it("does not alias the historical stripped namespace", async () => {
    const original = capture().observation, legacy = { ...original, source: { ...original.source, sourceName: 'wd3.myworkdayjobs.com' } };
    const before = structuredClone(legacy);
    expect(new ProviderCaptureRegistry().capture({ sourceName: legacy.source.sourceName, sourceUrl: aeroUrl, html: aero }).context).toBeUndefined();
    expect((await extractor.extract(legacy)).vacancyTitles).toEqual([]);
    expect(await assessBrowserVacancyCapture(legacy, extractor)).toMatchObject({ captureAcceptedAsVacancy: false });
    expect(legacy).toEqual(before);
  });
  it("revalidates bounded contexts, rejects forged contexts, and does not mutate inputs", () => {
    const input = capture().observation, before = structuredClone(input), first = scopeAirbusWorkdayVacancyEvidence(input);
    expect(scopeAirbusWorkdayVacancyEvidence(first)).toEqual(first); expect(input).toEqual(before);
    const a = input.metadata.acquisition as { html: string; contexts: any[] };
    for (const patch of [{ text: 'OUTSIDE_POISON' }, { providerExternalId: 'JR999' }, { providerKey: 'KELLY_WORKDAY' }, { metadata: {} }]) {
      expect(scopeAirbusWorkdayVacancyEvidence({ ...input, metadata: { acquisition: { ...a, contexts: [{ ...a.contexts[0], ...patch }] } } }).title).toBeUndefined();
    }
    expect(scopeAirbusWorkdayVacancyEvidence({ ...input, metadata: { acquisition: { contexts: a.contexts } } }).title).toBe(input.title);
  });
  it("strips all page-derived fields and contact/structured payload poison before evidence", async () => {
    const input = capture().observation;
    const poisoned = { ...input, title: 'OUTSIDE_TITLE', displayedCompanyName: 'OUTSIDE_COMPANY', locationText: 'OUTSIDE_LOCATION', contractText: 'OUTSIDE_TIME',
      description: 'Employeur : OUTSIDE_EMPLOYER', contactText: 'OUTSIDE_PERSON', rawContent: 'OUTSIDE_RAW',
      metadata: { ...input.metadata, private: 'OUTSIDE_METADATA', acquisition: { ...input.metadata.acquisition as object, structuredPayload: { title: 'OUTSIDE_JSONLD' } } } };
    expect(JSON.stringify(scopeAirbusWorkdayVacancyEvidence(poisoned))).not.toContain('OUTSIDE_');
    expect(JSON.stringify(await extractor.extract(poisoned))).not.toContain('OUTSIDE_');
  });
  it("preserves other Workday providers and ordinary locale normalization", () => {
    const registry = new ProviderCaptureRegistry();
    for (const [sourceName, sourceUrl, key] of [
      ['kellyservices.wd503.myworkdayjobs.com', 'https://kellyservices.wd503.myworkdayjobs.com/en-US/corporatecareers-kellyservices-com/details/Engineer_JR100451', 'KELLY_WORKDAY'],
      ['alliancewd.wd3.myworkdayjobs.com', 'https://alliancewd.wd3.myworkdayjobs.com/fr-FR/renault-group-careers/job/Toulouse/Engineer_JOBREQ_123', 'RENAULT_WORKDAY'],
    ] as const) expect(registry.capture({ sourceName, sourceUrl }).providerKey).toBe(key);
    expect(isGenericWorkdaySource(AIRBUS_WORKDAY_HOST, aeroUrl)).toBe(false);
    expect(hasExplicitVacancyEvidenceScopeRoute(AIRBUS_WORKDAY_HOST, aeroUrl)).toBe(true);
    expect(scopeProviderVacancyEvidence(capture().observation)).toEqual(scopeAirbusWorkdayVacancyEvidence(capture().observation));
    expect(extractWorkdayVacancyId('https://example.wd5.myworkdayjobs.com/en-US/site/details/Engineer_JR-123')).toBe('JR-123');
    expect(extractWorkdayVacancyId(aeroUrl)).toBeUndefined();
    expect(capture('<div></div>', 'https://fr.indeed.com/viewjob?jk=abc').acquisition.source.sourceName).toBe('indeed.com');
    expect(registry.capture({ sourceName: 'other.wd3.myworkdayjobs.com', sourceUrl: aeroUrl.replace('ag.', 'other.'), html: aero }).context).toBeUndefined();
  });
  it("processes safe captures with exact full-host identity in a temporary database", async () => {
    const db = createDatabase(':memory:');
    try {
      const runtime = createCaptureProcessingRuntime(db);
      const result = await runtime.captureAndProcessBrowserVacancy({ pageUrl: digitalUrl, pageTitle: 'OUTSIDE_TITLE', visibleText: 'OUTSIDE_RAW', html: digital, capturedAt: '2026-11-15T20:00:00Z' });
      expect(result.processing.status).toBe('PROCESSED');
      expect(db.prepare('SELECT provider_namespace,external_id FROM canonical_vacancy_exact_identity_claims').all())
        .toEqual([{ provider_namespace: AIRBUS_WORKDAY_HOST, external_id: 'JR10448154' }]);
    } finally { db.close(); }
  });
});
