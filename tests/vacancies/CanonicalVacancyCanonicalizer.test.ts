import { describe, expect, it } from "vitest";

import type { SourceObservation } from "../../src/domain/capture/SourceObservation.js";
import type { OrganizationEvidenceRole } from "../../src/domain/evidence/OrganizationEvidence.js";
import type { EmployerClusterStatus } from "../../src/domain/recognition/EmployerCluster.js";
import type { CanonicalEvidenceReference } from "../../src/domain/vacancies/CanonicalEvidenceReference.js";
import type { VacancyOrganizationRelationship } from "../../src/domain/vacancies/CanonicalVacancy.js";
import type { CanonicalCandidate, CanonicalizeVacancyInput } from "../../src/application/vacancies/CanonicalVacancyCanonicalizer.js";
import { DeterministicCanonicalVacancyCanonicalizer } from "../../src/application/vacancies/DeterministicCanonicalVacancyCanonicalizer.js";

const canonicalizer = new DeterministicCanonicalVacancyCanonicalizer();
const derivation = {
  algorithm: "normalized-candidate-resolution",
  algorithmVersion: "1.0.0",
  derivedAt: new Date("2026-08-28T08:00:00.000Z"),
};

function reference(id: string, observationId = "observation-1"): CanonicalEvidenceReference {
  return { id, sourceObservationId: observationId, kind: "NORMALIZED_TEST_FACT" };
}

function candidate<T>(value: T, ...supportingEvidenceIds: string[]): CanonicalCandidate<T> {
  return { value, supportingEvidenceIds };
}

function relationship(
  role: VacancyOrganizationRelationship["role"],
  rawName: string,
  evidenceId: string,
  extra: Partial<VacancyOrganizationRelationship> = {},
): VacancyOrganizationRelationship {
  return {
    rawName,
    role,
    supportingEvidenceIds: [evidenceId],
    derivation,
    ...extra,
  };
}

function input(
  overrides: Partial<CanonicalizeVacancyInput> = {},
): CanonicalizeVacancyInput {
  return {
    id: "canonical-vacancy-1",
    sourceObservationIds: ["observation-1"],
    evidenceReferences: [reference("role")],
    roleCandidates: [candidate({ title: "Maintenance technician" }, "role")],
    derivation,
    ...overrides,
  };
}

describe("DeterministicCanonicalVacancyCanonicalizer validation scenarios", () => {
  it("represents HEUFT employer, CDI, base location, and extensive travel independently", () => {
    const evidenceReferences = ["role", "employer", "engagement", "travel", "location", "work-mode"].map((id) => reference(id));
    const vacancy = canonicalizer.canonicalize(input({
      evidenceReferences,
      organizationRelationships: [relationship("EMPLOYER", "HEUFT", "employer")],
      engagementCandidates: [candidate({ rawTerms: ["CDI"], normalizedTerms: ["PERMANENT_EMPLOYMENT"] }, "engagement")],
      travelCandidates: [candidate({ requirement: "REQUIRED", frequencyText: "extensive" }, "travel")],
      locationCandidates: [candidate({ rawText: "Brumath", city: "Brumath", countryCode: "FR" }, "location")],
      workModeCandidates: [candidate("ON_SITE", "work-mode")],
    }));
    expect(vacancy.organizationRelationships[0]).toMatchObject({ role: "EMPLOYER", rawName: "HEUFT" });
    expect(vacancy.engagement.value?.rawTerms).toEqual(["CDI"]);
    expect(vacancy.travel.value).toEqual({ requirement: "REQUIRED", frequencyText: "extensive" });
    expect(vacancy.workMode.value).toBe("ON_SITE");
    expect(vacancy.canonicalizationStatus).toBe("USABLE");
  });

  it("keeps ADSEARCH and Skayl recruiter relationships separate from unresolved employers", () => {
    for (const recruiter of ["ADSEARCH", "Skayl"]) {
      const vacancy = canonicalizer.canonicalize(input({
        evidenceReferences: [reference("role"), reference("recruiter"), reference("employer")],
        organizationRelationships: [
          relationship("RECRUITER", recruiter, "recruiter"),
          relationship("EMPLOYER", "Unresolved employer", "employer", { employerClusterId: "unresolved-cluster-17" }),
        ],
      }));
      expect(vacancy.organizationRelationships).toEqual([
        expect.objectContaining({ role: "RECRUITER", rawName: recruiter }),
        expect.objectContaining({ role: "EMPLOYER", employerClusterId: "unresolved-cluster-17" }),
      ]);
      expect(vacancy.organizationRelationships).not.toContainEqual(
        expect.objectContaining({ role: "EMPLOYER", rawName: recruiter }),
      );
    }
  });

  it("keeps TE publication language separate from working-language requirements", () => {
    const vacancy = canonicalizer.canonicalize(input({
      evidenceReferences: [reference("role"), reference("publication-language"), reference("language-requirements")],
      publicationLanguageCandidates: [candidate(["German"], "publication-language")],
      languageRequirementCandidates: [candidate([
        { language: "English", requirement: "REQUIRED" },
        { language: "German", requirement: "PREFERRED" },
      ], "language-requirements")],
    }));
    expect(vacancy.publicationLanguages.value).toEqual(["German"]);
    expect(vacancy.languageRequirements.value).toEqual([
      { language: "English", requirement: "REQUIRED" },
      { language: "German", requirement: "PREFERRED" },
    ]);
  });

  it("represents Oxigent Spain location and REMOTE mode without inventing eligibility", () => {
    const vacancy = canonicalizer.canonicalize(input({
      evidenceReferences: [reference("role"), reference("location"), reference("work-mode")],
      locationCandidates: [candidate({ countryCode: "ES", rawText: "Spain" }, "location")],
      workModeCandidates: [candidate("REMOTE", "work-mode")],
    }));
    expect(vacancy.location.value).toMatchObject({ countryCode: "ES" });
    expect(vacancy.workMode.value).toBe("REMOTE");
    expect(vacancy.remoteEligibleCountries.status).toBe("UNKNOWN");
    expect("value" in vacancy.remoteEligibleCountries).toBe(false);
  });

  it("preserves Brightsmith work-mode and engagement conflicts", () => {
    const vacancy = canonicalizer.canonicalize(input({
      evidenceReferences: [reference("role"), reference("hybrid"), reference("on-site"), reference("cdd"), reference("freelance")],
      workModeCandidates: [candidate("HYBRID", "hybrid"), candidate("ON_SITE", "on-site")],
      engagementCandidates: [
        candidate({ rawTerms: ["CDD"], normalizedTerms: ["FIXED_TERM_EMPLOYMENT"] }, "cdd"),
        candidate({ rawTerms: ["freelance"], normalizedTerms: ["FREELANCE"] }, "freelance"),
      ],
    }));
    expect(vacancy.workMode.status).toBe("CONFLICTED");
    expect(vacancy.workMode.alternatives?.map(({ value }) => value)).toEqual(["HYBRID", "ON_SITE"]);
    expect(vacancy.engagement.status).toBe("CONFLICTED");
    expect(vacancy.engagement.conflictingEvidenceIds).toEqual(["cdd", "freelance"]);
    expect(vacancy.canonicalizationStatus).toBe("CONFLICTED");
  });

  it("keeps AbbVie functional and industry contexts distinct", () => {
    const vacancy = canonicalizer.canonicalize(input({
      evidenceReferences: [reference("role"), reference("function"), reference("industry")],
      functionalContextCandidates: [candidate(["maintenance", "automation", "commissioning"], "function")],
      industryContextCandidates: [candidate(["pharmaceutical"], "industry")],
    }));
    expect(vacancy.functionalContexts.value).toEqual(["maintenance", "automation", "commissioning"]);
    expect(vacancy.industryContexts.value).toEqual(["pharmaceutical"]);
  });

  it("represents Akkodis consultancy and client without creating an employer", () => {
    const vacancy = canonicalizer.canonicalize(input({
      evidenceReferences: [reference("role"), reference("consultancy"), reference("client")],
      organizationRelationships: [
        relationship("CONSULTANCY", "Akkodis", "consultancy"),
        relationship("CLIENT", "Client organization", "client"),
      ],
    }));
    expect(vacancy.organizationRelationships.map(({ role }) => role)).toEqual(["CONSULTANCY", "CLIENT"]);
    expect(vacancy.organizationRelationships.some(({ role }) => role === "EMPLOYER")).toBe(false);
  });

  it("represents Vulcain on-site work and European travel independently", () => {
    const vacancy = canonicalizer.canonicalize(input({
      evidenceReferences: [reference("role"), reference("work-mode"), reference("travel")],
      workModeCandidates: [candidate("ON_SITE", "work-mode")],
      travelCandidates: [candidate({ requirement: "REQUIRED", scopeText: "Europe" }, "travel")],
    }));
    expect(vacancy.workMode.value).toBe("ON_SITE");
    expect(vacancy.travel.value).toEqual({ requirement: "REQUIRED", scopeText: "Europe" });
  });
});

describe("CanonicalVacancy invariants and compatibility", () => {
  it("does not mutate observations or canonicalization input", () => {
    const observation: SourceObservation = {
      id: "observation-1",
      source: { sourceType: "JOB_BOARD", sourceName: "Indeed", externalId: "provider-id" },
      observedAt: new Date("2026-08-28T00:00:00.000Z"),
      title: "Original title",
      metadata: {},
    };
    const canonicalizeInput = input();
    const snapshot = JSON.stringify({ observation, canonicalizeInput });
    const vacancy = canonicalizer.canonicalize(canonicalizeInput);
    expect(JSON.stringify({ observation, canonicalizeInput })).toBe(snapshot);
    expect(vacancy.id).toBe("canonical-vacancy-1");
    expect(vacancy.id).not.toBe(observation.source.externalId);
  });

  it("requires every derived fact to trace to supplied evidence and an included observation", () => {
    expect(() => canonicalizer.canonicalize(input({
      roleCandidates: [candidate({ title: "Role" }, "missing")],
    }))).toThrow(/supplied evidence/u);
    expect(() => canonicalizer.canonicalize(input({
      evidenceReferences: [reference("role", "other-observation")],
    }))).toThrow(/supplied source observation/u);
  });

  it("requires an evidence-backed organization anchor", () => {
    expect(() => canonicalizer.canonicalize(input({
      organizationRelationships: [{ role: "EMPLOYER", supportingEvidenceIds: ["role"], derivation }],
    }))).toThrow(/organization anchor/u);
  });

  it("works without resolved employer identity and without optional enrichment", () => {
    const vacancy = canonicalizer.canonicalize(input());
    expect(vacancy.canonicalizationStatus).toBe("USABLE");
    expect(vacancy.organizationRelationships).toEqual([]);
  });

  it("contains neither CRM state nor a universal shortage Boolean", () => {
    const vacancy = canonicalizer.canonicalize(input());
    expect(Object.keys(vacancy)).not.toEqual(
      expect.arrayContaining(["applicationStatus", "appliedAt", "interviews", "notes", "shortageOccupation", "metierEnTension"]),
    );
  });

  it("leaves M3 type vocabularies unchanged", () => {
    const organizationRoles: readonly OrganizationEvidenceRole[] = [
      "EMPLOYER", "RECRUITMENT_AGENCY", "STAFFING_AGENCY", "PUBLISHER", "UNKNOWN",
    ];
    const clusterStatuses: readonly EmployerClusterStatus[] = [
      "UNRESOLVED", "PROBABLY_RESOLVED", "RESOLVED", "CONFLICTED",
    ];
    expect(organizationRoles).toHaveLength(5);
    expect(clusterStatuses).toHaveLength(4);
  });
});
