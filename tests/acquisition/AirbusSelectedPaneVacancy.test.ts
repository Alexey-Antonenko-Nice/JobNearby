import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
const { JSDOM } = require("jsdom");
import { BrowserCaptureAcquisitionAdapter } from "../../src/application/acquisition/BrowserCaptureAcquisitionAdapter.js";
import { DeterministicAcquisitionCaptureMapper } from "../../src/application/acquisition/DeterministicAcquisitionCaptureMapper.js";
import { assessBrowserVacancyCapture } from "../../src/application/acquisition/assessBrowserVacancyCapture.js";
import { createVacancyEvidenceExtractor } from "../../src/application/evidence/createVacancyEvidenceExtractor.js";
import { scopeAirbusSelectedPaneVacancyEvidence } from "../../src/application/evidence/scopeAirbusSelectedPaneVacancyEvidence.js";
import { createDatabase } from "../../src/infrastructure/database/createDatabase.js";
import { createCaptureProcessingRuntime } from "../../src/infrastructure/runtime/createCaptureProcessingRuntime.js";

const q = (id: string) => `[data-automation-id="${id}"]`;
const selected = q('jobResults') + ' ' + q('jobTitle') + '[aria-current="true"]';
const pane = q('jobDetails');
const cases = [
  { name: 'Manufacturing', id: 'JR10457309', url: 'https://ag.wd3.myworkdayjobs.com/en-US/Airbus/details/Manufacturing-Engineer-II--Process-Engineer-_JR10457309' },
  { name: 'Internship', id: 'JR10447012', url: 'https://ag.wd3.myworkdayjobs.com/fr-FR/Airbus/details/STAGE-2027---Controle-de-Gestion-Industriel_JR10447012?locationCountry=54c5b6971ffb4bf0b116fe7651ec789a' },
  { name: 'Painter', id: 'JR10439155', url: 'https://ag.wd3.myworkdayjobs.com/en-US/Airbus/details/Aircraft-painter_JR10439155-1' },
].map(c => ({ ...c, html: readFileSync(`tests/fixtures/airbusSelected${c.name}.html`, 'utf8') }));
const painter = cases[2]!, extractor = createVacancyEvidenceExtractor();
function change(html: string, edit: (doc: Document) => void) { const dom = new JSDOM(html); try { edit(dom.window.document); return dom.serialize(); } finally { dom.window.close(); } }
function capture(html = painter.html, url = painter.url) {
  const acquisition = new BrowserCaptureAcquisitionAdapter().toAcquisitionPackage({ pageUrl: url, pageTitle: 'OUTSIDE_TITLE', visibleText: 'Employeur : OUTSIDE_RAW', html, capturedAt: '2026-11-16T07:00:00Z' }, 'a');
  return { acquisition, observation: new DeterministicAcquisitionCaptureMapper().toSourceObservation(acquisition, 'o') };
}
async function rejected(html: string, url = painter.url) {
  const { acquisition, observation } = capture(html, url);
  expect(Boolean(acquisition.contexts)).toBe(false); expect(acquisition.externalId).toBeUndefined();
  expect(await assessBrowserVacancyCapture(observation, extractor)).toMatchObject({ captureAcceptedAsVacancy: false });
  const evidence = await extractor.extract(observation);
  expect(evidence.vacancyTitles).toEqual([]); expect(evidence.organizations).toEqual([]); expect(evidence.people).toEqual([]);
}
function replaceHref(doc: Document, selector: string) { const a = doc.querySelector(selector)!; a.setAttribute('href', a.getAttribute('href')!.replace(/JR\d+/u, 'JR999')); }

describe('Airbus selected details boundary', () => {
  it.each(cases)('accepts real $name through acquisition, evidence and processing', async c => {
    const { acquisition, observation } = capture(c.html, c.url);
    expect(acquisition.source.sourceName).toBe('ag.wd3.myworkdayjobs.com'); expect(acquisition.externalId).toBe(c.id);
    expect(acquisition.contexts).toHaveLength(1);
    expect(acquisition.contexts![0]!.associationEvidence).toContain('ARIA_CURRENT_RESULT_CARD');
    expect(acquisition.contexts![0]!.html).not.toMatch(/jobResults|similar-jobs-heading|sidebar|jobSearchPage/);
    expect(observation.displayedCompanyName).toBeUndefined();
    const acceptance = await assessBrowserVacancyCapture(observation, extractor);
    expect(acceptance.captureAcceptedAsVacancy).toBe(true); expect(acceptance).not.toHaveProperty('partialRecaptureIdentity');
    expect((await extractor.extract(observation)).vacancyTitles.length).toBeGreaterThan(0);
    const db = createDatabase(':memory:');
    try {
      const result = await createCaptureProcessingRuntime(db).captureAndProcessBrowserVacancy({ pageUrl: c.url, html: c.html, pageTitle: 'OUTSIDE_TITLE', visibleText: 'OUTSIDE_RAW', capturedAt: '2026-11-16T07:00:00Z' });
      expect(result.processing.status).toBe('PROCESSED');
      expect(db.prepare('SELECT provider_namespace,external_id FROM canonical_vacancy_exact_identity_claims').all()).toEqual([{ provider_namespace: 'ag.wd3.myworkdayjobs.com', external_id: c.id }]);
    } finally { db.close(); }
  });
  it.each([
    { name: 'pane JR mismatch', edit: (d: Document) => { d.querySelector(pane + ' ' + q('requisitionId') + ' dd')!.textContent = 'JR999'; } },
    { name: 'selected card JR mismatch', edit: (d: Document) => replaceHref(d, selected) },
    { name: 'card and pane agree but differ from route', edit: (d: Document) => { replaceHref(d, selected); d.querySelector(pane + ' ' + q('requisitionId') + ' dd')!.textContent = 'JR999'; } },
    { name: 'selected subtitle conflicts', edit: (d: Document) => { d.querySelector(selected)!.closest('li')!.querySelector(q('subtitle'))!.textContent = 'JR999'; } },
    { name: 'missing selected state', edit: (d: Document) => d.querySelector(selected)!.setAttribute('aria-current', 'false') },
    { name: 'two selected cards', edit: (d: Document) => {
      const card = d.querySelector(selected)!.closest('li')!;
      const duplicate = card.cloneNode(true) as HTMLLIElement;
      duplicate.querySelector(q('jobTitle'))!.setAttribute('aria-current', 'true');
      d.querySelector(q('jobResults') + ' ul')!.append(duplicate);
    } },
    { name: 'two details panes', edit: (d: Document) => { const e = d.querySelector(pane)!; e.after(e.cloneNode(true)); } },
    { name: 'hidden details', edit: (d: Document) => d.querySelector(pane)!.setAttribute('hidden', '') },
    { name: 'hidden details ancestor', edit: (d: Document) => d.querySelector(pane)!.parentElement!.setAttribute('style', 'visibility:hidden') },
    { name: 'hidden selected card', edit: (d: Document) => d.querySelector(selected)!.closest('li')!.setAttribute('aria-hidden', 'true') },
    { name: 'apply mismatch', edit: (d: Document) => replaceHref(d, pane + ' ' + q('adventureButton')) },
    { name: 'missing apply', edit: (d: Document) => d.querySelector(pane + ' ' + q('adventureButton'))!.remove() },
    { name: 'missing description', edit: (d: Document) => d.querySelector(q('jobPostingDescription'))!.remove() },
    { name: 'ambiguous header', edit: (d: Document) => { const e = d.querySelector(q('jobPostingHeader'))!; e.after(e.cloneNode(true)); } },
    { name: 'unproven sticky state', edit: (d: Document) => d.querySelector(pane)!.insertAdjacentHTML('beforeend', '<div data-automation-id="jobPostingStickyWrapper">Unproven</div>') },
    { name: 'owned structured ID conflict', edit: (d: Document) => d.querySelector(q('jobPostingDescription'))!.parentElement!.insertAdjacentHTML('beforeend', '<script type="application/ld+json">{"@type":"JobPosting","identifier":{"value":"JR999"}}</script>') },
  ])('rejects $name', async ({ edit }) => rejected(change(painter.html, edit)));
  it.each(['/Airbus', '/en-US/Airbus', '/en-US/Other/details/Aircraft-painter_JR10439155', '/en-US/Airbus/details/Aircraft-painter_JR10439155-2'])('rejects unsupported route %s', async path => rejected(painter.html, 'https://ag.wd3.myworkdayjobs.com' + path));
  it.each(['/Airbus/', '/airbus/', '/en-US/Airbus/'])('supports selected tenant grammar %s', async prefix => {
    expect(capture(painter.html, 'https://ag.wd3.myworkdayjobs.com' + prefix + 'details/Aircraft-painter_JR10439155-1?ignored=1#fragment').acquisition.externalId).toBe(painter.id);
  });
  it('excludes recommendation and result-list poison, including differing JR signals', async () => {
    const html = change(painter.html, d => {
      const recommendation = d.querySelector(q('similar-jobs-heading'))!.closest('section')!;
      recommendation.insertAdjacentHTML('beforeend', '<div data-automation-id="requisitionId"><dd>JR999</dd></div><div data-automation-id="company"><dd>OUTSIDE_RECOMMENDATION_COMPANY</dd></div><p>Employeur : OUTSIDE_EMPLOYER. 99 years experience.</p>');
      for (const n of recommendation.querySelectorAll(q('jobTitle') + ',' + q('locations') + ',' + q('time'))) n.textContent = 'OUTSIDE_RECOMMENDATION';
      for (const a of d.querySelectorAll(q('jobResults') + ' ' + q('jobTitle') + '[aria-current="false"]')) {
        const li = a.closest('li')!; li.innerHTML = '<a data-automation-id="jobTitle" aria-current="false" href="/Airbus/job/Paris/Other_JR888">OUTSIDE_RESULT_TITLE</a><div data-automation-id="locations">OUTSIDE_LOCATION</div><div data-automation-id="time">OUTSIDE_TIME</div><div data-automation-id="company">OUTSIDE_COMPANY</div>';
      }
    });
    const { acquisition, observation } = capture(html);
    expect(acquisition.externalId).toBe(painter.id);
    expect(await assessBrowserVacancyCapture(observation, extractor)).toMatchObject({ captureAcceptedAsVacancy: true });
    expect(JSON.stringify(acquisition.contexts)).not.toMatch(/OUTSIDE_|JR999|JR888|99 years/);
    expect(JSON.stringify(await extractor.extract(observation))).not.toMatch(/OUTSIDE_|JR999|JR888|99 years/);
  });
  it('ignores page-global JSON-LD and strips structured/page metadata poison', async () => {
    const html = change(painter.html, d => d.head.insertAdjacentHTML('beforeend', '<script type="application/ld+json">{"@type":"JobPosting","identifier":{"value":"JR999"},"title":"OUTSIDE_TITLE"}</script>'));
    const { observation } = capture(html);
    const poisoned = { ...observation, title: 'OUTSIDE_TITLE', displayedCompanyName: 'OUTSIDE_COMPANY', rawContent: 'OUTSIDE_RAW', contactText: 'OUTSIDE_PERSON', metadata: { ...observation.metadata, unknown: 'OUTSIDE_META', acquisition: { ...observation.metadata.acquisition as object, structuredPayload: { title: 'OUTSIDE_JSON' } } } };
    expect(JSON.stringify(await extractor.extract(poisoned))).not.toContain('OUTSIDE_');
    expect(scopeAirbusSelectedPaneVacancyEvidence(poisoned).title).toBe('Aircraft painter');
  });
  it('uses an explicitly owned company field only', () => {
    const html = change(painter.html, d => d.querySelector(q('requisitionId'))!.parentElement!.insertAdjacentHTML('beforeend', '<div data-automation-id="company"><dl><dd>OWNED_COMPANY</dd></dl></div>'));
    expect(capture(html).observation.displayedCompanyName).toBe('OWNED_COMPANY');
  });
  it('uses the selected description Company label and excludes sidebar company poison', async () => {
    const company = 'Airbus (Tianjin) Final Assembly Company Limited';
    const html = change(painter.html, d => {
      const label = [...d.querySelectorAll(pane + ' ' + q('jobPostingDescription') + ' p')].find(p => p.textContent?.trim() === 'Company:')!;
      label.innerHTML = `<span><b>Company:</b> ${company}</span>`;
      d.querySelector(q('sidebar'))!.insertAdjacentHTML('beforeend', '<div data-automation-id="company"><dl><dd>SIDEBAR_COMPANY_POISON</dd></dl></div>');
    });
    const { acquisition, observation } = capture(html);
    expect(observation.displayedCompanyName).toBe(company);
    expect(JSON.stringify(acquisition.contexts)).not.toContain('SIDEBAR_COMPANY_POISON');
    const evidence = await extractor.extract(observation);
    expect(evidence.organizations).toContainEqual(expect.objectContaining({ value: company, role: 'UNKNOWN' }));
    expect(JSON.stringify(evidence)).not.toContain('SIDEBAR_COMPANY_POISON');
  });
  it('does not use a sidebar Company field when the selected description has no value', () => {
    const html = change(painter.html, d => d.querySelector(q('sidebar'))!.insertAdjacentHTML('beforeend', '<div data-automation-id="company"><dl><dd>SIDEBAR_COMPANY_POISON</dd></dl></div>'));
    const { acquisition, observation } = capture(html);
    expect(observation.displayedCompanyName).toBeUndefined();
    expect(JSON.stringify(acquisition.contexts)).not.toContain('SIDEBAR_COMPANY_POISON');
  });
  it('rejects stale context and is immutable and idempotent', () => {
    const { observation } = capture(), before = structuredClone(observation);
    const scoped = scopeAirbusSelectedPaneVacancyEvidence(observation);
    expect(scoped.title).toBe('Aircraft painter'); expect(scopeAirbusSelectedPaneVacancyEvidence(scoped)).toEqual(scoped);
    expect(observation).toEqual(before);
    expect(scopeAirbusSelectedPaneVacancyEvidence({ ...observation, source: { ...observation.source, externalId: "JR999" } }).title).toBeUndefined();
    const a = observation.metadata.acquisition as { contexts: any[] };
    const stale = { ...observation, metadata: { acquisition: { ...a, contexts: [{ ...a.contexts[0], text: 'STALE' }] } } };
    expect(scopeAirbusSelectedPaneVacancyEvidence(stale).title).toBeUndefined();
    expect(scopeAirbusSelectedPaneVacancyEvidence({ ...observation, metadata: {} }).title).toBeUndefined();
  });
});
