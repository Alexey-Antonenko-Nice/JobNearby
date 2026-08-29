import { describe, expect, it, vi } from "vitest";

import { ExistingPipelineCanonicalVacancyAdapter } from "../../src/application/vacancies/ExistingPipelineCanonicalVacancyAdapter.js";
import { DeterministicCanonicalVacancyCanonicalizer } from "../../src/application/vacancies/DeterministicCanonicalVacancyCanonicalizer.js";
import {
  CanonicalVacancyIntegrityError,
  SourceObservationNotFoundError,
  processVacancyObservation,
} from "../../src/application/vacancies/processVacancyObservation.js";
import type { SourceObservation } from "../../src/domain/capture/SourceObservation.js";
import { createExtractedVacancyEvidence } from "../../src/domain/evidence/ExtractedVacancyEvidence.js";
import type { EmployerCluster } from "../../src/domain/recognition/EmployerCluster.js";
import type { ObservationClusterAssignment } from "../../src/domain/recognition/ObservationClusterAssignment.js";
import { InMemoryCanonicalVacancyRepository } from "../../src/infrastructure/persistence/InMemoryCanonicalVacancyRepository.js";
import { InMemoryEmployerClusterRepository } from "../../src/infrastructure/persistence/InMemoryEmployerClusterRepository.js";
import { InMemoryEmployerRecognitionPersistence } from "../../src/infrastructure/persistence/InMemoryEmployerRecognitionPersistence.js";
import { InMemoryObservationClusterAssignmentRepository } from "../../src/infrastructure/persistence/InMemoryObservationClusterAssignmentRepository.js";
import { InMemorySourceObservationRepository } from "../../src/infrastructure/persistence/InMemorySourceObservationRepository.js";

const at = new Date("2026-08-29T14:00:00.000Z");

describe("processVacancyObservation", () => {
  it("rejects an unknown observation before side effects", async () => {
    const fixture = makeFixture();
    await expect(
      processVacancyObservation("missing", fixture.dependencies),
    ).rejects.toBeInstanceOf(SourceObservationNotFoundError);
    expect(fixture.generateCanonicalVacancyId).not.toHaveBeenCalled();
    expect(fixture.processEmployerObservation).not.toHaveBeenCalled();
  });

  it("creates a canonical vacancy and reports deterministic processing metadata", async () => {
    const fixture = makeFixture();
    await fixture.sources.save(observation("obs-a", "EXT-1", "First title"));
    const result = await processVacancyObservation("obs-a", fixture.dependencies);
    expect(result).toEqual({
      sourceObservationId: "obs-a",
      canonicalVacancyId: "canonical-generated",
      canonicalVacancyOutcome: "CREATED",
      observationAdded: true,
      canonicalizationStatus: "USABLE",
      employer: {
        outcome: "CREATED_NEW_CLUSTER",
        employerClusterId: "cluster-default",
        employerClusterStatus: "UNRESOLVED",
      },
    });
    expect((await fixture.canonicals.findById("canonical-generated"))?.derivation)
      .toEqual({
        algorithm: "process-vacancy-observation",
        algorithmVersion: "0.1.0",
        derivedAt: at,
      });
  });

  it("retries the same observation with the same canonical ID and no duplicate membership", async () => {
    const fixture = makeFixture();
    await fixture.sources.save(observation("obs-a", "EXT-1", "First title"));
    await processVacancyObservation("obs-a", fixture.dependencies);
    const result = await processVacancyObservation("obs-a", fixture.dependencies);
    expect(result.canonicalVacancyId).toBe("canonical-generated");
    expect(result.canonicalVacancyOutcome).toBe("UPDATED_EXISTING");
    expect(result.observationAdded).toBe(false);
    expect((await fixture.canonicals.findById("canonical-generated"))?.sourceObservationIds)
      .toEqual(["obs-a"]);
  });

  it("reuses an observation claim without an external ID", async () => {
    const fixture = makeFixture();
    await fixture.sources.save(observation("anonymous", undefined, "Anonymous"));
    const first = await processVacancyObservation("anonymous", fixture.dependencies);
    const second = await processVacancyObservation("anonymous", fixture.dependencies);
    expect(second.canonicalVacancyId).toBe(first.canonicalVacancyId);
    expect(second.canonicalVacancyOutcome).toBe("UPDATED_EXISTING");
  });

  it("adds a second exact-identity observation and rebuilds evidence for complete history", async () => {
    const fixture = makeFixture();
    await fixture.sources.save(observation("obs-a", "SAME", "Old title"));
    await fixture.sources.save(observation("obs-b", "SAME", "New title"));
    await processVacancyObservation("obs-a", fixture.dependencies);
    fixture.extractor.extract.mockClear();
    const result = await processVacancyObservation("obs-b", fixture.dependencies);
    expect(result.canonicalVacancyId).toBe("canonical-generated");
    expect(result.observationAdded).toBe(true);
    const canonical = await fixture.canonicals.findById("canonical-generated");
    expect(canonical?.sourceObservationIds).toEqual(["obs-a", "obs-b"]);
    expect(fixture.extractor.extract.mock.calls.map(([item]) => item.id))
      .toEqual(["obs-a", "obs-b"]);
    expect(canonical?.evidenceReferences).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourceObservationId: "obs-a", kind: "SOURCE_TITLE" }),
      expect.objectContaining({ sourceObservationId: "obs-b", kind: "SOURCE_TITLE" }),
    ]));
  });

  it("documents the remaining concurrent first-projection lost-update boundary", async () => {
    const fixture = makeFixture({ employerOutcome: "REVIEW_REQUIRED" });
    await fixture.sources.save(observation("concurrent-a", "SAME", "A"));
    await fixture.sources.save(observation("concurrent-b", "SAME", "B"));
    let arrivals = 0;
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => { release = resolve; });
    fixture.extractor.extract.mockImplementation(async (item: SourceObservation) => {
      arrivals += 1;
      if (arrivals === 2) release();
      await barrier;
      return createExtractedVacancyEvidence({ sourceObservationId: item.id });
    });
    const results = await Promise.all([
      processVacancyObservation("concurrent-a", fixture.dependencies),
      processVacancyObservation("concurrent-b", fixture.dependencies),
    ]);
    expect(new Set(results.map(({ canonicalVacancyId }) => canonicalVacancyId)))
      .toEqual(new Set(["canonical-generated"]));
    const persisted = await fixture.canonicals.findById("canonical-generated");
    expect(persisted?.sourceObservationIds).toHaveLength(1);
    expect(["concurrent-a", "concurrent-b"]).toContain(
      persisted?.sourceObservationIds[0],
    );
  });

  it("fails explicitly when canonical history references a missing observation", async () => {
    const fixture = makeFixture();
    await fixture.sources.save(observation("obs-a", "EXT-1", "Title"));
    await fixture.canonicals.save(
      fixture.canonicalizer.canonicalize({
        id: "canonical-generated",
        sourceObservationIds: ["historical-missing", "obs-a"],
        evidenceReferences: [],
        derivation: { algorithm: "seed", algorithmVersion: "1", derivedAt: at },
      }),
    );
    await expect(
      processVacancyObservation("obs-a", fixture.dependencies),
    ).rejects.toThrow(/missing SourceObservation "historical-missing"/u);
    expect(fixture.processEmployerObservation).not.toHaveBeenCalled();
  });

  it("saves REVIEW_REQUIRED without promoting its candidate cluster", async () => {
    const fixture = makeFixture({ employerOutcome: "REVIEW_REQUIRED" });
    await fixture.sources.save(observation("obs-a", "EXT-1", "Title"));
    const result = await processVacancyObservation("obs-a", fixture.dependencies);
    expect(result.employer).toEqual({
      outcome: "REVIEW_REQUIRED",
      candidateClusterId: "candidate-cluster",
      confidence: 0.7,
    });
    expect((await fixture.canonicals.findById(result.canonicalVacancyId))
      ?.organizationRelationships.some(({ employerClusterId }) => employerClusterId !== undefined))
      .toBe(false);
  });

  it("preserves one older effective employer when the new observation requires review", async () => {
    const fixture = makeFixture({ employerOutcome: "REVIEW_REQUIRED" });
    await fixture.sources.save(observation("old", "SAME", "Old"));
    await fixture.sources.save(observation("new", "SAME", "New"));
    const cluster = employerCluster("historical-cluster");
    await fixture.clusters.save(cluster);
    await fixture.assignments.save(assignment("old-assignment", "old", cluster.id));
    await processVacancyObservation("old", fixture.dependencies);
    const result = await processVacancyObservation("new", fixture.dependencies);
    const canonical = await fixture.canonicals.findById(result.canonicalVacancyId);
    expect(canonical?.organizationRelationships).toContainEqual(
      expect.objectContaining({
        role: "EMPLOYER",
        employerClusterId: "historical-cluster",
      }),
    );
  });

  it("fails closed for conflicting effective employer clusters", async () => {
    const fixture = makeFixture({ employerOutcome: "REVIEW_REQUIRED" });
    await fixture.sources.save(observation("old", "SAME", "Old"));
    await fixture.sources.save(observation("new", "SAME", "New"));
    for (const [observationId, clusterId] of [["old", "cluster-a"], ["new", "cluster-b"]] as const) {
      await fixture.clusters.save(employerCluster(clusterId));
      await fixture.assignments.save(assignment(`${observationId}-assignment`, observationId, clusterId));
    }
    await processVacancyObservation("old", fixture.dependencies);
    await expect(
      processVacancyObservation("new", fixture.dependencies),
    ).rejects.toBeInstanceOf(CanonicalVacancyIntegrityError);
  });

  it("fails when an effective assignment references a missing cluster", async () => {
    const fixture = makeFixture({ employerOutcome: "REVIEW_REQUIRED" });
    await fixture.sources.save(observation("obs-a", "EXT-1", "Title"));
    await fixture.assignments.save(
      assignment("missing-cluster-assignment", "obs-a", "missing-cluster"),
    );
    await expect(
      processVacancyObservation("obs-a", fixture.dependencies),
    ).rejects.toThrow(/missing EmployerCluster "missing-cluster"/u);
    expect(await fixture.canonicals.findById("canonical-generated")).toBeNull();
  });

  it("does not save a canonical projection when extraction fails", async () => {
    const fixture = makeFixture();
    await fixture.sources.save(observation("obs-a", "EXT-1", "Title"));
    fixture.extractor.extract.mockRejectedValueOnce(new Error("extraction failed"));
    await expect(
      processVacancyObservation("obs-a", fixture.dependencies),
    ).rejects.toThrow(/extraction failed/u);
    expect(fixture.processEmployerObservation).not.toHaveBeenCalled();
    expect(await fixture.canonicals.findById("canonical-generated")).toBeNull();
  });

  it("does not save a partial projection when canonicalization fails", async () => {
    const fixture = makeFixture();
    await fixture.sources.save(observation("obs-a", "EXT-1", "Title"));
    const dependencies = {
      ...fixture.dependencies,
      canonicalVacancyAdapter: {
        canonicalize() {
          throw new Error("canonicalization failed");
        },
      },
    };
    await expect(
      processVacancyObservation("obs-a", dependencies),
    ).rejects.toThrow(/canonicalization failed/u);
    expect(await fixture.canonicals.findById("canonical-generated")).toBeNull();
    expect(await fixture.assignments.findEffectiveByObservationId("obs-a"))
      .not.toBeNull();
  });

  it("keeps identity and employer state reusable after canonical persistence failure", async () => {
    const fixture = makeFixture();
    await fixture.sources.save(observation("obs-a", "EXT-1", "Title"));
    const originalSave = fixture.canonicals.save.bind(fixture.canonicals);
    const saveSpy = vi.spyOn(fixture.canonicals, "save")
      .mockRejectedValueOnce(new Error("injected canonical failure"))
      .mockImplementation(originalSave);
    await expect(
      processVacancyObservation("obs-a", fixture.dependencies),
    ).rejects.toThrow(/injected canonical failure/u);
    const retry = await processVacancyObservation("obs-a", fixture.dependencies);
    expect(retry.canonicalVacancyId).toBe("canonical-generated");
    expect(retry.canonicalVacancyOutcome).toBe("CREATED");
    expect(saveSpy).toHaveBeenCalledTimes(2);
  });

  it("does not substitute selected acquisition context for rawContent", async () => {
    const fixture = makeFixture();
    const captured = observation("obs-a", "EXT-1", "Title", {
      rawContent: "FULL PAGE TEXT",
      metadata: {
        acquisition: {
          contexts: [{ kind: "SELECTED_VACANCY", text: "SELECTED TEXT" }],
        },
      },
    });
    await fixture.sources.save(captured);
    await processVacancyObservation("obs-a", fixture.dependencies);
    expect(fixture.extractor.extract).toHaveBeenCalledWith(captured);
    expect((fixture.extractor.extract.mock.calls[0]![0]).rawContent)
      .toBe("FULL PAGE TEXT");
  });
});

function makeFixture(options: { employerOutcome?: "CREATED_NEW_CLUSTER" | "REVIEW_REQUIRED" } = {}) {
  const sources = new InMemorySourceObservationRepository();
  const canonicals = new InMemoryCanonicalVacancyRepository(sources);
  const clusters = new InMemoryEmployerClusterRepository();
  const assignments = new InMemoryObservationClusterAssignmentRepository();
  const canonicalizer = new DeterministicCanonicalVacancyCanonicalizer();
  const defaultCluster = employerCluster("cluster-default");
  const candidateCluster = employerCluster("candidate-cluster");
  const extractor = {
    extract: vi.fn(async (item: SourceObservation) =>
      createExtractedVacancyEvidence({ sourceObservationId: item.id })),
  };
  const processEmployerObservation = vi.fn(async (item: SourceObservation) => {
    if (options.employerOutcome === "REVIEW_REQUIRED") {
      return {
        outcome: "REVIEW_REQUIRED" as const,
        candidateCluster,
        proposal: assignment("proposal", item.id, candidateCluster.id, "PROPOSED"),
        confidence: 0.7,
      };
    }
    const existingAssignment =
      await assignments.findEffectiveByObservationId(item.id);
    if (existingAssignment !== null) {
      return {
        outcome: "MATCHED_EXISTING_CLUSTER" as const,
        employerCluster: defaultCluster,
        assignment: existingAssignment,
      };
    }
    if (await clusters.findById(defaultCluster.id) === null) {
      await clusters.save(defaultCluster);
    }
    await assignments.save(assignment(`assignment-${item.id}`, item.id, defaultCluster.id));
    return {
      outcome: "CREATED_NEW_CLUSTER" as const,
      employerCluster: defaultCluster,
      assignment: (await assignments.findEffectiveByObservationId(item.id))!,
    };
  });
  const generateCanonicalVacancyId = vi.fn(() => "canonical-generated");
  return {
    sources,
    canonicals,
    clusters,
    assignments,
    canonicalizer,
    extractor,
    processEmployerObservation,
    generateCanonicalVacancyId,
    dependencies: {
      sourceObservationRepository: sources,
      canonicalVacancyRepository: canonicals,
      evidenceExtractor: extractor,
      canonicalVacancyAdapter: new ExistingPipelineCanonicalVacancyAdapter(canonicalizer),
      employerRecognition: {
        clusterRepository: clusters,
        assignmentRepository: assignments,
        matcher: { findBestMatch: async () => null },
        policy: { automaticAssignmentThreshold: 0.9, reviewThreshold: 0.65 },
        algorithm: "test",
        algorithmVersion: "1",
        recognitionPersistence: new InMemoryEmployerRecognitionPersistence(clusters, assignments),
      },
      processEmployerObservation,
      generateCanonicalVacancyId,
      now: () => at,
    },
  };
}

function observation(
  id: string,
  externalId?: string,
  title?: string,
  overrides: Partial<SourceObservation> = {},
): SourceObservation {
  return {
    id,
    source: {
      sourceType: "JOB_BOARD",
      sourceName: "Indeed",
      ...(externalId === undefined ? {} : { externalId }),
    },
    observedAt: at,
    ...(title === undefined ? {} : { title }),
    metadata: {},
    ...overrides,
  };
}

function employerCluster(id: string): EmployerCluster {
  return {
    id,
    status: "UNRESOLVED",
    createdAt: at,
    updatedAt: at,
  };
}

function assignment(
  id: string,
  sourceObservationId: string,
  employerClusterId: string,
  status: "ACCEPTED" | "PROPOSED" = "ACCEPTED",
): ObservationClusterAssignment {
  return {
    id,
    sourceObservationId,
    employerClusterId,
    confidence: 1,
    status,
    algorithm: "test",
    algorithmVersion: "1",
    evaluatedAt: at,
  };
}
