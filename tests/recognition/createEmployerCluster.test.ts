import { describe, expect, it } from "vitest";

import { createEmployerCluster } from "../../src/application/recognition/createEmployerCluster.js";

describe("createEmployerCluster", () => {
  it("creates an unresolved employer without requiring a company name", () => {
    const now = new Date("2026-08-21T00:00:00.000Z");

    const cluster = createEmployerCluster(
      {
        primaryLocationHint: "Molsheim",
        displayLabel: "Unknown employer — Molsheim",
      },
      {
        now: () => now,
        generateId: () => "cluster-17",
      },
    );

    expect(cluster).toEqual({
      id: "cluster-17",
      status: "UNRESOLVED",
      createdAt: now,
      updatedAt: now,
      primaryLocationHint: "Molsheim",
      displayLabel: "Unknown employer — Molsheim",
    });
  });

  it("rejects a resolved cluster without a resolved employer", () => {
    expect(() =>
      createEmployerCluster({
        status: "RESOLVED",
      }),
    ).toThrow(
      "A RESOLVED employer cluster requires resolvedEmployerId.",
    );
  });

  it("rejects an unresolved cluster with a resolved employer", () => {
    expect(() =>
      createEmployerCluster({
        status: "UNRESOLVED",
        resolvedEmployerId: "employer-1",
      }),
    ).toThrow(
      "An UNRESOLVED employer cluster cannot have resolvedEmployerId.",
    );
  });

  it("allows a resolved employer cluster when identity is known", () => {
    const cluster = createEmployerCluster(
      {
        status: "RESOLVED",
        resolvedEmployerId: "employer-1",
      },
      {
        generateId: () => "cluster-1",
        now: () => new Date("2026-08-21T00:00:00.000Z"),
      },
    );

    expect(cluster.status).toBe("RESOLVED");
    expect(cluster.resolvedEmployerId).toBe("employer-1");
  });
});
