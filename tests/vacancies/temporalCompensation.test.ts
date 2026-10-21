import { describe, expect, it } from "vitest";
import type { SourceObservation } from "../../src/domain/capture/SourceObservation.js";
import type { VacancyCompensation } from "../../src/domain/vacancies/CanonicalVacancy.js";
import { createExtractedVacancyEvidence } from "../../src/domain/evidence/ExtractedVacancyEvidence.js";
import { ExistingPipelineCanonicalVacancyAdapter } from "../../src/application/vacancies/ExistingPipelineCanonicalVacancyAdapter.js";
import { DeterministicCanonicalVacancyCanonicalizer } from "../../src/application/vacancies/DeterministicCanonicalVacancyCanonicalizer.js";
import { resolveTemporalCompensationEvidence } from "../../src/application/vacancies/resolveTemporalCompensationEvidence.js";

const derivation = { algorithm: "test", algorithmVersion: "1", derivedAt: new Date("2026-10-21T12:00:00Z") };
const adapter = new ExistingPipelineCanonicalVacancyAdapter(new DeterministicCanonicalVacancyCanonicalizer());
const hourly = { rawText: "13 € / heure", currency: "EUR", minimum: 13, period: "HOUR" as const };
const annual = { rawText: "32 000 - 36 000 € / an", currency: "EUR", minimum: 32000, maximum: 36000, period: "YEAR" as const };
function observation(id: string, day: number, overrides: Partial<SourceObservation> = {}): SourceObservation {
  const item: SourceObservation = { id, source: { sourceType: "BROWSER_CAPTURE", sourceName: "hellowork.com", externalId: "84500085", sourceUrl: "https://www.hellowork.com/fr-fr/emplois/84500085.html" },
    observedAt: new Date(Date.UTC(2026, 9, day)), title: "Technicien de maintenance H/F", metadata: {}, ...overrides };
  // Preserve this policy fixture's explicit structured fields behind the provider scope guard.
  return { ...item, metadata: { acquisition: { html: `<script type="application/ld+json">${JSON.stringify({ "@type": "JobPosting", url: "https://www.hellowork.com/fr-fr/emplois/84500085.html", title: item.title, baseSalary: item.salaryText })}</script>` } } };
}
function evidence(id: string, values: readonly VacancyCompensation[]) {
  return createExtractedVacancyEvidence({ sourceObservationId: id, compensations: values.map((value) => ({ ...value,
    rawText: value.rawText!, provenance: { sourceObservationId: id, extractionMethod: "TEXT_EXTRACTION", confidence: 1 } })) });
}
function project(observations: SourceObservation[], values: readonly (readonly VacancyCompensation[])[]) {
  const input = { canonicalVacancyId: "same-canonical", observations,
    extractedEvidence: observations.map((item, index) => evidence(item.id, values[index]!)), derivation };
  return { canonical: adapter.canonicalize(input), built: adapter.buildCanonicalizeInput(input) };
}

describe("temporal compensation projection", () => {
  it("resolves one explicit salary and reconciles its structured single-amount representation", () => {
    const { canonical } = project([observation("a", 19, { salaryText: "13,00 EUR / HOUR" })], [[hourly]]);
    expect(canonical.compensation).toMatchObject({ status: "RESOLVED", value: { minimum: 13, currency: "EUR", period: "HOUR" } });
  });

  it("supersedes older hourly evidence with a later explicit annual range, retaining all source references", () => {
    const old = observation("a", 19);
    const newer = observation("b", 21);
    const before = structuredClone([old, newer]);
    const { canonical, built } = project([old, newer], [[hourly], [annual]]);
    expect(canonical.compensation).toMatchObject({ status: "RESOLVED", value: annual });
    expect(canonical.canonicalizationStatus).toBe("USABLE");
    expect(canonical.sourceObservationIds).toEqual(["a", "b"]);
    expect(built.compensationHistory).toEqual([expect.objectContaining({ sourceObservationId: "a", observedAt: old.observedAt, values: [hourly] })]);
    const current = new Set(canonical.compensation.supportingEvidenceIds);
    expect(canonical.evidenceReferences.filter((item) => current.has(item.id)).every((item) => item.sourceObservationId === "b")).toBe(true);
    expect(canonical.evidenceReferences.some((item) => item.kind === "VACANCY_COMPENSATION_EVIDENCE" && item.sourceObservationId === "a")).toBe(true);
    expect([old, newer]).toEqual(before);
  });

  it("keeps the latest explicit value when newer snapshots omit compensation", () => {
    const { canonical, built } = project([observation("a", 19), observation("missing", 21)], [[hourly], []]);
    expect(canonical.compensation).toMatchObject({ status: "RESOLVED", value: hourly });
    expect(built.compensationHistory).toEqual([]);
  });

  it("selects the third explicit salary and does not mistake input order for time", () => {
    const third = { ...annual, rawText: "40 000 - 42 000 € / an", minimum: 40000, maximum: 42000 };
    const { canonical, built } = project([observation("c", 23), observation("a", 19), observation("b", 21)], [[third], [hourly], [annual]]);
    expect(canonical.compensation.value).toEqual(third);
    expect(built.compensationHistory.map((entry) => entry.sourceObservationId)).toEqual(["b", "a"]);
  });

  it("retains incompatible salaries within the latest snapshot as a true current conflict", () => {
    const { canonical } = project([observation("a", 19), observation("b", 21)], [[hourly], [
      { ...annual, rawText: "50k/year", minimum: 50000, maximum: 50000 },
      { ...annual, rawText: "65k/year", minimum: 65000, maximum: 65000 },
    ]]);
    expect(canonical.compensation.status).toBe("CONFLICTED");
    expect(canonical.compensation.alternatives).toHaveLength(2);
    expect(canonical.compensation.alternatives?.some(({ value }) => value.period === "HOUR")).toBe(false);
  });

  it("does not use observation ID or array order to choose among equally recent conflicting snapshots", () => {
    for (const reversed of [false, true]) {
      const observations = [observation("first", 21), observation("last", 21)];
      const values = [[hourly], [annual]];
      const { canonical } = project(reversed ? observations.reverse() : observations, reversed ? values.reverse() : values);
      expect(canonical.compensation.status).toBe("CONFLICTED");
    }
  });

  it.each([
    { sourceType: "BROWSER_CAPTURE" as const, sourceName: "indeed.com", externalId: "84500085" },
    { sourceType: "BROWSER_CAPTURE" as const, sourceName: "hellowork.com", externalId: "another-id" },
    { sourceType: "BROWSER_CAPTURE" as const, sourceName: "hellowork.com" },
  ])("does not infer temporal authority for unrelated or missing identity: %j", (source) => {
    const { canonical, built } = project([observation("a", 19), observation("b", 21, { source })], [[hourly], [annual]]);
    expect(canonical.compensation.status).toBe("CONFLICTED");
    expect(built.compensationHistory).toEqual([]);
  });

  it("keeps existing multi-source semantics even if a third provider snapshot has no salary", () => {
    const { canonical } = project([observation("a", 19), observation("b", 21), observation("third", 22, {
      source: { sourceType: "BROWSER_CAPTURE", sourceName: "indeed.com", externalId: "other" },
    })], [[hourly], [annual], []]);
    expect(canonical.compensation.status).toBe("CONFLICTED");
  });

  it("uses existing provider namespace normalization without changing external IDs", () => {
    const { canonical } = project([observation("a", 19), observation("b", 21, {
      source: { sourceType: "BROWSER_CAPTURE", sourceName: " HelloWork.COM ", externalId: "84500085" },
    })], [[hourly], [annual]]);
    expect(canonical.compensation.value).toEqual(annual);
  });

  it("does not generalize temporal supersession to role or other fields", () => {
    const { canonical } = project([observation("a", 19), observation("b", 21, { title: "Different role" })], [[hourly], [annual]]);
    expect(canonical.compensation.status).toBe("RESOLVED");
    expect(canonical.role.status).toBe("CONFLICTED");
    expect(canonical.canonicalizationStatus).toBe("CONFLICTED");
  });

  it("does not mask a latest-snapshot structured hourly salary versus annual recommendation conflict", () => {
    const { canonical } = project([observation("a", 19), observation("b", 21, { salaryText: "13,00 EUR / HOUR" })], [[hourly], [annual]]);
    expect(canonical.compensation.status).toBe("CONFLICTED");
    expect(canonical.compensation.alternatives?.map(({ value }) => value.period).sort()).toEqual(["HOUR", "YEAR"]);
  });

  it("fails conservatively if provenance cannot be linked to one claimed snapshot", () => {
    const candidates = [{ value: annual, supportingEvidenceIds: ["missing"] }];
    expect(resolveTemporalCompensationEvidence([observation("a", 19)], candidates, []).current).toBe(candidates);
  });
});
