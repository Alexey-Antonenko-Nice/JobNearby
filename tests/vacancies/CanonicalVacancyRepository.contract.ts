import { describe, expect, it } from "vitest";

import type { CanonicalVacancyRepository } from "../../src/domain/vacancies/CanonicalVacancyRepository.js";
import type { CanonicalVacancy } from "../../src/domain/vacancies/CanonicalVacancy.js";
import { DeterministicCanonicalVacancyCanonicalizer } from "../../src/application/vacancies/DeterministicCanonicalVacancyCanonicalizer.js";
import type { CanonicalizeVacancyInput } from "../../src/application/vacancies/CanonicalVacancyCanonicalizer.js";
import type { SourceObservation } from "../../src/domain/capture/SourceObservation.js";
import { CanonicalVacancyStaleProjectionError } from "../../src/domain/vacancies/CanonicalVacancyPersistenceError.js";

export interface RepositoryFixture {
  readonly repository: CanonicalVacancyRepository;
  saveObservation(observation: SourceObservation): Promise<void>;
  close(): void;
}

const canonicalizer = new DeterministicCanonicalVacancyCanonicalizer();
const derivation = {
  algorithm: "repository-contract",
  algorithmVersion: "1.0.0",
  derivedAt: new Date("2026-08-28T12:00:00.000Z"),
};

export function runCanonicalVacancyRepositoryContract(
  name: string,
  createFixture: () => RepositoryFixture,
): void {
  describe(`${name} CanonicalVacancyRepository contract`, () => {
    it("round-trips a minimal PARTIAL vacancy and UNKNOWN fields", async () => {
      const fixture = createFixture();
      try {
        const vacancy = makeVacancy("minimal", {});
        await fixture.repository.save(vacancy);
        const restored = await fixture.repository.findById(vacancy.id);
        expect(restored).toEqual(vacancy);
        expect(restored?.canonicalizationStatus).toBe("PARTIAL");
        expect(restored?.role.status).toBe("UNKNOWN");
        expect(restored !== null && "value" in restored.role).toBe(false);
      } finally {
        fixture.close();
      }
    });

    it("round-trips the HEUFT usable employer, engagement, travel, and evidence", async () => {
      const fixture = createFixture();
      try {
        const vacancy = heuftVacancy();
        await fixture.repository.save(vacancy);
        const restored = await fixture.repository.findById(vacancy.id);
        expect(restored).toEqual(vacancy);
        expect(restored?.canonicalizationStatus).toBe("USABLE");
        expect(restored?.organizationRelationships).toContainEqual(
          expect.objectContaining({ role: "EMPLOYER", rawName: "HEUFT France" }),
        );
        expect(restored?.engagement.value).toEqual({
          rawTerms: ["CDI"],
          normalizedTerms: ["PERMANENT_EMPLOYMENT"],
        });
        expect(restored?.travel.value).toEqual({
          requirement: "REQUIRED",
          frequencyText: "extensive",
        });
      } finally {
        fixture.close();
      }
    });

    it("round-trips Brightsmith conflicts, alternatives, and conflicting evidence", async () => {
      const fixture = createFixture();
      try {
        const vacancy = brightsmithVacancy();
        await fixture.repository.save(vacancy);
        const restored = await fixture.repository.findById(vacancy.id);
        expect(restored).toEqual(vacancy);
        expect(restored?.canonicalizationStatus).toBe("CONFLICTED");
        expect(restored?.workMode.alternatives?.map(({ value }) => value)).toEqual([
          "HYBRID",
          "ON_SITE",
        ]);
        expect(restored?.engagement.conflictingEvidenceIds).toEqual([
          "bright-cdd",
          "bright-freelance",
        ]);
      } finally {
        fixture.close();
      }
    });

    it("round-trips TE publication and working languages independently", async () => {
      const fixture = createFixture();
      try {
        const vacancy = teVacancy();
        await fixture.repository.save(vacancy);
        const restored = await fixture.repository.findById(vacancy.id);
        expect(restored).toEqual(vacancy);
        expect(restored?.publicationLanguages.value).toEqual(["German"]);
        expect(restored?.languageRequirements.value).toEqual([
          { language: "English", requirement: "REQUIRED" },
          { language: "German", requirement: "PREFERRED" },
        ]);
      } finally {
        fixture.close();
      }
    });

    it("round-trips ADSEARCH recruiter and unresolved employer cluster", async () => {
      const fixture = createFixture();
      try {
        const vacancy = adsearchVacancy();
        await fixture.repository.save(vacancy);
        const restored = await fixture.repository.findById(vacancy.id);
        expect(restored).toEqual(vacancy);
        expect(restored?.organizationRelationships).toEqual([
          expect.objectContaining({ role: "RECRUITER", rawName: "ADSEARCH" }),
          expect.objectContaining({
            role: "EMPLOYER",
            employerClusterId: "unresolved-employer-17",
          }),
        ]);
      } finally {
        fixture.close();
      }
    });

    it("preserves independent location, work mode, remote eligibility, and travel", async () => {
      const fixture = createFixture();
      try {
        const vacancy = independentGeographyVacancy();
        await fixture.repository.save(vacancy);
        const restored = await fixture.repository.findById(vacancy.id);
        expect(restored).toEqual(vacancy);
        expect(restored?.location.value).toEqual({ countryCode: "ES", rawText: "Spain" });
        expect(restored?.workMode.value).toBe("REMOTE");
        expect(restored?.remoteEligibleCountries.value).toEqual(["ES", "FR"]);
        expect(restored?.travel.value).toEqual({ requirement: "REQUIRED", scopeText: "Europe" });
      } finally {
        fixture.close();
      }
    });

    it("returns null for an unknown ID", async () => {
      const fixture = createFixture();
      try {
        expect(await fixture.repository.findById("missing")).toBeNull();
      } finally {
        fixture.close();
      }
    });

    it("finds a canonical vacancy by SourceObservation ID", async () => {
      const fixture = createFixture();
      try {
        await fixture.saveObservation(observation("member-a", "Indeed", "MEMBER-1"));
        const vacancy = makeVacancy("member", {
          sourceObservationIds: ["member-a"],
        });
        await fixture.repository.save(vacancy);
        expect(
          await fixture.repository.findBySourceObservationId("member-a"),
        ).toEqual(vacancy);
        expect(
          await fixture.repository.findBySourceObservationId("missing-member"),
        ).toBeNull();
      } finally {
        fixture.close();
      }
    });

    it("converges repeated claims for one observation", async () => {
      const fixture = createFixture();
      try {
        await fixture.saveObservation(observation("claim-a", "Indeed"));
        expect(
          await fixture.repository.claimIdentity("claim-a", "canonical-winner"),
        ).toEqual({
          canonicalVacancyId: "canonical-winner",
          outcome: "CLAIMED",
        });
        expect(
          await fixture.repository.claimIdentity("claim-a", "canonical-loser"),
        ).toEqual({
          canonicalVacancyId: "canonical-winner",
          outcome: "EXISTING",
        });
      } finally {
        fixture.close();
      }
    });

    it("converges different observations with one exact identity", async () => {
      const fixture = createFixture();
      try {
        await fixture.saveObservation(observation("claim-a", " Indeed ", "SAME"));
        await fixture.saveObservation(observation("claim-b", "indeed", "SAME"));
        await fixture.repository.claimIdentity("claim-a", "canonical-winner");
        expect(
          await fixture.repository.claimIdentity("claim-b", "canonical-loser"),
        ).toEqual({
          canonicalVacancyId: "canonical-winner",
          outcome: "EXISTING",
        });
      } finally {
        fixture.close();
      }
    });

    it("keeps distinct exact identities and missing external IDs independent", async () => {
      const fixture = createFixture();
      try {
        await fixture.saveObservation(observation("claim-a", "Indeed", "ABC"));
        await fixture.saveObservation(observation("claim-b", "LinkedIn", "ABC"));
        await fixture.saveObservation(observation("claim-c", "Indeed", "abc"));
        await fixture.saveObservation(observation("claim-d", "Indeed"));
        expect((await fixture.repository.claimIdentity("claim-a", "canonical-a")).canonicalVacancyId).toBe("canonical-a");
        expect((await fixture.repository.claimIdentity("claim-b", "canonical-b")).canonicalVacancyId).toBe("canonical-b");
        expect((await fixture.repository.claimIdentity("claim-c", "canonical-c")).canonicalVacancyId).toBe("canonical-c");
        expect((await fixture.repository.claimIdentity("claim-d", "canonical-d")).canonicalVacancyId).toBe("canonical-d");
      } finally {
        fixture.close();
      }
    });

    it("atomically replaces the current projection for the same ID and claim set", async () => {
      const fixture = createFixture();
      try {
        const first = makeVacancy("replace", {
          evidenceReferences: [ref("replace-role-a", "replace-observation-a")],
          sourceObservationIds: ["replace-observation-a"],
          roleCandidates: [candidate({ title: "First title" }, "replace-role-a")],
        });
        const replacement = makeVacancy("replace", {
          evidenceReferences: [ref("replace-role-b", "replace-observation-a")],
          sourceObservationIds: ["replace-observation-a"],
          roleCandidates: [candidate({ title: "Replacement title" }, "replace-role-b")],
        });
        await fixture.repository.save(first);
        await fixture.repository.save(replacement);
        expect(await fixture.repository.findById(first.id)).toEqual(replacement);
      } finally {
        fixture.close();
      }
    });

    it("finds claims before a canonical projection exists", async () => {
      const fixture = createFixture();
      try {
        await fixture.saveObservation(observation("claimed-only", "Indeed", "CLAIMED"));
        await fixture.repository.claimIdentity("claimed-only", "canonical-claimed");
        expect(
          await fixture.repository.findClaimedSourceObservationIds("canonical-claimed"),
        ).toEqual(["claimed-only"]);
        expect(await fixture.repository.findById("canonical-claimed")).toBeNull();
      } finally {
        fixture.close();
      }
    });

    it("returns CREATED then UPDATED_EXISTING for guarded saves", async () => {
      const fixture = createFixture();
      try {
        const vacancy = makeVacancy("save-result", {});
        expect(await fixture.repository.save(vacancy)).toEqual({ outcome: "CREATED" });
        expect(await fixture.repository.save(vacancy)).toEqual({
          outcome: "UPDATED_EXISTING",
        });
      } finally {
        fixture.close();
      }
    });

    it("rejects stale projection membership without deleting claims or projection", async () => {
      const fixture = createFixture();
      try {
        const original = makeVacancy("stale", {
          sourceObservationIds: ["stale-a"],
        });
        await fixture.repository.save(original);
        await fixture.saveObservation(observation("stale-b", "Indeed"));
        await fixture.repository.claimIdentity("stale-b", original.id);
        await expect(fixture.repository.save(original)).rejects.toBeInstanceOf(
          CanonicalVacancyStaleProjectionError,
        );
        expect(await fixture.repository.findById(original.id)).toEqual(original);
        expect(
          await fixture.repository.findClaimedSourceObservationIds(original.id),
        ).toEqual(["stale-a", "stale-b"]);
      } finally {
        fixture.close();
      }
    });

    it("defensively copies saved and retrieved projections", async () => {
      const fixture = createFixture();
      try {
        const vacancy = heuftVacancy();
        const expected = structuredClone(vacancy);
        await fixture.repository.save(vacancy);
        (vacancy.sourceObservationIds as string[]).push("caller-mutation");
        vacancy.derivation.derivedAt.setUTCFullYear(2000);
        const firstRead = await fixture.repository.findById(vacancy.id);
        expect(firstRead).toEqual(expected);
        (firstRead!.sourceObservationIds as string[]).push("retrieval-mutation");
        firstRead!.derivation.derivedAt.setUTCFullYear(1999);
        expect(await fixture.repository.findById(vacancy.id)).toEqual(expected);
      } finally {
        fixture.close();
      }
    });

    it("keeps internal ID independent and contains no CRM or shortage state", async () => {
      const fixture = createFixture();
      try {
        const vacancy = heuftVacancy();
        await fixture.repository.save(vacancy);
        const restored = await fixture.repository.findById(vacancy.id);
        expect(restored?.id).toBe("canonical-heuft");
        expect(restored?.id).not.toContain("external");
        expect(Object.keys(restored!)).not.toEqual(
          expect.arrayContaining([
            "applicationStatus",
            "notes",
            "interviews",
            "shortageOccupation",
            "metierEnTension",
          ]),
        );
      } finally {
        fixture.close();
      }
    });

    it("finds a canonical vacancy by exact normalized provider identity", async () => {
      const fixture = createFixture();
      try {
        await fixture.saveObservation(observation("identity-a", " Indeed  Jobs ", "ABC123"));
        const vacancy = makeVacancy("identity", {
          sourceObservationIds: ["identity-a"],
        });
        await fixture.repository.save(vacancy);

        expect(
          await fixture.repository.findByExactSourceIdentity(
            "indeed jobs",
            "ABC123",
          ),
        ).toEqual(vacancy);
      } finally {
        fixture.close();
      }
    });

    it("does not match a different external ID or provider namespace", async () => {
      const fixture = createFixture();
      try {
        await fixture.saveObservation(observation("identity-a", "Indeed", "ABC123"));
        await fixture.repository.save(makeVacancy("identity", {
          sourceObservationIds: ["identity-a"],
        }));

        expect(
          await fixture.repository.findByExactSourceIdentity("Indeed", "XYZ789"),
        ).toBeNull();
        expect(
          await fixture.repository.findByExactSourceIdentity("LinkedIn", "ABC123"),
        ).toBeNull();
      } finally {
        fixture.close();
      }
    });

    it("does not match an observation without an external ID", async () => {
      const fixture = createFixture();
      try {
        await fixture.saveObservation(observation("identity-a", "Indeed"));
        await fixture.repository.save(makeVacancy("identity", {
          sourceObservationIds: ["identity-a"],
        }));

        expect(
          await fixture.repository.findByExactSourceIdentity("Indeed", "ABC123"),
        ).toBeNull();
      } finally {
        fixture.close();
      }
    });

    it("keeps leading zeros and external-ID case exact", async () => {
      const fixture = createFixture();
      try {
        await fixture.saveObservation(observation("identity-a", "Indeed", "001AbC"));
        const vacancy = makeVacancy("identity", {
          sourceObservationIds: ["identity-a"],
        });
        await fixture.repository.save(vacancy);

        expect(
          await fixture.repository.findByExactSourceIdentity("Indeed", "001AbC"),
        ).toEqual(vacancy);
        expect(
          await fixture.repository.findByExactSourceIdentity("Indeed", "1AbC"),
        ).toBeNull();
        expect(
          await fixture.repository.findByExactSourceIdentity("Indeed", "001abc"),
        ).toBeNull();
      } finally {
        fixture.close();
      }
    });

    it("returns one vacancy when several member observations share its exact identity", async () => {
      const fixture = createFixture();
      try {
        await fixture.saveObservation(observation("identity-a", "Indeed", "ABC123"));
        await fixture.saveObservation(observation("identity-b", " indeed ", "ABC123"));
        const vacancy = makeVacancy("identity", {
          sourceObservationIds: ["identity-a", "identity-b"],
        });
        await fixture.repository.save(vacancy);

        expect(
          await fixture.repository.findByExactSourceIdentity("INDEED", "ABC123"),
        ).toEqual(vacancy);
      } finally {
        fixture.close();
      }
    });

    it("prevents an exact identity from belonging to multiple vacancies", async () => {
      const fixture = createFixture();
      try {
        await fixture.saveObservation(observation("identity-a", "Indeed", "ABC123"));
        await fixture.saveObservation(observation("identity-b", "indeed", "ABC123"));
        await fixture.repository.save(makeVacancy("identity-a", {
          sourceObservationIds: ["identity-a"],
        }));
        await expect(
          fixture.repository.save(makeVacancy("identity-b", {
            sourceObservationIds: ["identity-b"],
          })),
        ).rejects.toThrow(/integrity error/u);
      } finally {
        fixture.close();
      }
    });

    it("prevents one observation from belonging to two vacancies", async () => {
      const fixture = createFixture();
      try {
        await fixture.saveObservation(observation("shared", "Indeed"));
        await fixture.repository.save(makeVacancy("first", {
          sourceObservationIds: ["shared"],
        }));
        await expect(
          fixture.repository.save(makeVacancy("second", {
            sourceObservationIds: ["shared"],
          })),
        ).rejects.toThrow(/membership integrity error/u);
      } finally {
        fixture.close();
      }
    });
  });
}

function observation(
  id: string,
  sourceName: string,
  externalId?: string,
): SourceObservation {
  return {
    id,
    source: {
      sourceType: "JOB_BOARD",
      sourceName,
      ...(externalId === undefined ? {} : { externalId }),
    },
    observedAt: new Date("2026-08-28T12:00:00.000Z"),
    metadata: {},
  };
}

export function heuftVacancy(): CanonicalVacancy {
  return makeVacancy("heuft", {
    evidenceReferences: [
      ref("heuft-role", "heuft-a"),
      ref("heuft-employer", "heuft-a"),
      ref("heuft-cdi", "heuft-a"),
      ref("heuft-travel", "heuft-b"),
    ],
    sourceObservationIds: ["heuft-a", "heuft-b"],
    roleCandidates: [candidate({ title: "Service technician" }, "heuft-role")],
    organizationRelationships: [relationship("EMPLOYER", "heuft-employer", { rawName: "HEUFT France" })],
    engagementCandidates: [candidate({
      rawTerms: ["CDI"],
      normalizedTerms: ["PERMANENT_EMPLOYMENT"],
    }, "heuft-cdi")],
    travelCandidates: [candidate({
      requirement: "REQUIRED",
      frequencyText: "extensive",
    }, "heuft-travel")],
  });
}

export function brightsmithVacancy(): CanonicalVacancy {
  return makeVacancy("brightsmith", {
    evidenceReferences: [
      ref("bright-role"), ref("bright-hybrid"), ref("bright-onsite"),
      ref("bright-cdd"), ref("bright-freelance"),
    ],
    roleCandidates: [candidate({ title: "Project engineer" }, "bright-role")],
    workModeCandidates: [
      candidate("HYBRID", "bright-hybrid"),
      candidate("ON_SITE", "bright-onsite"),
    ],
    engagementCandidates: [
      candidate({ rawTerms: ["CDD"], normalizedTerms: ["FIXED_TERM_EMPLOYMENT"] }, "bright-cdd"),
      candidate({ rawTerms: ["freelance"], normalizedTerms: ["FREELANCE"] }, "bright-freelance"),
    ],
  });
}

export function teVacancy(): CanonicalVacancy {
  return makeVacancy("te", {
    evidenceReferences: [ref("te-role"), ref("te-publication"), ref("te-languages")],
    roleCandidates: [candidate({ title: "Engineer" }, "te-role")],
    publicationLanguageCandidates: [candidate(["German"], "te-publication")],
    languageRequirementCandidates: [candidate([
      { language: "English", requirement: "REQUIRED" },
      { language: "German", requirement: "PREFERRED" },
    ], "te-languages")],
  });
}

export function adsearchVacancy(): CanonicalVacancy {
  return makeVacancy("adsearch", {
    evidenceReferences: [ref("ad-role"), ref("ad-recruiter"), ref("ad-employer")],
    roleCandidates: [candidate({ title: "Maintenance manager" }, "ad-role")],
    organizationRelationships: [
      relationship("RECRUITER", "ad-recruiter", { rawName: "ADSEARCH" }),
      relationship("EMPLOYER", "ad-employer", { employerClusterId: "unresolved-employer-17" }),
    ],
  });
}

function independentGeographyVacancy(): CanonicalVacancy {
  return makeVacancy("geography", {
    evidenceReferences: [
      ref("geo-role"), ref("geo-location"), ref("geo-mode"),
      ref("geo-eligibility"), ref("geo-travel"),
    ],
    roleCandidates: [candidate({ title: "Remote engineer" }, "geo-role")],
    locationCandidates: [candidate({ countryCode: "ES", rawText: "Spain" }, "geo-location")],
    workModeCandidates: [candidate("REMOTE", "geo-mode")],
    remoteEligibleCountryCandidates: [candidate(["ES", "FR"], "geo-eligibility")],
    travelCandidates: [candidate({ requirement: "REQUIRED", scopeText: "Europe" }, "geo-travel")],
  });
}

function makeVacancy(
  suffix: string,
  overrides: Partial<CanonicalizeVacancyInput>,
): CanonicalVacancy {
  return canonicalizer.canonicalize({
    id: `canonical-${suffix}`,
    sourceObservationIds: ["observation-1"],
    evidenceReferences: [],
    derivation,
    ...overrides,
  });
}

function ref(id: string, sourceObservationId = "observation-1") {
  return { id, sourceObservationId, kind: "REPOSITORY_TEST_EVIDENCE" };
}

function candidate<T>(value: T, ...supportingEvidenceIds: string[]) {
  return { value, supportingEvidenceIds };
}

function relationship(
  role: "EMPLOYER" | "RECRUITER",
  evidenceId: string,
  anchor: { readonly rawName?: string; readonly employerClusterId?: string },
) {
  return {
    ...anchor,
    role,
    supportingEvidenceIds: [evidenceId],
    derivation,
  };
}
