import { describe, expect, it } from "vitest";

import type { SourceObservation } from "../../src/domain/capture/SourceObservation.js";
import type { EmployerCharacteristicEvidence } from "../../src/domain/evidence/EmployerCharacteristicEvidence.js";
import { createExtractedVacancyEvidence } from "../../src/domain/evidence/ExtractedVacancyEvidence.js";
import type { LocationEvidence } from "../../src/domain/evidence/LocationEvidence.js";
import type { OrganizationEvidence } from "../../src/domain/evidence/OrganizationEvidence.js";
import type { EmployerCluster } from "../../src/domain/recognition/EmployerCluster.js";
import { DeterministicCanonicalVacancyCanonicalizer } from "../../src/application/vacancies/DeterministicCanonicalVacancyCanonicalizer.js";
import { ExistingPipelineCanonicalVacancyAdapter } from "../../src/application/vacancies/ExistingPipelineCanonicalVacancyAdapter.js";
import { ExplicitTextVacancyEvidenceExtractor } from "../../src/application/evidence/ExplicitTextVacancyEvidenceExtractor.js";
import { ExplicitCandidateRequirementsExtractor } from "../../src/application/evidence/ExplicitCandidateRequirementsExtractor.js";
import { fromSelectedVacancyContext } from "../../src/domain/evidence/VacancyEvidenceInput.js";

const adapter = new ExistingPipelineCanonicalVacancyAdapter(
  new DeterministicCanonicalVacancyCanonicalizer(),
);
const derivation = {
  algorithm: "existing-pipeline-adapter",
  algorithmVersion: "1.0.0",
  derivedAt: new Date("2026-08-28T10:00:00.000Z"),
};

function observation(
  id: string,
  overrides: Partial<SourceObservation> = {},
): SourceObservation {
  return {
    id,
    source: {
      sourceType: "JOB_BOARD",
      sourceName: "Indeed",
      externalId: `external-${id}`,
    },
    observedAt: new Date("2026-08-28T08:00:00.000Z"),
    metadata: {},
    ...overrides,
  };
}

function extracted(
  observationId: string,
  values: {
    organizations?: readonly Omit<OrganizationEvidence, "provenance">[];
    locations?: readonly Omit<LocationEvidence, "provenance">[];
    characteristics?: readonly Omit<EmployerCharacteristicEvidence, "provenance">[];
    externalId?: string;
  } = {},
) {
  const provenance = {
    sourceObservationId: observationId,
    extractionMethod: "DIRECT_FIELD" as const,
    confidence: 1,
  };
  return createExtractedVacancyEvidence({
    sourceObservationId: observationId,
    ...(values.organizations === undefined
      ? {}
      : { organizations: values.organizations.map((item) => ({ ...item, provenance })) }),
    ...(values.locations === undefined
      ? {}
      : { locations: values.locations.map((item) => ({ ...item, provenance })) }),
    ...(values.characteristics === undefined
      ? {}
      : {
          employerCharacteristics: values.characteristics.map((item) => ({
            ...item,
            provenance: { ...provenance, extractionMethod: "TEXT_EXTRACTION" as const, confidence: 0.98 },
          })),
        }),
    ...(values.externalId === undefined
      ? {}
      : {
          externalIdentifiers: [{
            value: values.externalId,
            provider: "Indeed",
            identifierType: "SOURCE_EXTERNAL_ID",
            provenance,
          }],
        }),
  });
}

function canonicalize(
  observations: readonly SourceObservation[],
  extractedEvidence = observations.map(({ id }) => extracted(id)),
  employerCluster?: EmployerCluster,
) {
  return adapter.canonicalize({
    canonicalVacancyId: "canonical-vacancy-42",
    observations,
    extractedEvidence,
    ...(employerCluster === undefined ? {} : { employerCluster }),
    derivation,
  });
}

describe("ExistingPipelineCanonicalVacancyAdapter", () => {
  it("maps explicit employers and never promotes recruiters or staffing agencies", () => {
    const vacancy = canonicalize(
      [observation("one")],
      [extracted("one", {
        organizations: [
          { value: "HEUFT France", role: "EMPLOYER" },
          { value: "ADSEARCH", role: "RECRUITMENT_AGENCY" },
          { value: "Temporary Work", role: "STAFFING_AGENCY" },
          { value: "Akkodis", role: "RECRUITER" },
          { value: "Engineering Partner", role: "CONSULTANCY" },
          { value: "Named Customer", role: "CLIENT" },
        ],
      })],
    );
    expect(vacancy.organizationRelationships).toEqual([
      expect.objectContaining({ rawName: "HEUFT France", role: "EMPLOYER" }),
      expect.objectContaining({ rawName: "ADSEARCH", role: "RECRUITER" }),
      expect.objectContaining({ rawName: "Temporary Work", role: "STAFFING_AGENCY" }),
      expect.objectContaining({ rawName: "Akkodis", role: "RECRUITER" }),
      expect.objectContaining({ rawName: "Engineering Partner", role: "CONSULTANCY" }),
      expect.objectContaining({ rawName: "Named Customer", role: "CLIENT" }),
    ]);
    expect(vacancy.organizationRelationships).not.toContainEqual(
      expect.objectContaining({ rawName: "ADSEARCH", role: "EMPLOYER" }),
    );
  });

  it("maps unknown display evidence conservatively and publisher evidence as unknown", () => {
    const vacancy = canonicalize(
      [observation("one")],
      [extracted("one", { organizations: [
        { value: "Displayed Name", role: "UNKNOWN" },
        { value: "Publication Brand", role: "PUBLISHER" },
      ] })],
    );
    expect(vacancy.organizationRelationships).toEqual([
      expect.objectContaining({ rawName: "Displayed Name", role: "DISPLAYED_COMPANY" }),
      expect.objectContaining({ rawName: "Publication Brand", role: "UNKNOWN" }),
    ]);
  });

  it("does not project a repeated vacancy title as a displayed company", async () => {
    const source = observation("one");
    const evidence = await new ExplicitTextVacancyEvidenceExtractor().extract(
      fromSelectedVacancyContext(source, {
        kind: "SELECTED_VACANCY",
        associationMethod: "PROVIDER_LOCATOR",
        text: [
          "Ingénieur Industrialisation Composants Plastiques H/F",
          "Ingénieur Industrialisation Composants Plastiques H/F",
          "67 - Strasbourg",
          "Employeur",
          "Geser Best",
          "Notre agence GESER-BEST recherche un ingénieur.",
        ].join("\n"),
      }),
    );
    const vacancy = canonicalize([source], [evidence]);

    expect(vacancy.organizationRelationships).toEqual(expect.arrayContaining([
      expect.objectContaining({ rawName: "Geser Best", role: "EMPLOYER" }),
      expect.objectContaining({ rawName: "GESER-BEST", role: "RECRUITER" }),
    ]));
    expect(vacancy.organizationRelationships).not.toContainEqual(
      expect.objectContaining({
        rawName: "Ingénieur Industrialisation Composants Plastiques H/F",
        role: "DISPLAYED_COMPANY",
      }),
    );
  });

  it("adds unresolved employer-cluster context without replacing explicit evidence", () => {
    const cluster: EmployerCluster = {
      id: "cluster-unresolved-17",
      status: "UNRESOLVED",
      createdAt: new Date("2026-08-01T00:00:00.000Z"),
      updatedAt: new Date("2026-08-01T00:00:00.000Z"),
    };
    const vacancy = canonicalize(
      [observation("one")],
      [extracted("one", { organizations: [{ value: "Named Employer", role: "EMPLOYER" }] })],
      cluster,
    );
    expect(vacancy.organizationRelationships).toEqual([
      expect.objectContaining({ rawName: "Named Employer", role: "EMPLOYER" }),
      expect.objectContaining({ employerClusterId: "cluster-unresolved-17", role: "EMPLOYER" }),
    ]);
  });

  it("resolves repeated titles and preserves conflicting titles", () => {
    const same = canonicalize([
      observation("a", { title: "Maintenance technician" }),
      observation("b", { title: "Maintenance technician" }),
    ]);
    expect(same.role).toMatchObject({
      status: "RESOLVED",
      value: { title: "Maintenance technician" },
    });
    expect(same.role.supportingEvidenceIds).toHaveLength(2);

    const conflict = canonicalize([
      observation("a", { title: "Maintenance technician" }),
      observation("b", { title: "Project manager" }),
    ]);
    expect(conflict.role.status).toBe("CONFLICTED");
    expect(conflict.role.alternatives?.map(({ value }) => value.title)).toEqual([
      "Maintenance technician",
      "Project manager",
    ]);
    expect(conflict.canonicalizationStatus).toBe("CONFLICTED");
  });

  it("prefers explicit workplace evidence and excludes recruiter/service locations", () => {
    const vacancy = canonicalize(
      [observation("one"), observation("two")],
      [
        extracted("one", { locations: [
        { value: "Brumath", role: "WORKPLACE" },
        { value: "Recruiter Paris", role: "RECRUITER_LOCATION" },
        { value: "Grand Est", role: "SERVICE_TERRITORY" },
        ] }),
        extracted("two", { locations: [
          { value: "Displayed Strasbourg", role: "DISPLAYED_LOCATION" },
        ] }),
      ],
    );
    expect(vacancy.location).toMatchObject({
      status: "RESOLVED",
      value: { rawText: "Brumath" },
    });
  });

  it("maps displayed location only as conservative raw location text", () => {
    const vacancy = canonicalize(
      [observation("one")],
      [extracted("one", { locations: [{ value: "Strasbourg", role: "DISPLAYED_LOCATION" }] })],
    );
    expect(vacancy.location.value).toEqual({ rawText: "Strasbourg" });
    expect(vacancy.location.value).not.toHaveProperty("employerLocationId");
  });

  it("preserves raw salary and contract text without numeric or term invention", () => {
    const vacancy = canonicalize([
      observation("one", {
        salaryText: "Selon profil, jusqu'à 45 k€",
        contractText: "CDD ou freelance",
      }),
    ]);
    expect(vacancy.compensation.value).toEqual({ rawText: "Selon profil, jusqu'à 45 k€" });
    expect(vacancy.compensation.value).not.toHaveProperty("minimum");
    expect(vacancy.compensation.value).not.toHaveProperty("maximum");
    expect(vacancy.engagement.value).toEqual({
      rawTerms: ["CDD ou freelance"],
      normalizedTerms: [],
    });
  });

  it("maps extracted core header facts into existing canonical fields", () => {
    const provenance = {
      sourceObservationId: "one",
      extractionMethod: "TEXT_EXTRACTION" as const,
      confidence: 0.98,
      contentOrigin: "SELECTED_VACANCY_CONTEXT" as const,
    };
    const evidence = createExtractedVacancyEvidence({
      sourceObservationId: "one",
      vacancyTitles: [{ value: "Ingénieur conception mécanique H/F", provenance }],
      engagements: [{ rawTerms: ["CDD"], normalizedTerms: ["FIXED_TERM"], provenance }],
      workModes: [{ value: "HYBRID", provenance }],
      compensations: [{
        rawText: "Salaire brut : Annuel de 42000 Euros à 46000 Euros",
        currency: "EUR",
        minimum: 42000,
        maximum: 46000,
        period: "YEAR",
        provenance,
      }],
    });

    const vacancy = canonicalize([observation("one")], [evidence]);
    expect(vacancy.role).toMatchObject({ status: "RESOLVED", value: { title: "Ingénieur conception mécanique H/F" }, confidence: 0.98 });
    expect(vacancy.engagement.value).toEqual({ rawTerms: ["CDD"], normalizedTerms: ["FIXED_TERM"] });
    expect(vacancy.workMode.value).toBe("HYBRID");
    expect(vacancy.compensation.value).toEqual({
      rawText: "Salaire brut : Annuel de 42000 Euros à 46000 Euros",
      currency: "EUR",
      minimum: 42000,
      maximum: 46000,
      period: "YEAR",
    });
  });

  it("projects explicit candidate requirements without collapsing multiple languages", async () => {
    const source = observation("one", {
      description: "English required. German preferred. 3 years of experience. frequent international travel required.",
    });
    const evidence = await new ExplicitCandidateRequirementsExtractor().extract(source);
    const vacancy = canonicalize([source], [evidence]);

    expect(vacancy.languageRequirements).toMatchObject({
      status: "RESOLVED",
      confidence: 0.98,
      value: [
        expect.objectContaining({ language: "English", requirement: "REQUIRED" }),
        expect.objectContaining({ language: "German", requirement: "PREFERRED" }),
      ],
    });
    expect(vacancy.experienceRequirements.value).toEqual([
      expect.objectContaining({ minimumYears: 3, unit: "YEAR" }),
    ]);
    expect(vacancy.travel.value).toEqual(expect.objectContaining({
      requirement: "REQUIRED", frequency: "FREQUENT", scope: "INTERNATIONAL",
      rawText: "frequent international travel required",
    }));
    expect(vacancy.evidenceReferences.map(({ kind }) => kind).filter((kind) =>
      kind.endsWith("REQUIREMENT_EVIDENCE"),
    )).toEqual(expect.arrayContaining([
      "LANGUAGE_REQUIREMENT_EVIDENCE",
      "EXPERIENCE_REQUIREMENT_EVIDENCE",
      "TRAVEL_REQUIREMENT_EVIDENCE",
    ]));
  });

  it("keeps differing requirement evidence as canonical alternatives", async () => {
    const first = observation("first", { description: "English required." });
    const second = observation("second", { description: "German preferred." });
    const requirementExtractor = new ExplicitCandidateRequirementsExtractor();
    const vacancy = canonicalize(
      [first, second],
      [await requirementExtractor.extract(first), await requirementExtractor.extract(second)],
    );
    expect(vacancy.languageRequirements.status).toBe("CONFLICTED");
    expect(vacancy.languageRequirements.alternatives).toHaveLength(2);
  });

  it("maps only industry characteristics and does not reinterpret fingerprints as requirements", () => {
    const vacancy = canonicalize(
      [observation("one")],
      [extracted("one", { characteristics: [
        { value: "pharmaceutical manufacturing", category: "INDUSTRY", specificity: "HIGH" },
        { value: "precision machining", category: "PROCESS", specificity: "HIGH" },
      ] })],
    );
    expect(vacancy.industryContexts.value).toEqual(["pharmaceutical manufacturing"]);
    expect(vacancy.functionalContexts.status).toBe("UNKNOWN");
    expect(vacancy.skillRequirements.status).toBe("UNKNOWN");
  });

  it("leaves every unsupported canonical dimension UNKNOWN", () => {
    const vacancy = canonicalize([observation("one", { title: "Technician" })]);
    for (const field of [
      vacancy.publicationLanguages,
      vacancy.workMode,
      vacancy.remoteEligibleCountries,
      vacancy.travel,
      vacancy.experienceRequirements,
      vacancy.educationRequirements,
      vacancy.skillRequirements,
      vacancy.languageRequirements,
      vacancy.functionalContexts,
      vacancy.positionCount,
      vacancy.lifecycleStatus,
    ]) {
      expect(field.status).toBe("UNKNOWN");
      expect("value" in field).toBe(false);
    }
  });

  it("retains external IDs only as traceability and never as canonical identity", () => {
    const vacancy = canonicalize(
      [observation("schindler", { title: "Maintenance technician" })],
      [extracted("schindler", { externalId: "4954bf2d3234bee8" })],
    );
    const built = adapter.buildCanonicalizeInput({
      canonicalVacancyId: "canonical-vacancy-42",
      observations: [observation("schindler")],
      extractedEvidence: [extracted("schindler", { externalId: "4954bf2d3234bee8" })],
      derivation,
    });
    expect(vacancy.id).toBe("canonical-vacancy-42");
    expect(vacancy.id).not.toBe("4954bf2d3234bee8");
    expect(built.evidenceReferences).toContainEqual(
      expect.objectContaining({ kind: "EXTERNAL_IDENTIFIER_EVIDENCE", sourceObservationId: "schindler" }),
    );
  });

  it("generates stable non-positional evidence references traceable to observations", () => {
    const input = {
      canonicalVacancyId: "canonical-vacancy-42",
      observations: [observation("known", { title: "Technician" })],
      extractedEvidence: [extracted("known", { organizations: [{ value: "Employer", role: "EMPLOYER" }] })],
      derivation,
    };
    const first = adapter.buildCanonicalizeInput(input);
    const second = adapter.buildCanonicalizeInput(input);
    expect(second.evidenceReferences).toEqual(first.evidenceReferences);
    expect(first.evidenceReferences.every(({ id }) => /^canonical-evidence-[a-f0-9]{64}$/u.test(id))).toBe(true);
    expect(first.evidenceReferences.every(({ sourceObservationId }) => sourceObservationId === "known")).toBe(true);
  });

  it("does not mutate observations, evidence, or employer clusters", () => {
    const observations = [observation("one", { title: "Technician" })];
    const evidence = [extracted("one", { organizations: [{ value: "Employer", role: "EMPLOYER" }] })];
    const cluster: EmployerCluster = {
      id: "cluster-1",
      status: "UNRESOLVED",
      createdAt: new Date("2026-08-01T00:00:00.000Z"),
      updatedAt: new Date("2026-08-01T00:00:00.000Z"),
    };
    const snapshot = JSON.stringify({ observations, evidence, cluster });
    canonicalize(observations, evidence, cluster);
    expect(JSON.stringify({ observations, evidence, cluster })).toBe(snapshot);
  });

  it("rejects evidence from observations outside the already-grouped input", () => {
    expect(() => canonicalize(
      [observation("included")],
      [extracted("outside")],
    )).toThrow(/supplied source observation/u);
  });
});
