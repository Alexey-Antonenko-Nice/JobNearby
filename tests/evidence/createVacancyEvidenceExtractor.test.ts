import { describe, expect, it } from "vitest";

import { createVacancyEvidenceExtractor } from "../../src/application/evidence/createVacancyEvidenceExtractor.js";
import type { SourceObservation } from "../../src/domain/capture/SourceObservation.js";
import { fromSourceObservation } from "../../src/domain/evidence/VacancyEvidenceInput.js";

const workdayHtml = `<div data-automation-id="headerTitle">Air Products Careers</div><h2 data-automation-id="jobPostingHeader">Maintenance Planner Germany (m/w/d)</h2><ul data-automation-id="subtitle"><li>Hattingen, Germany; Strasbourg, France</li><li>JR-2026-21408</li></ul><div data-automation-id="timeType">Full time</div>`;
const observation: SourceObservation = {
  id: "workday-observation",
  source: {
    sourceType: "BROWSER_CAPTURE",
    sourceName: "airproducts.wd5.myworkdayjobs.com",
    sourceUrl: "https://airproducts.wd5.myworkdayjobs.com/fr-FR/AP0001/details/Maintenance-Planner-Germany_JR-2026-21408",
    externalId: "JR-2026-21408",
  },
  observedAt: new Date("2026-09-06T12:00:00Z"),
  title: "Maintenance Planner Germany (m/w/d)",
  displayedCompanyName: "Air Products",
  contractText: "Full time",
  rawContent: "Maintenance Planner Germany (m/w/d)\nHattingen, Germany; Strasbourg, France\nFull time",
  metadata: { acquisition: { html: workdayHtml } },
};

describe("shared vacancy evidence extractor composition", () => {
  it("keeps production and diagnostic reconstruction evidence collections identical", async () => {
    const productionEvidence = await createVacancyEvidenceExtractor().extract(fromSourceObservation(observation));
    const diagnosticEvidence = await createVacancyEvidenceExtractor().extract(fromSourceObservation(observation));
    expect(diagnosticEvidence).toEqual(productionEvidence);
    expect(diagnosticEvidence.locations.map(({ value }) => value)).toEqual([
      "Hattingen, Germany", "Strasbourg, France",
    ]);
    expect(diagnosticEvidence.externalIdentifiers).toEqual([
      expect.objectContaining({ value: "JR-2026-21408", provider: "airproducts.wd5.myworkdayjobs.com" }),
    ]);
    expect(diagnosticEvidence.organizations).toEqual(expect.arrayContaining([
      expect.objectContaining({ value: "Air Products", role: "UNKNOWN" }),
    ]));
  });
});
