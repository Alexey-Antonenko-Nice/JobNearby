import { describe, expect, it } from "vitest";

import { createEmployerCluster } from "../../src/application/recognition/createEmployerCluster.js";

import { InMemoryEmployerClusterRepository } from "../../src/infrastructure/persistence/InMemoryEmployerClusterRepository.js";
import { runEmployerClusterRepositoryContract } from "./EmployerClusterRepository.contract.js";

runEmployerClusterRepositoryContract("InMemory", () => ({
  repository: new InMemoryEmployerClusterRepository(),
  close() {},
}));

describe("InMemoryEmployerClusterRepository", () => {
  it("saves and restores an employer cluster", async () => {
    const repository =
      new InMemoryEmployerClusterRepository();

    const cluster = createEmployerCluster(
      {
        primaryLocationHint: "Molsheim",
        displayLabel: "Unknown employer — Molsheim",
      },
      {
        generateId: () => "cluster-17",
        now: () =>
          new Date("2026-08-21T06:00:00.000Z"),
      },
    );

    await repository.save(cluster);

    expect(
      await repository.findById("cluster-17"),
    ).toEqual(cluster);
  });

  it("returns null when the cluster does not exist", async () => {
    const repository =
      new InMemoryEmployerClusterRepository();

    expect(
      await repository.findById("missing"),
    ).toBeNull();
  });

  it("does not overwrite an existing cluster", async () => {
    const repository =
      new InMemoryEmployerClusterRepository();

    const first = createEmployerCluster(
      {
        displayLabel: "First cluster",
      },
      {
        generateId: () => "same-id",
      },
    );

    const second = createEmployerCluster(
      {
        displayLabel: "Replacement cluster",
      },
      {
        generateId: () => "same-id",
      },
    );

    await repository.save(first);

    await expect(
      repository.save(second),
    ).rejects.toThrow(
      'EmployerCluster with id "same-id" already exists.',
    );

    const stored =
      await repository.findById("same-id");

    expect(stored?.displayLabel).toBe(
      "First cluster",
    );
  });

  it("finds candidates using case-insensitive location and name hints", async () => {
    const repository = new InMemoryEmployerClusterRepository();
    const matching = createEmployerCluster(
      { displayLabel: "Acme Industries", primaryLocationHint: "Strasbourg" },
      { generateId: () => "matching" },
    );
    const other = createEmployerCluster(
      { displayLabel: "Other Company", primaryLocationHint: "Colmar" },
      { generateId: () => "other" },
    );
    await repository.save(matching);
    await repository.save(other);

    await expect(
      repository.findCandidates({
        locationHint: "strasbourg",
        displayedCompanyNameHint: "ACME",
      }),
    ).resolves.toEqual([matching]);
  });
});
