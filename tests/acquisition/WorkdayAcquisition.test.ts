import { describe, expect, it } from "vitest";

import { BrowserCaptureAcquisitionAdapter } from "../../src/application/acquisition/BrowserCaptureAcquisitionAdapter.js";
import { DeterministicAcquisitionCaptureMapper } from "../../src/application/acquisition/DeterministicAcquisitionCaptureMapper.js";
import { createDatabase } from "../../src/infrastructure/database/createDatabase.js";
import { createCaptureProcessingRuntime } from "../../src/infrastructure/runtime/createCaptureProcessingRuntime.js";

const adapter = new BrowserCaptureAcquisitionAdapter();
const mapper = new DeterministicAcquisitionCaptureMapper();
const url = "https://airproducts.wd5.myworkdayjobs.com/fr-FR/AP0001/details/Chauffeur-SPL-ADR--H-F-_JR-2026-21864?locationCountry=54c5b6971ffb4bf0b116fe7651ec789a";
const html = `<div data-automation-id="headerTitle">Air Products Careers</div><div data-automation-id="jobPostingHeader"><div data-automation-id="jobTitle">Chauffeur SPL ADR (H/F)</div><div data-automation-id="subtitle">Rouen</div></div><div data-automation-id="timeType">Full time</div><div data-automation-id="requisitionId">JR-2026-21864</div><div data-automation-id="jobPostingDescription">Taux horaire = 13,50€</div>`;
const multiLocationUrl = "https://airproducts.wd5.myworkdayjobs.com/fr-FR/AP0001/details/Chauffeur-SPL-CITERNE-H-F_JR-2026-21869?locationCountry=54c5b6971ffb4bf0b116fe7651ec789a";
const multiLocationHtml = `<div data-automation-id="headerTitle">Air Products Careers</div><h2 data-automation-id="jobPostingHeader">Chauffeur SPL CITERNE H/F</h2><ul data-automation-id="subtitle"><li>Strasbourg, France; Beinheim, France; Reichstett, France; Schiltigheim, France</li><li>JR-2026-21869</li><li>Chauffeur SPL CITERNE H/F</li></ul><div data-automation-id="timeType">Full time</div>`;

function capture(pageUrl = url, content = html, id = "observation") {
  const acquisition = adapter.toAcquisitionPackage({ pageUrl, pageTitle: "Workday", visibleText: "Chauffeur SPL ADR (H/F)\nRouen\nFull time\nAir Products", capturedAt: "2026-09-06T12:00:00Z", html: content }, `acquisition-${id}`);
  return { acquisition, observation: mapper.toSourceObservation(acquisition, id) };
}

describe("generic Workday acquisition", () => {
  it("extracts stable identity and core fields", () => {
    const { acquisition, observation } = capture();
    expect(acquisition.externalId).toBe("JR-2026-21864");
    expect(observation.source.externalId).toBe("JR-2026-21864");
    expect(observation.title).toBe("Chauffeur SPL ADR (H/F)");
    expect(observation.locationText).toBe("Rouen");
    expect(observation.contractText).toBe("Full time");
    expect(observation.displayedCompanyName).toBe("Air Products");
  });

  it("extracts the live multi-location Workday variant", () => {
    const { acquisition, observation } = capture(multiLocationUrl, multiLocationHtml, "multi");
    expect(acquisition.externalId).toBe("JR-2026-21869");
    expect(observation.title).toBe("Chauffeur SPL CITERNE H/F");
    expect(observation.contractText).toBe("Full time");
    expect(observation.locationText).toBeUndefined();
  });

  it("keeps query strings/fragments stable and rejects non-detail routes", () => {
    expect(capture(`${url}&foo=bar#details`).acquisition.externalId).toBe("JR-2026-21864");
    expect(capture("https://airproducts.wd5.myworkdayjobs.com/fr-FR/AP0001/jobs").acquisition.externalId).toBeUndefined();
    expect(capture("https://notworkday.example.com/fr-FR/AP0001/details/x_JR-2026-21864").acquisition.externalId).toBeUndefined();
    expect(capture("https://airproducts.wd5.myworkdayjobs.com/fr-FR/AP0001/details/Chauffeur-SPL-ADR--H-F_").acquisition.externalId).toBeUndefined();
  });

  it("keeps different requisitions distinct", () => {
    expect(capture(url.replace("JR-2026-21864", "JR-2026-21865")).acquisition.externalId).toBe("JR-2026-21865");
  });

  it("converges unchanged and changed captures through the existing pipeline", async () => {
    const db = createDatabase(":memory:");
    try {
      const runtime = createCaptureProcessingRuntime(db);
      const first = await runtime.captureAndProcessBrowserVacancy({ pageUrl: url, pageTitle: "Workday", visibleText: "Chauffeur SPL ADR (H/F)\nRouen\nFull time\nAir Products", capturedAt: "2026-09-06T12:00:00Z", html });
      const second = await runtime.captureAndProcessBrowserVacancy({ pageUrl: url, pageTitle: "Workday", visibleText: "Chauffeur SPL ADR (H/F)\nRouen\nFull time\nAir Products", capturedAt: "2026-09-06T12:01:00Z", html });
      const changed = await runtime.captureAndProcessBrowserVacancy({ pageUrl: url, pageTitle: "Workday", visibleText: "Changed Workday vacancy\nRouen\nFull time\nAir Products", capturedAt: "2026-09-06T12:02:00Z", html });
      expect(first.processing.status).toBe("PROCESSED"); expect(second.processing.status).toBe("PROCESSED"); expect(changed.processing.status).toBe("PROCESSED");
      if (first.processing.status !== "PROCESSED" || second.processing.status !== "PROCESSED" || changed.processing.status !== "PROCESSED") throw new Error("Expected processing to succeed.");
      expect(second.processing.canonicalVacancyId).toBe(first.processing.canonicalVacancyId);
      expect(changed.processing.canonicalVacancyId).toBe(first.processing.canonicalVacancyId);
      expect(db.prepare("SELECT COUNT(*) AS count FROM source_observations").get()).toEqual({ count: 2 });
      expect(db.prepare("SELECT COUNT(*) AS count FROM capture_occurrences").get()).toEqual({ count: 3 });
      expect(db.prepare("SELECT COUNT(*) AS count FROM canonical_vacancies").get()).toEqual({ count: 1 });
      expect(db.prepare("SELECT field_name, status, value_json FROM canonical_vacancy_fields WHERE canonical_vacancy_id = ? AND field_name IN ('role','location','engagement') ORDER BY field_name").all(first.processing.canonicalVacancyId)).toEqual([
        { field_name: "engagement", status: "RESOLVED", value_json: JSON.stringify({ rawTerms: ["Full time"], normalizedTerms: ["FULL_TIME"] }) },
        { field_name: "location", status: "RESOLVED", value_json: JSON.stringify({ rawText: "Rouen" }) },
        { field_name: "role", status: "RESOLVED", value_json: JSON.stringify({ title: "Chauffeur SPL ADR (H/F)" }) },
      ]);
    } finally { db.close(); }
  });

  it("preserves all live multi-location workplace evidence and resolves core fields", async () => {
    const db = createDatabase(":memory:");
    try {
      const runtime = createCaptureProcessingRuntime(db);
      const result = await runtime.captureAndProcessBrowserVacancy({ pageUrl: multiLocationUrl, pageTitle: "Workday", visibleText: "Chauffeur SPL CITERNE H/F\nStrasbourg, France\nFull time\nAir Products", capturedAt: "2026-09-06T12:00:00Z", html: multiLocationHtml });
      expect(result.processing.status).toBe("PROCESSED");
      if (result.processing.status !== "PROCESSED") throw new Error("Expected processing to succeed.");
      const fields = db.prepare("SELECT field_name, status, value_json FROM canonical_vacancy_fields WHERE canonical_vacancy_id = ?").all(result.processing.canonicalVacancyId) as Array<{ field_name: string; status: string; value_json: string | null }>;
      expect(fields.find(({ field_name }) => field_name === "role")).toMatchObject({ status: "RESOLVED", value_json: JSON.stringify({ title: "Chauffeur SPL CITERNE H/F" }) });
      expect(fields.find(({ field_name }) => field_name === "engagement")).toMatchObject({ status: "RESOLVED" });
      expect(fields.find(({ field_name }) => field_name === "location")).toMatchObject({ status: "CONFLICTED" });
      const evidence = db.prepare("SELECT COUNT(*) AS count FROM canonical_vacancy_evidence_references WHERE canonical_vacancy_id = ? AND kind = 'LOCATION_EVIDENCE'").get(result.processing.canonicalVacancyId) as { count: number };
      expect(evidence.count).toBe(4);
    } finally { db.close(); }
  });
});