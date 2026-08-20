import { describe, expect, it } from "vitest";

import { createDatabase } from "../../src/infrastructure/database/createDatabase.js";

import { SqliteSourceObservationRepository } from "../../src/infrastructure/persistence/SqliteSourceObservationRepository.js";

import type { SourceObservation } from "../../src/domain/capture/SourceObservation.js";

describe("SqliteSourceObservationRepository", () => {
  it("saves and restores a complete observation", async () => {
    const db = createDatabase(":memory:");
    const repository =
      new SqliteSourceObservationRepository(db);

    const observation: SourceObservation = {
      id: "observation-1",

      source: {
        sourceType: "JOB_BOARD",
        sourceName: "Meteojob",
        sourceUrl:
          "https://www.meteojob.com/jobs/55050804",
        externalId: "55050804",
        providerMetadata: {
          provider: "test",
          rank: 3,
        },
      },

      observedAt: new Date(
        "2026-08-20T18:00:00.000Z",
      ),

      publishedAt: new Date(
        "2026-08-19T08:30:00.000Z",
      ),

      title: "Technicien de maintenance",
      displayedCompanyName: "Example Recruiter",
      locationText: "Strasbourg",
      description: "Example description",
      salaryText: "30–35 k€",
      contractText: "CDI",
      contactText: "Example contact",

      rawContent: "Raw captured vacancy content",

      metadata: {
        importedFromEmail: true,
        position: 3,
      },
    };

    await repository.save(observation);

    const restored =
      await repository.findById(
        "observation-1",
      );

    expect(restored).toEqual(observation);

    db.close();
  });

  it("preserves absent optional fields as absent", async () => {
    const db = createDatabase(":memory:");
    const repository =
      new SqliteSourceObservationRepository(db);

    const observation: SourceObservation = {
      id: "minimal-observation",

      source: {
        sourceType: "MANUAL",
        sourceName: "Manual capture",
      },

      observedAt: new Date(
        "2026-08-20T18:00:00.000Z",
      ),

      metadata: {},
    };

    await repository.save(observation);

    const restored =
      await repository.findById(
        "minimal-observation",
      );

    expect(restored).toEqual(observation);

    expect(
      restored !== null &&
        "title" in restored,
    ).toBe(false);

    expect(
      restored !== null &&
        "sourceUrl" in restored.source,
    ).toBe(false);

    db.close();
  });

  it("returns null when observation does not exist", async () => {
    const db = createDatabase(":memory:");
    const repository =
      new SqliteSourceObservationRepository(db);

    const restored =
      await repository.findById("missing");

    expect(restored).toBeNull();

    db.close();
  });

  it("does not overwrite an existing observation", async () => {
    const db = createDatabase(":memory:");
    const repository =
      new SqliteSourceObservationRepository(db);

    const first: SourceObservation = {
      id: "same-id",

      source: {
        sourceType: "MANUAL",
        sourceName: "Manual capture",
      },

      observedAt: new Date(
        "2026-08-20T18:00:00.000Z",
      ),

      title: "First observation",

      metadata: {},
    };

    const second: SourceObservation = {
      ...first,
      title: "Replacement observation",
    };

    await repository.save(first);

    await expect(
      repository.save(second),
    ).rejects.toThrow(
      'SourceObservation with id "same-id" already exists.',
    );

    const restored =
      await repository.findById("same-id");

    expect(restored?.title).toBe(
      "First observation",
    );

    db.close();
  });
});
