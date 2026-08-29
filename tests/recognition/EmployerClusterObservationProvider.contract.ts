import { describe, expect, it } from "vitest";

import type { SourceObservation } from "../../src/domain/capture/SourceObservation.js";
import type { ObservationClusterAssignmentStatus } from "../../src/domain/recognition/ObservationClusterAssignment.js";
import type { EmployerClusterObservationProvider } from "../../src/domain/recognition/EmployerClusterObservationProvider.js";

interface Fixture {
  readonly provider: EmployerClusterObservationProvider;
  add(
    clusterId: string,
    observation: SourceObservation,
    status: ObservationClusterAssignmentStatus,
  ): Promise<void>;
  close(): void;
}

export function runEmployerClusterObservationProviderContract(
  name: string,
  createFixture: () => Fixture,
): void {
  describe(`${name} EmployerClusterObservationProvider contract`, () => {
    it("includes accepted and user-confirmed observations", async () => {
      const fixture = createFixture();
      try {
        const accepted = observation("accepted");
        const confirmed = observation("confirmed");
        await fixture.add("cluster-a", accepted, "ACCEPTED");
        await fixture.add("cluster-a", confirmed, "USER_CONFIRMED");
        expect(await fixture.provider.findObservationsByClusterId("cluster-a"))
          .toEqual([accepted, confirmed]);
      } finally {
        fixture.close();
      }
    });

    it("excludes proposed and rejected observations", async () => {
      const fixture = createFixture();
      try {
        await fixture.add("cluster-a", observation("proposed"), "PROPOSED");
        await fixture.add("cluster-a", observation("rejected"), "REJECTED");
        expect(await fixture.provider.findObservationsByClusterId("cluster-a"))
          .toEqual([]);
      } finally {
        fixture.close();
      }
    });

    it("returns complete reconstructed observations without duplicates", async () => {
      const fixture = createFixture();
      try {
        const item: SourceObservation = {
          ...observation("complete"),
          title: "Maintenance engineer",
          displayedCompanyName: "Example Industries",
          locationText: "Strasbourg",
          rawContent: "Preserved content",
          metadata: { acquisition: { method: "test" } },
        };
        await fixture.add("cluster-a", item, "ACCEPTED");
        expect(await fixture.provider.findObservationsByClusterId("cluster-a"))
          .toEqual([item]);
      } finally {
        fixture.close();
      }
    });

    it("returns an empty result for an unknown cluster", async () => {
      const fixture = createFixture();
      try {
        expect(await fixture.provider.findObservationsByClusterId("missing"))
          .toEqual([]);
      } finally {
        fixture.close();
      }
    });
  });
}

function observation(id: string): SourceObservation {
  return {
    id,
    source: { sourceType: "MANUAL", sourceName: "provider-contract" },
    observedAt: new Date("2026-08-29T10:00:00.000Z"),
    metadata: {},
  };
}
