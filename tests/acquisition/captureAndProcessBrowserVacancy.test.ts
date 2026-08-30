import { describe, expect, it, vi } from "vitest";

import { captureAndProcessBrowserVacancy } from "../../src/application/acquisition/captureAndProcessBrowserVacancy.js";
import { DeterministicAcquisitionCaptureMapper } from "../../src/application/acquisition/DeterministicAcquisitionCaptureMapper.js";
import { InMemorySourceObservationRepository } from "../../src/infrastructure/persistence/InMemorySourceObservationRepository.js";

const payload = {
  pageUrl: "https://example.test/jobs/1",
  pageTitle: "Example vacancy",
  visibleText: "Visible vacancy text",
  capturedAt: "2026-08-30T10:00:00Z",
};

describe("captureAndProcessBrowserVacancy", () => {
  it("persists the capture before invoking vacancy processing", async () => {
    const repository = new InMemorySourceObservationRepository();
    const processVacancyObservation = vi.fn().mockResolvedValue({
      sourceObservationId: "observation-1",
      canonicalVacancyId: "canonical-1",
      canonicalVacancyOutcome: "CREATED",
      observationAdded: true,
      canonicalizationStatus: "USABLE",
      employer: {
        outcome: "CREATED_NEW_CLUSTER",
        employerClusterId: "cluster-1",
        employerClusterStatus: "UNRESOLVED",
      },
    });
    const result = await captureAndProcessBrowserVacancy(payload, {
      ingestion: {
        repository,
        acquisitionMapper: new DeterministicAcquisitionCaptureMapper(),
        generateAcquisitionId: () => "acquisition-1",
        generateObservationId: () => "observation-1",
      },
      processVacancyObservation,
    });
    expect(await repository.findById("observation-1")).not.toBeNull();
    expect(processVacancyObservation).toHaveBeenCalledWith("observation-1");
    expect(result).toMatchObject({
      capture: { observationId: "observation-1", acquisitionId: "acquisition-1" },
      processing: { status: "PROCESSED", employerStatus: "UNRESOLVED_RECORD_CREATED" },
    });
  });

  it("preserves a persisted capture and reports a safe failure when processing throws", async () => {
    const repository = new InMemorySourceObservationRepository();
    const onProcessingFailure = vi.fn();
    const result = await captureAndProcessBrowserVacancy(payload, {
      ingestion: {
        repository,
        acquisitionMapper: new DeterministicAcquisitionCaptureMapper(),
        generateAcquisitionId: () => "acquisition-1",
        generateObservationId: () => "observation-1",
      },
      processVacancyObservation: vi.fn().mockRejectedValue(new Error("database password leaked")),
      onProcessingFailure,
    });
    expect(await repository.findById("observation-1")).not.toBeNull();
    expect(result).toEqual({
      capture: {
        observationId: "observation-1",
        acquisitionId: "acquisition-1",
        observedAt: new Date("2026-08-30T10:00:00.000Z"),
      },
      processing: { status: "FAILED" },
    });
    expect(onProcessingFailure).toHaveBeenCalledWith("observation-1", expect.any(Error));
  });
});