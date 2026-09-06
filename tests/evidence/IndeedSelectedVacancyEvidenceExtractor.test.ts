import { describe, expect, it } from "vitest";

import { IndeedSelectedVacancyEvidenceExtractor } from "../../src/application/evidence/IndeedSelectedVacancyEvidenceExtractor.js";
import type { SourceObservation } from "../../src/domain/capture/SourceObservation.js";
import { fromSelectedVacancyContext } from "../../src/domain/evidence/VacancyEvidenceInput.js";

const extractor = new IndeedSelectedVacancyEvidenceExtractor();

function selected(html: string, text: string) {
  const observation: SourceObservation = {
    id: "indeed-observation",
    source: { sourceType: "JOB_BOARD", sourceName: "indeed.com" },
    observedAt: new Date("2026-09-06T08:00:00.000Z"),
    metadata: {},
  };
  return fromSelectedVacancyContext(observation, {
    kind: "SELECTED_VACANCY",
    associationMethod: "PROVIDER_LOCATOR",
    providerKey: "INDEED",
    providerExternalId: "cdbdba0dee4cec36",
    text,
    html,
    associationEvidence: ["fixture"],
  });
}

describe("IndeedSelectedVacancyEvidenceExtractor", () => {
  it("extracts semantic title, displayed company, and explicit location", async () => {
    const result = await extractor.extract(selected(`
      <section id="job-full-details">
        <h2 data-testid="jobTitle">Technicien de maintenance H/F - job post</h2>
        <div data-testid="inlineHeader-companyName"><a href="/cmp/eurobrillance?fromjk=cdbdba0dee4cec36">EUROBRILLANCE</a></div>
        <div data-testid="inlineHeader-companyLocation">67120 Altorf</div>
      </section>`, "Job Post Details\nTechnicien de maintenance H/F - job post\nEUROBRILLANCE\n67120 Altorf\nCDI\nTemps plein"));

    expect(result.vacancyTitles.map(({ value }) => value)).toEqual(["Technicien de maintenance H/F"]);
    expect(result.organizations).toEqual([expect.objectContaining({ value: "EUROBRILLANCE", role: "UNKNOWN" })]);
    expect(result.locations).toEqual([expect.objectContaining({ value: "67120 Altorf", role: "WORKPLACE" })]);
    expect(result.organizations).not.toContainEqual(expect.objectContaining({ value: "Job Post Details" }));
  });

  it("uses the narrow postal location fallback and fails closed for partial context", async () => {
    const result = await extractor.extract(selected(
      `<section><h2 class="jobsearch-JobInfoHeader-title">Technicien de maintenance H/F - job post</h2><a href="/cmp/eurobrillance?fromjk=cdbdba0dee4cec36">EUROBRILLANCE</a></section>`,
      "Job Post Details\nTechnicien de maintenance H/F - job post\nEUROBRILLANCE\n67120 Altorf",
    ));
    expect(result.vacancyTitles[0]?.value).toBe("Technicien de maintenance H/F");
    expect(result.locations[0]?.value).toBe("67120 Altorf");

    const malformed = await extractor.extract(selected(
      "<section><h2>Job Post Details</h2><div>EUROBRILLANCE</div></section>",
      "Job Post Details\nEUROBRILLANCE",
    ));
    expect(malformed.vacancyTitles).toEqual([]);
    expect(malformed.organizations).toEqual([]);
    expect(malformed.locations).toEqual([]);
  });

  it("does not promote Indeed displayed company to employer evidence", async () => {
    const result = await extractor.extract(selected(
      `<section><h2 data-testid="jobTitle">Technicien H/F - job post</h2><div data-testid="inlineHeader-companyName">EUROBRILLANCE</div><div data-testid="inlineHeader-companyLocation">67120 Altorf</div></section>`,
      "Technicien H/F\nEUROBRILLANCE\n67120 Altorf",
    ));
    expect(result.organizations[0]).toMatchObject({ value: "EUROBRILLANCE", role: "UNKNOWN" });
    expect(result.organizations).not.toContainEqual(expect.objectContaining({ role: "EMPLOYER" }));
  });
});