import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { BrowserCaptureAcquisitionAdapter } from "../../src/application/acquisition/BrowserCaptureAcquisitionAdapter.js";
import { DeterministicAcquisitionCaptureMapper } from "../../src/application/acquisition/DeterministicAcquisitionCaptureMapper.js";
import { createVacancyEvidenceExtractor } from "../../src/application/evidence/createVacancyEvidenceExtractor.js";
import { scopeFranceTravailVacancyEvidence } from "../../src/application/evidence/scopeFranceTravailVacancyEvidence.js";
import { scopeProviderVacancyEvidence } from "../../src/application/evidence/scopeProviderVacancyEvidence.js";
import type { AcquisitionContext } from "../../src/domain/acquisition/AcquisitionContext.js";
import type { SourceObservation } from "../../src/domain/capture/SourceObservation.js";
import { normalizeVacancyEvidenceInput } from "../../src/domain/evidence/VacancyEvidenceInput.js";

const adapter = new BrowserCaptureAcquisitionAdapter();
const mapper = new DeterministicAcquisitionCaptureMapper();
const POISON = /POISON|Neighbor Title|Neighbor Co|Neighbor City|NEIGHBOR-CDD|neighbor@example/iu;
const PROOF = ["URL_EXTERNAL_ID", "MATCHING_ACTIVE_RESULT", "OPEN_OFFER_DETAIL", "DETAIL_EXTERNAL_ID_MATCH"];

function load(base: string) {
  const meta = JSON.parse(readFileSync(`${base}.meta.json`, "utf8")) as { pageUrl: string; pageTitle: string };
  return { ...meta, html: readFileSync(`${base}.html`, "utf8"), visibleText: readFileSync(`${base}.visible.txt`, "utf8") };
}
const real = load("tests/fixtures/franceTravailRenderedDetail");
const unrendered = load("tests/fixtures/franceTravailUnrenderedDetail");

function capture(page: { pageUrl: string; pageTitle: string; visibleText: string }, html: string | undefined) {
  const acquisition = adapter.toAcquisitionPackage({ ...page, ...(html === undefined ? {} : { html }), capturedAt: "2026-10-25T06:26:23.702Z" }, "acquisition");
  return { acquisition, observation: mapper.toSourceObservation(acquisition, "observation") };
}

function poisoned(observation: SourceObservation): SourceObservation {
  const acquisition = observation.metadata.acquisition as Record<string, unknown>;
  return {
    ...observation,
    title: "POISON Neighbor Title",
    displayedCompanyName: "POISON Neighbor Co",
    locationText: "POISON Neighbor City",
    contractText: "POISON NEIGHBOR-CDD",
    description: "POISON neighbor description",
    contactText: "POISON neighbor@example.test",
    rawContent: "POISON Neighbor Title at Neighbor Co in Neighbor City NEIGHBOR-CDD",
    metadata: {
      ...observation.metadata,
      acquisition: {
        ...acquisition,
        structuredPayload: { format: "SCHEMA_ORG_JOB_POSTING_JSON_LD", jobPostings: [{
          title: "POISON Neighbor Title", hiringOrganization: { name: "POISON Neighbor Co" }, jobLocation: { address: { addressLocality: "POISON Neighbor City" } },
        }] },
      },
    },
  };
}

function synthetic(id: string, detail = id, modalClass = "modal modal-details modal-details-offre in") {
  return `<main><ul><li data-id-offre="${id}" class="result active"><h2>Technicien de maintenance</h2></li></ul>
    <div id="PopinDetails" class="${modalClass}" role="dialog"><div class="modal-body">
      <h1>Offre n° ${detail} Technicien de maintenance</h1><p>Description ciblée pour ${detail}.</p>
      <a href="/postuler?idOffre=${detail}&amp;range=0-19">Postuler</a></div></div></main>`;
}
const syntheticPage = (id: string) => ({ pageUrl: `https://candidat.francetravail.fr/offres/recherche/detail/${id}`, pageTitle: "Results", visibleText: "Visible page" });

async function evidenceOf(observation: SourceObservation) {
  return createVacancyEvidenceExtractor().extract(observation);
}

describe("France Travail bounded evidence scope", () => {
  it("restores no page-level fields and no contactText, and uses no projection", async () => {
    const { observation } = capture(real, real.html);
    const input = poisoned(observation);
    const scoped = normalizeVacancyEvidenceInput(scopeFranceTravailVacancyEvidence(input));
    for (const field of ["title", "displayedCompanyName", "locationText", "salaryText", "contractText", "description", "contactText", "publishedAt"] as const) {
      expect(scoped[field]).toBeUndefined();
    }
    expect(scoped.evidenceContent).toMatchObject({ kind: "SELECTED_VACANCY_CONTEXT", context: { providerKey: "FRANCE_TRAVAIL", providerExternalId: "213CWRC" } });
    expect(scoped.rawContent).toBe(scoped.evidenceContent.kind === "SELECTED_VACANCY_CONTEXT" ? scoped.evidenceContent.context.text : undefined);
    expect(scoped.rawContent).not.toMatch(POISON);
    expect((scoped.metadata.acquisition as Record<string, unknown>).structuredPayload).toBeUndefined();
    expect(JSON.stringify(scoped)).not.toMatch(POISON);
  });

  it("ignores poisoned page-level values during extraction", async () => {
    const evidence = await evidenceOf(poisoned(capture(real, real.html).observation));
    expect(JSON.stringify(evidence)).not.toMatch(POISON);
    expect(evidence.vacancyTitles.map(v => v.value)).toEqual(["Vendeur-Concepteur en Aménagement Intérieur H/F"]);
    expect(evidence.organizations).toEqual([expect.objectContaining({ value: "MOBALPA", role: "DISPLAYED_COMPANY" })]);
  });

  it("keeps selected-modal evidence when page JSON-LD describes a different vacancy", async () => {
    const jsonLd = `<script type="application/ld+json">${JSON.stringify({
      "@context": "https://schema.org", "@type": "JobPosting", title: "POISON Neighbor Title",
      hiringOrganization: { "@type": "Organization", name: "POISON Neighbor Co" },
      jobLocation: { "@type": "Place", address: { "@type": "PostalAddress", addressLocality: "POISON Neighbor City" } },
      employmentType: "NEIGHBOR-CDD", description: "POISON neighbor description",
    })}</script>`;
    const html = real.html.replace(/<body[^>]*>/iu, match => match + jsonLd);
    expect(html).toContain("POISON Neighbor Title");
    const { acquisition, observation } = capture(real, html);
    expect(acquisition.structuredFields).toBeUndefined();
    expect(observation.title).toBeUndefined();
    expect(acquisition.content.structuredPayload).toBeUndefined();
    const evidence = await evidenceOf(observation);
    expect(JSON.stringify(evidence)).not.toMatch(POISON);
    expect(evidence.vacancyTitles.map(v => v.value)).toEqual(["Vendeur-Concepteur en Aménagement Intérieur H/F"]);
    expect(evidence.organizations).toEqual([expect.objectContaining({ value: "MOBALPA" })]);
    expect(evidence.compensations[0]).toMatchObject({ minimum: 24000, maximum: 55000, period: "YEAR" });
  });

  it("preserves existing rendered-fixture evidence through the bounded path", async () => {
    const { observation } = capture(real, real.html);
    const evidence = await evidenceOf(observation);
    expect(evidence.vacancyTitles.map(v => v.value)).toEqual(["Vendeur-Concepteur en Aménagement Intérieur H/F"]);
    expect(evidence.locations.map(l => l.value).join("|")).toMatch(/OSTWALD/u);
    expect(evidence.engagements.flatMap(e => e.normalizedTerms)).toContain("INDEFINITE");
    expect(evidence.compensations).toHaveLength(1);
    expect(evidence.compensations[0]).toMatchObject({ currency: "EUR", minimum: 24000, maximum: 55000, period: "YEAR" });
    expect(evidence.organizations).toEqual([expect.objectContaining({ value: "MOBALPA", role: "DISPLAYED_COMPANY" })]);
    for (const item of [...evidence.vacancyTitles, ...evidence.locations, ...evidence.compensations, ...evidence.organizations]) {
      expect(item.provenance.contentOrigin).toBe("SELECTED_VACANCY_CONTEXT");
    }
  });

  it("scopes the unrendered fixture to its pane-header context only", async () => {
    const { acquisition, observation } = capture(unrendered, unrendered.html);
    const scoped = normalizeVacancyEvidenceInput(scopeFranceTravailVacancyEvidence(poisoned(observation)));
    expect(scoped.evidenceContent).toMatchObject({ kind: "SELECTED_VACANCY_CONTEXT" });
    expect(scoped.rawContent).toBe(acquisition.contexts![0]!.text);
    expect(JSON.stringify(await evidenceOf(poisoned(observation)))).not.toMatch(POISON);
  });

  it("reuses a valid stored context without re-running the locator on partial HTML", () => {
    const { observation } = capture(real, real.html);
    const acquisition = observation.metadata.acquisition as Record<string, unknown>;
    const stored = (acquisition.contexts as AcquisitionContext[])[0]!;
    const partial = { ...observation, metadata: { ...observation.metadata, acquisition: { ...acquisition, html: "<div>partial</div>" } } };
    const scoped = normalizeVacancyEvidenceInput(scopeFranceTravailVacancyEvidence(partial));
    expect(scoped.evidenceContent).toMatchObject({ kind: "SELECTED_VACANCY_CONTEXT", context: { text: stored.text } });
  });

  it("re-locates from stored HTML when no context is stored, requiring the existing proof", () => {
    const { observation } = capture(real, real.html);
    const acquisition = { ...(observation.metadata.acquisition as Record<string, unknown>) };
    delete acquisition.contexts;
    const scoped = normalizeVacancyEvidenceInput(scopeFranceTravailVacancyEvidence({ ...observation, metadata: { ...observation.metadata, acquisition } }));
    expect(scoped.evidenceContent.kind).toBe("SELECTED_VACANCY_CONTEXT");
    if (scoped.evidenceContent.kind === "SELECTED_VACANCY_CONTEXT") {
      expect(scoped.evidenceContent.context.associationEvidence).toEqual(PROOF);
    }
  });

  describe("fails closed without whole-page recovery", () => {
    function expectClosed(input: SourceObservation) {
      const scoped = normalizeVacancyEvidenceInput(scopeFranceTravailVacancyEvidence(input));
      expect(scoped.evidenceContent).toEqual({ kind: "SOURCE_OBSERVATION" });
      for (const field of ["title", "displayedCompanyName", "locationText", "salaryText", "contractText", "description", "contactText", "rawContent"] as const) {
        expect(scoped[field]).toBeUndefined();
      }
      expect(scoped.metadata.acquisition).toBeUndefined();
      expect(JSON.stringify(scoped)).not.toMatch(POISON);
    }
    async function expectNoEvidence(input: SourceObservation) {
      const evidence = await evidenceOf(input);
      expect(evidence.vacancyTitles).toEqual([]);
      expect(evidence.organizations).toEqual([]);
      expect(evidence.locations).toEqual([]);
      expect(evidence.compensations).toEqual([]);
      expect(JSON.stringify(evidence)).not.toMatch(POISON);
    }
    const id = "213BBCX";
    const valid = () => capture(syntheticPage(id), synthetic(id)).observation;
    const withContext = (mutate: (context: AcquisitionContext) => Record<string, unknown>) => {
      const observation = valid();
      const acquisition = observation.metadata.acquisition as Record<string, unknown>;
      const context = (acquisition.contexts as AcquisitionContext[])[0]!;
      return poisoned({ ...observation, metadata: { ...observation.metadata, acquisition: { ...acquisition, contexts: [{ ...context, ...mutate(context) }] } } });
    };

    it("accepts the synthetic baseline so the failures below are meaningful", () => {
      expect(normalizeVacancyEvidenceInput(scopeFranceTravailVacancyEvidence(poisoned(valid()))).evidenceContent.kind).toBe("SELECTED_VACANCY_CONTEXT");
    });

    it("ignores a stored context of another provider and uses only the located France Travail context", () => {
      const scoped = normalizeVacancyEvidenceInput(scopeFranceTravailVacancyEvidence(withContext(() => ({ providerKey: "LINKEDIN" }))));
      expect(scoped.evidenceContent).toMatchObject({ kind: "SELECTED_VACANCY_CONTEXT", context: { providerKey: "FRANCE_TRAVAIL", providerExternalId: id } });
      expect(JSON.stringify(scoped)).not.toMatch(POISON);
    });

    it.each([
      ["no stored HTML or context", () => poisoned(capture(syntheticPage(id), undefined).observation)],
      ["no open PopinDetails", () => poisoned(capture(syntheticPage(id), synthetic(id, id, "modal modal-details modal-details-offre")).observation)],
      ["multiple open detail modals", () => poisoned(capture(syntheticPage(id), synthetic(id).replace("</main>", `${synthetic(id)}</main>`)).observation)],
      ["missing independent in-modal ID reference", () => poisoned(capture(syntheticPage(id), synthetic(id, "212YCRF")).observation)],
      ["no matching active result", () => poisoned(capture(syntheticPage(id), synthetic(id).replace("result active", "result")).observation)],
      ["neighboring-offer context only", () => poisoned(capture(syntheticPage(id), synthetic("212YCRF")).observation)],
      ["stored context with a different providerExternalId", () => withContext(() => ({ providerExternalId: "212YCRF" }))],
      ["stored context missing proof markers", () => withContext(() => ({ associationEvidence: ["URL_EXTERNAL_ID"] }))],
      ["stored context with a non-locator association", () => withContext(() => ({ associationMethod: "MANUAL" }))],
      ["source external ID disagreeing with the URL", () => {
        const observation = valid();
        return poisoned({ ...observation, source: { ...observation.source, externalId: "212YCRF" } });
      }],
      ["source URL for another ID", () => {
        const observation = valid();
        return poisoned({ ...observation, source: { ...observation.source, sourceUrl: "https://candidat.francetravail.fr/offres/recherche/detail/212YCRF" } });
      }],
      ["missing source external ID", () => {
        const observation = valid();
        const { externalId: _id, ...source } = observation.source;
        return poisoned({ ...observation, source });
      }],
    ])("%s", async (_label, build) => {
      const input = build();
      expectClosed(input);
      await expectNoEvidence(input);
    });
  });

  it("does not mutate its input", () => {
    const input = poisoned(capture(real, real.html).observation);
    const before = structuredClone(input);
    scopeFranceTravailVacancyEvidence(input);
    expect(input).toEqual(before);
  });

  it("returns non-France Travail input unchanged", () => {
    const { observation } = capture(real, real.html);
    const other = { ...observation, source: { ...observation.source, sourceName: "example.com" } };
    expect(scopeFranceTravailVacancyEvidence(other)).toBe(other);
  });

  it("routes France Travail through its own scope, not the Indeed catch-all", () => {
    const input = poisoned(capture(real, real.html).observation);
    const scoped = normalizeVacancyEvidenceInput(scopeProviderVacancyEvidence(input));
    expect(scoped).not.toBe(input);
    expect(scoped.title).toBeUndefined();
    expect(scoped.contactText).toBeUndefined();
    expect(scoped.evidenceContent).toMatchObject({ kind: "SELECTED_VACANCY_CONTEXT", context: { providerKey: "FRANCE_TRAVAIL" } });
    expect(scoped.rawContent).not.toMatch(POISON);
  });
});
