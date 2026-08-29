import { describe, expect, it } from "vitest";

import type { ObservationClusterAssignment } from "../../src/domain/recognition/ObservationClusterAssignment.js";
import type { ObservationClusterAssignmentRepository } from "../../src/domain/recognition/ObservationClusterAssignmentRepository.js";

interface Fixture {
  readonly repository: ObservationClusterAssignmentRepository;
  prepare(assignment: ObservationClusterAssignment): Promise<void>;
  close(): void;
}

export function runObservationClusterAssignmentRepositoryContract(
  name: string,
  createFixture: () => Fixture,
): void {
  describe(`${name} ObservationClusterAssignmentRepository contract`, () => {
    it("round-trips every status and preserves historical retrieval", async () => {
      const fixture = createFixture();
      try {
        const statuses = ["PROPOSED", "ACCEPTED", "REJECTED", "USER_CONFIRMED"] as const;
        for (const [index, status] of statuses.entries()) {
          const item = assignment(`assignment-${index}`, `observation-${index}`, status);
          await fixture.prepare(item);
          await fixture.repository.save(item);
          expect(await fixture.repository.findById(item.id)).toEqual(item);
          expect(await fixture.repository.findByObservationId(item.sourceObservationId))
            .toEqual([item]);
        }
      } finally {
        fixture.close();
      }
    });

    it("orders history by evaluatedAt and then ID", async () => {
      const fixture = createFixture();
      try {
        const items = [
          assignment("b", "history", "REJECTED", "2026-08-29T12:00:00.000Z"),
          assignment("c", "history", "REJECTED", "2026-08-29T11:00:00.000Z"),
          assignment("a", "history", "REJECTED", "2026-08-29T12:00:00.000Z"),
        ];
        for (const item of items) {
          await fixture.prepare(item);
          await fixture.repository.save(item);
        }
        expect((await fixture.repository.findByObservationId("history")).map(({ id }) => id))
          .toEqual(["c", "a", "b"]);
      } finally {
        fixture.close();
      }
    });

    it("treats ACCEPTED and USER_CONFIRMED as effective only", async () => {
      const fixture = createFixture();
      try {
        for (const [status, expected] of [
          ["ACCEPTED", true],
          ["USER_CONFIRMED", true],
          ["PROPOSED", false],
          ["REJECTED", false],
        ] as const) {
          const item = assignment(`effective-${status}`, `observation-${status}`, status);
          await fixture.prepare(item);
          await fixture.repository.save(item);
          expect(await fixture.repository.findEffectiveByObservationId(item.sourceObservationId))
            .toEqual(expected ? item : null);
        }
      } finally {
        fixture.close();
      }
    });

    it("returns only PROPOSED as the current proposal", async () => {
      const fixture = createFixture();
      try {
        const proposed = assignment("proposal", "proposal-observation", "PROPOSED");
        await fixture.prepare(proposed);
        await fixture.repository.save(proposed);
        expect(await fixture.repository.findCurrentProposalByObservationId(
          proposed.sourceObservationId,
        )).toEqual(proposed);
        expect(await fixture.repository.findCurrentProposalByObservationId("missing"))
          .toBeNull();
      } finally {
        fixture.close();
      }
    });

    it("rejects a second effective membership and a second current proposal", async () => {
      const fixture = createFixture();
      try {
        const accepted = assignment("accepted-a", "effective-one", "ACCEPTED");
        const confirmed = assignment("accepted-b", "effective-one", "USER_CONFIRMED");
        const proposalA = assignment("proposal-a", "proposal-one", "PROPOSED");
        const proposalB = assignment("proposal-b", "proposal-one", "PROPOSED");
        for (const item of [accepted, confirmed, proposalA, proposalB]) {
          await fixture.prepare(item);
        }
        await fixture.repository.save(accepted);
        await expect(fixture.repository.save(confirmed)).rejects.toThrow();
        await fixture.repository.save(proposalA);
        await expect(fixture.repository.save(proposalB)).rejects.toThrow();
      } finally {
        fixture.close();
      }
    });

    it("rejects duplicate IDs and invalid values", async () => {
      const fixture = createFixture();
      try {
        const valid = assignment("duplicate", "duplicate-observation", "REJECTED");
        await fixture.prepare(valid);
        await fixture.repository.save(valid);
        await expect(fixture.repository.save(valid)).rejects.toThrow(/already exists/u);
        for (const invalid of [
          { ...assignment("bad-confidence", "bad-1", "REJECTED"), confidence: 1.1 },
          { ...assignment("bad-algorithm", "bad-2", "REJECTED"), algorithm: " " },
          { ...assignment("bad-version", "bad-3", "REJECTED"), algorithmVersion: " " },
        ]) {
          await fixture.prepare(invalid);
          await expect(fixture.repository.save(invalid)).rejects.toThrow();
        }
      } finally {
        fixture.close();
      }
    });

    it("defensively copies assignments", async () => {
      const fixture = createFixture();
      try {
        const item = assignment("copy", "copy-observation", "REJECTED");
        const expected = structuredClone(item);
        await fixture.prepare(item);
        await fixture.repository.save(item);
        item.evaluatedAt.setUTCFullYear(2000);
        const restored = await fixture.repository.findById(item.id);
        restored!.evaluatedAt.setUTCFullYear(2001);
        expect(await fixture.repository.findById(item.id)).toEqual(expected);
      } finally {
        fixture.close();
      }
    });
  });
}

export function assignment(
  id: string,
  sourceObservationId: string,
  status: ObservationClusterAssignment["status"],
  evaluatedAt = "2026-08-29T10:00:00.000Z",
): ObservationClusterAssignment {
  return {
    id,
    sourceObservationId,
    employerClusterId: `cluster-${id}`,
    confidence: 0.8,
    status,
    algorithm: "repository-contract",
    algorithmVersion: "1",
    evaluatedAt: new Date(evaluatedAt),
    explanation: "Contract fixture",
  };
}
