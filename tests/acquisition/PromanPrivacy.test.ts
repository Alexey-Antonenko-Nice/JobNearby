import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { BrowserCaptureAcquisitionAdapter } from "../../src/application/acquisition/BrowserCaptureAcquisitionAdapter.js";
import { DeterministicAcquisitionCaptureMapper } from "../../src/application/acquisition/DeterministicAcquisitionCaptureMapper.js";
import { assessBrowserVacancyCapture } from "../../src/application/acquisition/assessBrowserVacancyCapture.js";
import { scopePromanVacancyEvidence } from "../../src/application/evidence/scopePromanVacancyEvidence.js";
import { createVacancyEvidenceExtractor } from "../../src/application/evidence/createVacancyEvidenceExtractor.js";
import { createDatabase } from "../../src/infrastructure/database/createDatabase.js";
import { createCaptureProcessingRuntime } from "../../src/infrastructure/runtime/createCaptureProcessingRuntime.js";
import { SqliteSourceObservationRepository } from "../../src/infrastructure/persistence/SqliteSourceObservationRepository.js";

const pane = readFileSync("tests/fixtures/promanSelectedVacancy.html", "utf8");
const url = "https://mon-espace.proman-emploi.fr/dashboard?offre_id=1197787";
const poison = "PRIVATE_AUDIT_MARKER";
const privateText = `${poison}<p>private@example.invalid</p><p>+33 6 12 34 56 78</p><p>contact recrutement: Private Auditperson</p><p>Nous recrutons pour notre client PRIVATECLIENT.</p><p>Employeur : PRIVATEEMPLOYER</p>`;
const outside = `<aside>${privateText}</aside><article class="vacancy-card" data-offre-id="999">${privateText}</article>`;
const extractor = createVacancyEvidenceExtractor();
function payload(html = pane) {
  return { pageUrl: url + "&session=PRIVATE_AUDIT_MARKER#PRIVATE_AUDIT_MARKER", pageTitle: poison,
    visibleText: poison, html, browserMetadata: { unknown: { account: poison }, cookies: poison }, capturedAt: "2026-11-15T08:00:00Z" };
}
function capture(html = pane) {
  const acquisition = new BrowserCaptureAcquisitionAdapter().toAcquisitionPackage(payload(html), "audit-acquisition");
  const observation = new DeterministicAcquisitionCaptureMapper().toSourceObservation(acquisition, "audit-observation");
  return { acquisition, observation };
}
function inProse(content: string, tab = "poste") {
  return pane.replace(new RegExp(`(x-show="activeTab === '${tab}'">\\s*<div[^>]+>)`, "u"), `$1${content}`);
}
function noPrivate(value: unknown) {
  expect(JSON.stringify(value)).not.toMatch(/PRIVATE|private@example|Auditperson|33 6 12 34 56 78/u);
}
async function redacted(html: string) {
  const { acquisition, observation } = capture(html);
  expect(acquisition.contexts).toBeUndefined();
  expect(acquisition.content.html).toBe("<div></div>");
  expect(acquisition.pageTitle).toBe("PROMAN dashboard");
  noPrivate(observation);
  expect(await assessBrowserVacancyCapture(observation, extractor)).toMatchObject({ captureAcceptedAsVacancy: false });
  const evidence = await extractor.extract(observation);
  expect(evidence.vacancyTitles).toEqual([]);
  expect(evidence.organizations).toEqual([]);
  expect(evidence.people).toEqual([]);
}

describe("PROMAN structural privacy before persistence", () => {
  it("accepts a visible modal with the expected owned fields", async () => {
    const { acquisition, observation } = capture(outside + pane + outside);
    expect(acquisition.contexts).toHaveLength(1);
    expect(await assessBrowserVacancyCapture(observation, extractor)).toMatchObject({ captureAcceptedAsVacancy: true });
    expect(observation.publishedAt).toEqual(new Date("2026-10-06T00:00:00Z"));
    noPrivate(observation);
  });
  it.each([
    'style="visibility:hidden"', 'style="visibility: hidden !important"', 'style="display:none"',
    'hidden', 'aria-hidden="true"', 'aria-hidden="tr&#117;e"', 'x-cloak',
  ])("rejects a hidden dialog: %s", async attr => redacted(pane.replace('role="dialog"', `${attr} role="dialog"`)));
  it.each([
    ['section', 'hidden'], ['aside', 'aria-hidden="true"'], ['span', 'style="visibility:hidden"'],
    ['section', 'style="display:none"'], ['div', 'class="sr-only"'], ['section', 'class="hidden lg:flex"'],
    ['section', 'x-show="isOpen"'], ['section', ':class="accountState"'],
    ['template', ''], ['noscript', ''], ['details', ''], ['form', ''], ['section', 'inert'],
  ])("rejects a hidden/uncertain %s ancestor with %s", async (tag, attrs) => redacted(`<${tag} ${attrs}>${pane}</${tag}>`));
  it.each(["panel-container", "popin-header-nuage", "tab-content px-4"])('rejects hidden required region %s', async cls => {
    await redacted(pane.replace(`class="${cls}`, `hidden class="${cls}`));
  });
  it("rejects a hidden required heading", async () => redacted(pane.replace("<h2 ", "<h2 hidden ")));
  it("rejects a hidden identity link", async () => redacted(pane.replace('<a href="https://www.proman', '<a hidden href="https://www.proman')));
  it("rejects a hidden prose container", async () => redacted(pane.replace('class="text-body-small flex', 'hidden class="text-body-small flex')));
  it.each([
    '<span hidden>private@example.invalid</span>', '<span style="visibility:hidden">+33 6 12 34 56 78</span>',
    `<aside hidden>${privateText}</aside>`, `<section aria-hidden="true">${privateText}</section>`,
    `<div class="vacancy-card">${privateText}</div>`, `<article>${privateText}</article>`,
    `<div role="dialog">${privateText}</div>`, `<div class="widget">${privateText}</div>`,
    `<div>${privateText}</div>`, `<p class="contact-person">${privateText}</p>`,
    `<span data-profile="account">${privateText}</span>`, `<nav>${privateText}</nav>`,
    `<div class="application-state">${privateText}</div>`, `<p aria-label="account">${privateText}</p>`,
  ])("excludes nested private/unrelated subtree %# before mapping and extraction", async content => {
    const { observation } = capture(inProse(content));
    noPrivate(observation);
    const evidence = await extractor.extract(observation);
    noPrivate(evidence);
    expect(evidence.people).toEqual([]);
    expect(evidence.organizations).toEqual((await extractor.extract(capture().observation)).organizations);
  });
  it("excludes private descendants from the profile tab too", async () => noPrivate(capture(inProse(`<aside>${privateText}</aside>`, "profil")).observation));
  it("does not flatten sibling cards outside the owned prose container", async () => {
    noPrivate(capture(pane.replace("activeTab === 'poste'\">", `activeTab === 'poste'\"><div class="vacancy-card">${privateText}</div>`)).observation);
  });
  it("retains legitimate prose without global email/phone deletion", () => {
    const { observation } = capture(inProse('<p>Vacancy contact: public@example.invalid, +33 1 23 45 67 89.</p>'));
    expect(observation.rawContent).toContain("public@example.invalid");
    expect(observation.rawContent).toContain("+33 1 23 45 67 89");
  });
  it("retains legitimate named-client prose but never a nested card client", async () => {
    const evidence = await extractor.extract(capture(inProse('<p>Nous recrutons pour notre client SAFECLIENT.</p><div class="vacancy-card"><p>Nous recrutons pour notre client PRIVATECLIENT.</p></div>')).observation);
    expect(evidence.organizations).toContainEqual(expect.objectContaining({ value: "SAFECLIENT", role: "CLIENT" }));
    noPrivate(evidence);
  });
  it("rejects nested conflicting identity even in excluded hidden content", async () => {
    await redacted(inProse(`<aside hidden data-offre-id="999">${privateText}</aside>`));
  });
  it("rejects a selected panel nested inside an unrelated widget", async () => {
    await redacted(pane.replace('<div class="panel-container', '<article><div class="panel-container').replace(/<\/div>\s*<\/div>\s*$/u, '</div></article></div>'));
  });
  it("excludes unknown inline widgets from title and branch fields", () => {
    const html = pane.replace('Technicien de deploiement', '<span class="unknown-widget">PRIVATE_AUDIT_MARKER</span>Technicien de deploiement')
      .replace('AIX EXPERTISE 2', '<span data-account="private">PRIVATE_AUDIT_MARKER</span>AIX EXPERTISE 2');
    const { acquisition, observation } = capture(html);
    expect(acquisition.contexts).toHaveLength(1);
    noPrivate(observation);
  });
  it("rejects a hidden summary tab", async () => redacted(pane.replace('class="tab-content p-4"', 'hidden class="tab-content p-4"')));
  it("rejects malformed nesting instead of widening the region", async () => redacted(pane.replace("<h2 ", "<section><h2 ")));
  it("maps and persists only sanitized content, including contexts and occurrence URLs", async () => {
    const html = outside + inProse(`<aside hidden>${privateText}</aside><div class="vacancy-card">${privateText}</div>`) + outside;
    const input = payload(html), before = structuredClone(input);
    const db = createDatabase(":memory:");
    try {
      const result = await createCaptureProcessingRuntime(db).captureAndProcessBrowserVacancy(input);
      expect(result.processing.status).toBe("PROCESSED");
      const observation = (await new SqliteSourceObservationRepository(db).findById(result.capture.observationId))!;
      noPrivate(observation);
      expect(observation.source.sourceUrl).toBe(url);
      const a = observation.metadata.acquisition as Record<string, any>;
      expect(a.pageTitle).toBe(observation.title);
      expect(a.metadata).toEqual({ vacancyEvidenceScope: "SELECTED_VACANCY_REQUIRED" });
      expect(Object.keys(a).sort()).toEqual(["acquisitionId", "contexts", "html", "metadata", "pageTitle"]);
      expect(a.contexts).toHaveLength(1);
      expect(a.html).toBe(a.contexts[0].html);
      expect(observation.rawContent).toBe(a.contexts[0].text);
      expect(a.html).not.toMatch(/aside|article|vacancy-card|wire:|data-profile/u);
      expect(db.prepare("SELECT captured_url FROM capture_occurrences").all()).toEqual([{ captured_url: url }]);
      noPrivate(db.prepare("SELECT * FROM source_observations").all());
      expect(input).toEqual(before);
    } finally { db.close(); }
  });
});

describe("PROMAN transient evidence allowlist", () => {
  it.each([true, false])("drops legacy metadata and all page-level poison, context present=%s", async withContext => {
    const { observation } = capture();
    const a = observation.metadata.acquisition as Record<string, any>;
    const dirty = { ...observation, title: poison, displayedCompanyName: poison, locationText: poison,
      description: privateText, contractText: poison, salaryText: poison, contactText: privateText, rawContent: privateText,
      source: { ...observation.source, providerMetadata: { account: poison } },
      metadata: { account: poison, acquisition: { ...a, ...(withContext ? {} : { contexts: undefined, html: "" }),
        pageTitle: poison, unknown: privateText, text: privateText, structuredPayload: { jobPostings: [{ title: poison }] }, metadata: { unknown: privateText } } } };
    const before = structuredClone(dirty), scoped = scopePromanVacancyEvidence(dirty);
    noPrivate(scoped);
    expect(Object.keys(scoped.metadata)).toEqual(["acquisition"]);
    expect(Object.keys(scoped.metadata.acquisition as object).sort()).toEqual(["contexts", "html", "metadata"]);
    expect(scoped.contactText).toBeUndefined();
    expect(scoped.title).toBeUndefined();
    expect(scoped.description).toBeUndefined();
    expect(scoped.source.providerMetadata).toBeUndefined();
    if (!withContext) expect(scoped.rawContent).toBe("");
    noPrivate(await extractor.extract(dirty));
    expect(dirty).toEqual(before);
  });
  it("uses validated stored content without reading dashboard-wide acquisition HTML", () => {
    const { observation } = capture();
    const a = observation.metadata.acquisition as Record<string, any>;
    const scoped = scopePromanVacancyEvidence({ ...observation, metadata: { acquisition: { ...a, html: outside + pane, pageTitle: poison } } });
    noPrivate(scoped);
    expect(scoped.rawContent).toBe(a.contexts[0].text);
  });
  it("re-locates only exact sanitized HTML when no stored context exists", () => {
    const { observation } = capture();
    const a = observation.metadata.acquisition as Record<string, any>;
    const scoped = scopePromanVacancyEvidence({ ...observation, metadata: { acquisition: { html: a.html } } });
    expect(scoped.rawContent).toBe(a.contexts[0].text);
  });
  it.each([
    { text: privateText }, { html: pane }, { providerExternalId: "999" }, { providerKey: "OTHER" },
    { kind: "PAGE" }, { associationMethod: "UNKNOWN" }, { associationEvidence: [] }, { metadata: { private: poison } },
  ])("rejects malformed/untrusted stored context %# without fallback", async patch => {
    const { observation } = capture();
    const a = observation.metadata.acquisition as Record<string, any>;
    const dirty = { ...observation, metadata: { acquisition: { ...a, contexts: [{ ...a.contexts[0], ...patch }] } } };
    const scoped = scopePromanVacancyEvidence(dirty);
    expect(scoped.rawContent).toBe("");
    noPrivate(scoped);
    expect((await extractor.extract(dirty)).vacancyTitles).toEqual([]);
  });
  it.each([[], [null], "invalid", [null, null]])("rejects malformed context collection %#", contexts => {
    const { observation } = capture();
    const a = observation.metadata.acquisition as object;
    expect(scopePromanVacancyEvidence({ ...observation, metadata: { acquisition: { ...a, contexts } } }).rawContent).toBe("");
  });
  it.each([outside + pane, pane, "", "<div></div>"])("fails closed on unsanitized/missing legacy HTML %#", async html => {
    const { observation } = capture();
    const old = { ...observation, rawContent: privateText, metadata: { acquisition: { html, pageTitle: poison } } };
    const before = structuredClone(old), scoped = scopePromanVacancyEvidence(old);
    expect(scoped.rawContent).toBe("");
    noPrivate(scoped);
    expect((await extractor.extract(old)).organizations).toEqual([]);
    expect(old).toEqual(before);
  });
  it("is idempotent and does not mutate input or trusted stored context", () => {
    const { observation } = capture(), before = structuredClone(observation);
    const once = scopePromanVacancyEvidence(observation);
    expect(scopePromanVacancyEvidence(once)).toEqual(once);
    expect(observation).toEqual(before);
  });
});
