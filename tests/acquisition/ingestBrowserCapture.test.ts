import { describe, expect, it } from "vitest";

import { DeterministicAcquisitionCaptureMapper } from "../../src/application/acquisition/DeterministicAcquisitionCaptureMapper.js";
import { ingestBrowserCapture } from "../../src/application/acquisition/ingestBrowserCapture.js";
import type { SourceObservation } from "../../src/domain/capture/SourceObservation.js";
import type { SourceObservationRepository } from "../../src/domain/capture/SourceObservationRepository.js";
import { InMemorySourceObservationRepository } from "../../src/infrastructure/persistence/InMemorySourceObservationRepository.js";

const browserPayload = {
  pageUrl: "https://fr.indeed.com/viewjob?jk=abc",
  pageTitle: "Maintenance role",
  visibleText: "Technicien Maintenance H/F\nACTUA SAVERNE\nHEUFT France\nCDI\nBrumath",
  capturedAt: "2026-08-28T10:00:00Z",
};

function dependencies(repository: SourceObservationRepository) {
  return {
    repository,
    acquisitionMapper: new DeterministicAcquisitionCaptureMapper(),
    generateAcquisitionId: () => "acquisition-generated",
    generateObservationId: () => "observation-generated",
  };
}

describe("ingestBrowserCapture", () => {
  it("persists one observation and returns only capture identities and time", async () => {
    const repository = new InMemorySourceObservationRepository();
    const result = await ingestBrowserCapture(browserPayload, dependencies(repository));
    expect(result).toEqual({
      success: true,
      sourceObservationId: "observation-generated",
      acquisitionId: "acquisition-generated",
      observedAt: new Date("2026-08-28T10:00:00Z"),
    });
    const stored = await repository.findById(result.sourceObservationId);
    expect(stored).toMatchObject({
      id: "observation-generated",
      source: {
        sourceType: "BROWSER_CAPTURE",
        sourceName: "indeed.com",
        sourceUrl: browserPayload.pageUrl,
      },
      rawContent: browserPayload.visibleText,
    });
    expect(stored).not.toHaveProperty("title");
    expect(stored).not.toHaveProperty("displayedCompanyName");
    expect(stored).not.toHaveProperty("locationText");
    expect(stored).not.toHaveProperty("publishedAt");
    expect(stored).not.toHaveProperty("externalId");
  });

  it("persists repeated captures as independent observations", async () => {
    const repository = new InMemorySourceObservationRepository();
    let index = 0;
    const deps = {
      repository,
      acquisitionMapper: new DeterministicAcquisitionCaptureMapper(),
      generateAcquisitionId: () => `acquisition-${++index}`,
      generateObservationId: () => `observation-${index}`,
    };
    const first = await ingestBrowserCapture(browserPayload, deps);
    const second = await ingestBrowserCapture(browserPayload, deps);
    expect(first.sourceObservationId).toBe("observation-1");
    expect(second.sourceObservationId).toBe("observation-2");
    expect(await repository.findById("observation-1")).not.toBeNull();
    expect(await repository.findById("observation-2")).not.toBeNull();
  });

  it("keeps acquisition and observation IDs semantically separate", async () => {
    const repository = new InMemorySourceObservationRepository();
    const result = await ingestBrowserCapture(browserPayload, dependencies(repository));
    expect(result.acquisitionId).not.toBe(result.sourceObservationId);
  });

  it("reports repository failure and never claims success", async () => {
    const repository: SourceObservationRepository = {
      async save(_observation: SourceObservation): Promise<void> {
        throw new Error("disk unavailable");
      },
      async findById(): Promise<SourceObservation | null> {
        return null;
      },
    };
    await expect(ingestBrowserCapture(browserPayload, dependencies(repository))).rejects.toThrow(
      "Browser capture could not be persisted: disk unavailable",
    );
  });

  it("has no downstream recognition or canonicalization dependency", async () => {
    const repository = new InMemorySourceObservationRepository();
    const deps = dependencies(repository);
    expect(Object.keys(deps).sort()).toEqual([
      "acquisitionMapper", "generateAcquisitionId", "generateObservationId", "repository",
    ]);
    await expect(ingestBrowserCapture(browserPayload, deps)).resolves.toMatchObject({ success: true });
  });
});
