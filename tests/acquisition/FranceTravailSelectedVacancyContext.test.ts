import { describe, expect, it } from "vitest";

import { BrowserCaptureAcquisitionAdapter } from "../../src/application/acquisition/BrowserCaptureAcquisitionAdapter.js";
import { FranceTravailSelectedVacancyContextLocator } from "../../src/application/acquisition/FranceTravailSelectedVacancyContextLocator.js";
import { HostnameAcquisitionProviderRecognizer } from "../../src/application/acquisition/HostnameAcquisitionProviderRecognizer.js";
import { DeterministicAcquisitionCaptureMapper } from "../../src/application/acquisition/DeterministicAcquisitionCaptureMapper.js";
import { createAcquisitionPackage } from "../../src/domain/acquisition/AcquisitionPackage.js";

const locator = new FranceTravailSelectedVacancyContextLocator();
const recognizer = new HostnameAcquisitionProviderRecognizer();
const adapter = new BrowserCaptureAcquisitionAdapter();
const mapper = new DeterministicAcquisitionCaptureMapper();

function franceTravailHtml(id: string, detailId = id): string {
  return `
    <main>
      <ul><li data-id-offre="${id}" class="result active seen">
        <h2 data-intitule-offre="${id}">Technicien de maintenance</h2>
      </li></ul>
      <div id="HelpDialog" class="modal in" role="dialog">Aide</div>
      <div id="PopinDetails" class="modal modal-details modal-details-offre in" role="dialog">
        <div class="modal-body">
          <h1>Offre n° ${detailId} Technicien de maintenance</h1>
          <p>Description ciblée pour ${detailId}.</p>
          <a href="/postuler?idOffre=${detailId}&amp;range=0-19">Postuler</a>
        </div>
      </div>
    </main>`;
}

function locate(id: string, html: string, sourceUrl = `https://candidat.francetravail.fr/offres/recherche/detail/${id}`) {
  return locator.locate({
    providerKey: "FRANCE_TRAVAIL",
    sourceUrl,
    externalId: id,
    html,
  });
}

describe("France Travail provider recognition", () => {
  it("recognizes the exact captured hostname without changing source provenance", () => {
    const sourceUrl = "https://candidat.francetravail.fr/offres/recherche/detail/213BBCX";
    expect(recognizer.recognize({ sourceName: "candidat.francetravail.fr", sourceUrl }))
      .toBe("FRANCE_TRAVAIL");
    const acquisition = adapter.toAcquisitionPackage({
      pageUrl: sourceUrl,
      pageTitle: "France Travail",
      visibleText: "Full results page text",
      html: franceTravailHtml("213BBCX"),
      capturedAt: "2026-08-29T05:21:25Z",
    }, "capture-france-travail");
    expect(acquisition.source.sourceName).toBe("candidat.francetravail.fr");
  });

  it.each([
    ["fake-francetravail.fr", "https://fake-francetravail.fr/offres/recherche/detail/213BBCX"],
    ["francetravail.example.com", "https://francetravail.example.com/offres/recherche/detail/213BBCX"],
  ])("does not recognize unsafe lookalike hostname %s", (sourceName, sourceUrl) => {
    expect(recognizer.recognize({ sourceName, sourceUrl })).toBeUndefined();
  });
});

describe("FranceTravailSelectedVacancyContextLocator", () => {
  it.each([
    ["213BBCX", "https://candidat.francetravail.fr/offres/recherche/detail/213BBCX"],
    ["212YVQL", "https://candidat.francetravail.fr/offres/recherche/emploirecherche/detail/212YVQL"],
  ])("validates the supported URL form for %s", (id, sourceUrl) => {
    const context = locate(id, franceTravailHtml(id), sourceUrl);
    expect(context).toMatchObject({
      kind: "SELECTED_VACANCY",
      associationMethod: "PROVIDER_LOCATOR",
      providerKey: "FRANCE_TRAVAIL",
      providerExternalId: id,
      associationEvidence: [
        "URL_EXTERNAL_ID",
        "MATCHING_ACTIVE_RESULT",
        "OPEN_OFFER_DETAIL",
        "DETAIL_EXTERNAL_ID_MATCH",
      ],
    });
    expect(context?.text).toContain(`Offre n° ${id}`);
    expect(context?.html).toContain('id="PopinDetails"');
    expect(context?.html).not.toContain("Full results page text");
  });

  it("fails closed when the matching active result is absent or belongs to another ID", () => {
    expect(locate("213BBCX", franceTravailHtml("213BBCX").replace("active seen", "seen")))
      .toBeUndefined();
    expect(locate("213BBCX", franceTravailHtml("212YCRF"))).toBeUndefined();
  });

  it("rejects a generic open dialog without an open offer-detail modal", () => {
    const html = '<li data-id-offre="213BBCX" class="active"></li><div id="Help" class="modal in">Help</div>';
    expect(locate("213BBCX", html)).toBeUndefined();
  });

  it("rejects a detail modal independently referencing another ID", () => {
    expect(locate("213BBCX", franceTravailHtml("213BBCX", "212YCRF"))).toBeUndefined();
  });

  it("rejects multiple ambiguous open offer-detail contexts", () => {
    const html = franceTravailHtml("213BBCX").replace("</main>", `${franceTravailHtml("213BBCX")}</main>`);
    expect(locate("213BBCX", html)).toBeUndefined();
  });

  it("rejects a URL whose route identity does not match", () => {
    expect(locate(
      "213BBCX",
      franceTravailHtml("213BBCX"),
      "https://candidat.francetravail.fr/offres/recherche?detail=213BBCX",
    )).toBeUndefined();
  });
});

describe("selected-context acquisition integration", () => {
  it("preserves the full snapshot while adding one bounded context", () => {
    const acquisition = adapter.toAcquisitionPackage({
      pageUrl: "https://candidat.francetravail.fr/offres/recherche/detail/213BBCX",
      pageTitle: "Search results",
      visibleText: "FULL PAGE WITH MANY VACANCIES",
      html: franceTravailHtml("213BBCX"),
      capturedAt: "2026-08-29T05:21:25Z",
    }, "capture-213BBCX");
    const observation = mapper.toSourceObservation(acquisition, "observation-213BBCX");

    expect(acquisition.externalId).toBe("213BBCX");
    expect(acquisition.contexts).toHaveLength(1);
    expect(observation.rawContent).toBe("FULL PAGE WITH MANY VACANCIES");
    expect(observation.metadata.acquisition).toMatchObject({ contexts: acquisition.contexts });
    expect(observation).not.toHaveProperty("title");
    expect(observation).not.toHaveProperty("displayedCompanyName");
  });

  it("extracts an ID and invokes selected-context recognition for the emploirecherche route", () => {
    const id = "212YVQL";
    const acquisition = adapter.toAcquisitionPackage({
      pageUrl: `https://candidat.francetravail.fr/offres/recherche/emploirecherche/detail/${id}`,
      pageTitle: "Search results",
      visibleText: "FULL PAGE WITH MANY VACANCIES",
      html: franceTravailHtml(id),
      capturedAt: "2026-08-30T09:44:57Z",
    }, "capture-emploirecherche");

    expect(acquisition.externalId).toBe(id);
    expect(acquisition.contexts?.[0]).toMatchObject({
      kind: "SELECTED_VACANCY",
      providerKey: "FRANCE_TRAVAIL",
      providerExternalId: id,
    });
  });

  it("keeps a manual package valid without browser concepts", () => {
    const acquisition = createAcquisitionPackage({
      acquisitionId: "manual-1",
      acquiredAt: new Date("2026-08-29T10:00:00Z"),
      source: { sourceType: "MANUAL", sourceName: "Manual entry" },
      content: { text: "A vacancy entered by the user" },
      metadata: {},
    });
    expect(acquisition.contexts).toBeUndefined();
    expect(acquisition.externalId).toBeUndefined();
    expect(acquisition.sourceUrl).toBeUndefined();
  });

  it("keeps unknown and not-yet-supported providers valid without contexts", () => {
    for (const pageUrl of [
      "https://example.com/jobs/42",
      "https://www.hellowork.com/fr-fr/emplois/82745536.html",
      "https://www.meteojob.com/jobs/56378291",
      "https://fr.indeed.com/?vjk=73c6c191fddb1427",
      "https://www.linkedin.com/jobs/search-results/?currentJobId=4460344242",
    ]) {
      const acquisition = adapter.toAcquisitionPackage({
        pageUrl,
        pageTitle: "Vacancy",
        visibleText: "Visible vacancy",
        html: "<main><article>Vacancy</article></main>",
        capturedAt: "2026-08-29T10:00:00Z",
      }, `capture-${pageUrl}`);
      expect(acquisition.contexts).toBeUndefined();
    }
  });

  it("succeeds without selected context when HTML is missing", () => {
    const acquisition = adapter.toAcquisitionPackage({
      pageUrl: "https://candidat.francetravail.fr/offres/recherche/detail/213BBCX",
      pageTitle: "Vacancy",
      visibleText: "Full visible page text",
      capturedAt: "2026-08-29T10:00:00Z",
    }, "capture-no-html");
    expect(acquisition.externalId).toBe("213BBCX");
    expect(acquisition.contexts).toBeUndefined();
  });
});
