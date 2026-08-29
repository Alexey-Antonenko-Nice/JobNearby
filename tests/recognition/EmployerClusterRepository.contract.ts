import { describe, expect, it } from "vitest";

import type { EmployerCluster } from "../../src/domain/recognition/EmployerCluster.js";
import type { EmployerClusterRepository } from "../../src/domain/recognition/EmployerClusterRepository.js";

interface Fixture {
  readonly repository: EmployerClusterRepository;
  close(): void;
}

const timestamp = new Date("2026-08-29T10:00:00.000Z");

export function runEmployerClusterRepositoryContract(
  name: string,
  createFixture: () => Fixture,
): void {
  describe(`${name} EmployerClusterRepository contract`, () => {
    it("round-trips every status and optional field", async () => {
      const fixture = createFixture();
      try {
        const clusters = [
          cluster("unresolved", "UNRESOLVED"),
          cluster("probable", "PROBABLY_RESOLVED", "employer-probable"),
          cluster("resolved", "RESOLVED", "employer-resolved"),
          cluster("conflicted", "CONFLICTED", "employer-conflicted"),
        ];
        for (const item of clusters) await fixture.repository.save(item);
        for (const item of clusters) {
          expect(await fixture.repository.findById(item.id)).toEqual(item);
        }
      } finally {
        fixture.close();
      }
    });

    it("rejects duplicate IDs and returns null for a miss", async () => {
      const fixture = createFixture();
      try {
        const item = cluster("same", "UNRESOLVED");
        await fixture.repository.save(item);
        await expect(fixture.repository.save(item)).rejects.toThrow(/already exists/u);
        expect(await fixture.repository.findById("missing")).toBeNull();
      } finally {
        fixture.close();
      }
    });

    it("preserves normalized substring and combined AND candidate semantics", async () => {
      const fixture = createFixture();
      try {
        const matching = cluster("matching", "UNRESOLVED", undefined, {
          displayLabel: "  Société Énergie Alsace  ",
          primaryLocationHint: " Strasbourg Centre ",
        });
        const wrongLocation = cluster("wrong-location", "UNRESOLVED", undefined, {
          displayLabel: "Société Énergie Alsace",
          primaryLocationHint: "Colmar",
        });
        const wrongName = cluster("wrong-name", "UNRESOLVED", undefined, {
          displayLabel: "Autre entreprise",
          primaryLocationHint: "Strasbourg Centre",
        });
        for (const item of [matching, wrongLocation, wrongName]) {
          await fixture.repository.save(item);
        }
        expect(await fixture.repository.findCandidates({
          locationHint: "STRASBOURG",
          displayedCompanyNameHint: "énergie",
        })).toEqual([matching]);
        expect(await fixture.repository.findCandidates({ locationHint: "bourg" }))
          .toEqual([matching, wrongName]);
        expect(await fixture.repository.findCandidates({ displayedCompanyNameHint: "ÉNERGIE" }))
          .toEqual([matching, wrongLocation]);
      } finally {
        fixture.close();
      }
    });

    it("returns all clusters when criteria are absent", async () => {
      const fixture = createFixture();
      try {
        const first = cluster("first", "UNRESOLVED");
        const second = cluster("second", "CONFLICTED", "employer-2");
        await fixture.repository.save(second);
        await fixture.repository.save(first);
        expect(await fixture.repository.findCandidates({})).toEqual([second, first]);
      } finally {
        fixture.close();
      }
    });

    it("defensively copies saved and returned clusters", async () => {
      const fixture = createFixture();
      try {
        const item = cluster("copy", "UNRESOLVED");
        const expected = structuredClone(item);
        await fixture.repository.save(item);
        item.createdAt.setUTCFullYear(2000);
        const restored = await fixture.repository.findById(item.id);
        restored!.updatedAt.setUTCFullYear(2001);
        expect(await fixture.repository.findById(item.id)).toEqual(expected);
      } finally {
        fixture.close();
      }
    });
  });
}

function cluster(
  id: string,
  status: EmployerCluster["status"],
  resolvedEmployerId?: string,
  hints: { readonly displayLabel?: string; readonly primaryLocationHint?: string } = {},
): EmployerCluster {
  return {
    id,
    status,
    createdAt: new Date(timestamp),
    updatedAt: new Date(timestamp),
    ...(resolvedEmployerId === undefined ? {} : { resolvedEmployerId }),
    displayLabel: hints.displayLabel ?? `Cluster ${id}`,
    primaryLocationHint: hints.primaryLocationHint ?? "Strasbourg",
  };
}
