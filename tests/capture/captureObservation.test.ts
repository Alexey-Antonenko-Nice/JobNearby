import { describe, expect, it } from "vitest";

import { captureObservation } from "../../src/application/capture/captureObservation.js";

import { InMemorySourceObservationRepository } from "../../src/infrastructure/persistence/InMemorySourceObservationRepository.js";

describe("captureObservation", () => {
  it("captures and persists an immutable source observation", async () => {
    const repository = new InMemorySourceObservationRepository();

    const observedAt = new Date("2026-08-20T18:00:00Z");

    const observation = await captureObservation(
      {
        source: {
          sourceType: "JOB_BOARD",
          sourceName: "Meteojob",
          sourceUrl: "https://www.meteojob.com/jobs/55050804",
          externalId: "55050804",
        },
        title: "Technicien de maintenance",
        displayedCompanyName: "Example Recruiter",
        locationText: "Strasbourg",
      },
      {
        repository,
        now: () => observedAt,
        generateId: () => "observation-1",
      },
    );

    expect(observation).toEqual({
      id: "observation-1",
      source: {
        sourceType: "JOB_BOARD",
        sourceName: "Meteojob",
        sourceUrl: "https://www.meteojob.com/jobs/55050804",
        externalId: "55050804",
      },
      observedAt,
      title: "Technicien de maintenance",
      displayedCompanyName: "Example Recruiter",
      locationText: "Strasbourg",
      metadata: {},
    });

    const stored = await repository.findById("observation-1");

    expect(stored).toEqual(observation);
  });

  it("does not overwrite an existing observation", async () => {
    const repository = new InMemorySourceObservationRepository();

    const dependencies = {
      repository,
      now: () => new Date("2026-08-20T18:00:00Z"),
      generateId: () => "same-id",
    };

    await captureObservation(
      {
        source: {
          sourceType: "MANUAL",
          sourceName: "Manual capture",
        },
        title: "First observation",
      },
      dependencies,
    );

    await expect(
      captureObservation(
        {
          source: {
            sourceType: "MANUAL",
            sourceName: "Manual capture",
          },
          title: "Replacement observation",
        },
        dependencies,
      ),
    ).rejects.toThrow('SourceObservation with id "same-id" already exists.');

    const stored = await repository.findById("same-id");

    expect(stored?.title).toBe("First observation");
  });
});
