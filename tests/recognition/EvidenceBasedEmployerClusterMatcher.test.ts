import { describe, expect, it } from "vitest";

import type { SourceObservation } from "../../src/domain/capture/SourceObservation.js";
import type { EmployerCharacteristicEvidence } from "../../src/domain/evidence/EmployerCharacteristicEvidence.js";
import type { ExtractedVacancyEvidence } from "../../src/domain/evidence/ExtractedVacancyEvidence.js";
import type { VacancyEvidenceExtractor } from "../../src/domain/evidence/VacancyEvidenceExtractor.js";
import type { EmployerCluster } from "../../src/domain/recognition/EmployerCluster.js";
import { createExtractedVacancyEvidence } from "../../src/domain/evidence/ExtractedVacancyEvidence.js";
import { decideEmployerClusterAssignment } from "../../src/domain/recognition/decideEmployerClusterAssignment.js";
import { EvidenceBasedEmployerClusterMatcher } from "../../src/application/recognition/EvidenceBasedEmployerClusterMatcher.js";
import { InMemoryEmployerClusterObservationProvider } from "../../src/infrastructure/persistence/InMemoryEmployerClusterObservationProvider.js";

function observation(id: string): SourceObservation {
  return {
    id,
    source: { sourceType: "MANUAL", sourceName: "test" },
    observedAt: new Date("2026-08-23T00:00:00.000Z"),
    metadata: {},
  };
}

function cluster(id: string): EmployerCluster {
  return {
    id,
    status: "UNRESOLVED",
    createdAt: new Date("2026-08-23T00:00:00.000Z"),
    updatedAt: new Date("2026-08-23T00:00:00.000Z"),
  };
}

interface EvidenceFixture {
  employer?: string;
  intermediary?: string;
  displayedLocation?: string;
  workplace?: string;
  characteristics?: readonly Omit<EmployerCharacteristicEvidence, "provenance">[];
}

function evidence(id: string, fixture: EvidenceFixture): ExtractedVacancyEvidence {
  const provenance = {
    sourceObservationId: id,
    extractionMethod: "TEXT_EXTRACTION" as const,
    confidence: 0.98,
  };
  return createExtractedVacancyEvidence({
    sourceObservationId: id,
    organizations: [
      ...(fixture.employer === undefined
        ? []
        : [{ value: fixture.employer, role: "EMPLOYER" as const, provenance }]),
      ...(fixture.intermediary === undefined
        ? []
        : [
            {
              value: fixture.intermediary,
              role: "RECRUITMENT_AGENCY" as const,
              provenance,
            },
          ]),
    ],
    locations: [
      ...(fixture.displayedLocation === undefined
        ? []
        : [
            {
              value: fixture.displayedLocation,
              role: "DISPLAYED_LOCATION" as const,
              provenance,
            },
          ]),
      ...(fixture.workplace === undefined
        ? []
        : [{ value: fixture.workplace, role: "WORKPLACE" as const, provenance }]),
    ],
    employerCharacteristics: (fixture.characteristics ?? []).map((item) => ({
      ...item,
      provenance,
    })),
  });
}

function controlledExtractor(
  evidenceByObservation: ReadonlyMap<string, ExtractedVacancyEvidence>,
  extractedIds: string[] = [],
): VacancyEvidenceExtractor {
  return {
    async extract(input) {
      extractedIds.push(input.id);
      const result = evidenceByObservation.get(input.id);
      if (result === undefined) throw new Error(`Missing evidence for ${input.id}`);
      return result;
    },
  };
}

const robopac = {
  value: "ROBOPAC distributor",
  category: "DISTINCTIVE_FACT" as const,
  specificity: "VERY_HIGH" as const,
};

describe("EvidenceBasedEmployerClusterMatcher", () => {
  it("returns null for empty candidates without extracting evidence", async () => {
    const extractedIds: string[] = [];
    const matcher = new EvidenceBasedEmployerClusterMatcher({
      evidenceExtractor: controlledExtractor(new Map(), extractedIds),
      observationProvider: new InMemoryEmployerClusterObservationProvider(),
    });

    await expect(matcher.findBestMatch(observation("new"), [])).resolves.toBeNull();
    expect(extractedIds).toEqual([]);
  });

  it("skips candidates without history and returns null when none have history", async () => {
    const extractedIds: string[] = [];
    const matcher = new EvidenceBasedEmployerClusterMatcher({
      evidenceExtractor: controlledExtractor(new Map(), extractedIds),
      observationProvider: new InMemoryEmployerClusterObservationProvider(),
    });

    await expect(
      matcher.findBestMatch(observation("new"), [cluster("empty")]),
    ).resolves.toBeNull();
    expect(extractedIds).toEqual([]);
  });

  it("skips an empty candidate while evaluating a later candidate with history", async () => {
    const provider = new InMemoryEmployerClusterObservationProvider();
    provider.addObservation("populated", observation("history"));
    const matcher = new EvidenceBasedEmployerClusterMatcher({
      evidenceExtractor: controlledExtractor(
        new Map([
          ["new", evidence("new", { employer: "ACME" })],
          ["history", evidence("history", { employer: "ACME" })],
        ]),
      ),
      observationProvider: provider,
    });

    await expect(
      matcher.findBestMatch(observation("new"), [
        cluster("empty"),
        cluster("populated"),
      ]),
    ).resolves.toMatchObject({ cluster: { id: "populated" } });
  });

  it("returns the existing pipeline confidence and provenance for one history item", async () => {
    const history = observation("history-loxam");
    const provider = new InMemoryEmployerClusterObservationProvider();
    provider.addObservation("cluster-loxam", history);
    const matcher = new EvidenceBasedEmployerClusterMatcher({
      evidenceExtractor: controlledExtractor(
        new Map([
          ["new", evidence("new", { employer: "LOXAM" })],
          [history.id, evidence(history.id, { employer: "loxam" })],
        ]),
      ),
      observationProvider: provider,
    });

    const result = await matcher.findBestMatch(observation("new"), [cluster("cluster-loxam")]);
    expect(result).toMatchObject({
      cluster: { id: "cluster-loxam" },
      confidence: 0.95,
      matchedObservationId: history.id,
      assessment: { identity: { assessment: "VERY_STRONG_POSITIVE" } },
    });
    expect(result?.comparison.positiveSignals[0]?.leftEvidence).toMatchObject({
      value: "LOXAM",
    });
  });

  it("keeps the strongest historical observation instead of averaging", async () => {
    const histories = [observation("history-030"), observation("history-091"), observation("history-048")];
    const provider = new InMemoryEmployerClusterObservationProvider();
    histories.forEach((item) => provider.addObservation("cluster-a", item));
    const evidenceMap = new Map<string, ExtractedVacancyEvidence>([
      ["new", evidence("new", { intermediary: "ACTUA", displayedLocation: "Strasbourg", workplace: "Molsheim", characteristics: [robopac] })],
      ["history-030", evidence("history-030", { intermediary: "ACTUA", displayedLocation: "Strasbourg" })],
      ["history-091", evidence("history-091", { workplace: "Molsheim", characteristics: [robopac] })],
      ["history-048", evidence("history-048", { intermediary: "ACTUA", workplace: "Molsheim" })],
    ]);
    const matcher = new EvidenceBasedEmployerClusterMatcher({
      evidenceExtractor: controlledExtractor(evidenceMap),
      observationProvider: provider,
    });

    await expect(
      matcher.findBestMatch(observation("new"), [cluster("cluster-a")]),
    ).resolves.toMatchObject({
      confidence: 0.91,
      matchedObservationId: "history-091",
    });
  });

  it("chooses the cluster with the strongest historical match", async () => {
    const provider = new InMemoryEmployerClusterObservationProvider();
    provider.addObservation("cluster-weak", observation("weak"));
    provider.addObservation("cluster-strong", observation("strong"));
    const matcher = new EvidenceBasedEmployerClusterMatcher({
      evidenceExtractor: controlledExtractor(
        new Map([
          ["new", evidence("new", { employer: "HEUFT France" })],
          ["weak", evidence("weak", { displayedLocation: "Strasbourg" })],
          ["strong", evidence("strong", { employer: "HEUFT France" })],
        ]),
      ),
      observationProvider: provider,
    });
    await expect(
      matcher.findBestMatch(observation("new"), [cluster("cluster-weak"), cluster("cluster-strong")]),
    ).resolves.toMatchObject({ cluster: { id: "cluster-strong" }, confidence: 0.95 });
  });

  it("highly matches an anonymous distinctive fingerprint with geography", async () => {
    const provider = new InMemoryEmployerClusterObservationProvider();
    provider.addObservation("packaging", observation("packaging-history"));
    const matcher = new EvidenceBasedEmployerClusterMatcher({
      evidenceExtractor: controlledExtractor(
        new Map([
          ["new", evidence("new", { workplace: "Molsheim", characteristics: [robopac] })],
          ["packaging-history", evidence("packaging-history", { workplace: "Molsheim", characteristics: [robopac] })],
        ]),
      ),
      observationProvider: provider,
    });
    await expect(
      matcher.findBestMatch(observation("new"), [cluster("packaging")]),
    ).resolves.toMatchObject({ confidence: 0.91 });
  });

  it("keeps incompatible explicit identity and industry confidence low", async () => {
    const provider = new InMemoryEmployerClusterObservationProvider();
    provider.addObservation("weyersheim", observation("concrete-history"));
    const matcher = new EvidenceBasedEmployerClusterMatcher({
      evidenceExtractor: controlledExtractor(
        new Map([
          ["new", evidence("new", { employer: "Food Company", workplace: "Weyersheim", characteristics: [{ value: "food manufacturing", category: "INDUSTRY", specificity: "MEDIUM" }] })],
          ["concrete-history", evidence("concrete-history", { employer: "Concrete Company", workplace: "Weyersheim", characteristics: [{ value: "concrete manufacturing", category: "INDUSTRY", specificity: "MEDIUM" }] })],
        ]),
      ),
      observationProvider: provider,
    });
    await expect(
      matcher.findBestMatch(observation("new"), [cluster("weyersheim")]),
    ).resolves.toMatchObject({ confidence: 0.02 });
  });

  it("preserves candidate order and historical order on ties", async () => {
    const provider = new InMemoryEmployerClusterObservationProvider();
    provider.addObservation("first", observation("first-history"));
    provider.addObservation("first", observation("second-history-same-cluster"));
    provider.addObservation("second", observation("second-cluster-history"));
    const entries = ["new", "first-history", "second-history-same-cluster", "second-cluster-history"].map(
      (id) => [id, evidence(id, { employer: "ACME" })] as const,
    );
    const matcher = new EvidenceBasedEmployerClusterMatcher({
      evidenceExtractor: controlledExtractor(new Map(entries)),
      observationProvider: provider,
    });

    await expect(
      matcher.findBestMatch(observation("new"), [cluster("first"), cluster("second")]),
    ).resolves.toMatchObject({
      cluster: { id: "first" },
      matchedObservationId: "first-history",
      confidence: 0.95,
    });
  });

  it("does not mutate inputs and remains independent from assignment policy", async () => {
    const current = observation("new");
    const historical = observation("history");
    const candidate = cluster("cluster-a");
    const provider = new InMemoryEmployerClusterObservationProvider();
    provider.addObservation(candidate.id, historical);
    const currentEvidence = evidence(current.id, { employer: "ACME" });
    const historicalEvidence = evidence(historical.id, { employer: "ACME" });
    const matcher = new EvidenceBasedEmployerClusterMatcher({
      evidenceExtractor: controlledExtractor(
        new Map([
          [current.id, currentEvidence],
          [historical.id, historicalEvidence],
        ]),
      ),
      observationProvider: provider,
    });
    const snapshot = JSON.stringify({
      current,
      historical,
      candidate,
      currentEvidence,
      historicalEvidence,
    });

    const first = await matcher.findBestMatch(current, [candidate]);
    const second = await matcher.findBestMatch(current, [candidate]);

    expect(first?.confidence).toBe(second?.confidence);
    expect(
      JSON.stringify({
        current,
        historical,
        candidate,
        currentEvidence,
        historicalEvidence,
      }),
    ).toBe(snapshot);
    expect(
      decideEmployerClusterAssignment(first, {
        automaticAssignmentThreshold: 0.9,
        reviewThreshold: 0.65,
      }).outcome,
    ).toBe("AUTO_MATCH");
    expect(
      decideEmployerClusterAssignment(first, {
        automaticAssignmentThreshold: 0.99,
        reviewThreshold: 0.9,
      }).outcome,
    ).toBe("REVIEW_REQUIRED");
    expect(first?.confidence).toBe(0.95);
  });
});
