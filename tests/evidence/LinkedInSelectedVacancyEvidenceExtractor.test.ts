import { describe, expect, it } from "vitest";
import { createVacancyEvidenceExtractor } from "../../src/application/evidence/createVacancyEvidenceExtractor.js";
import { ExistingPipelineCanonicalVacancyAdapter } from "../../src/application/vacancies/ExistingPipelineCanonicalVacancyAdapter.js";
import { DeterministicCanonicalVacancyCanonicalizer } from "../../src/application/vacancies/DeterministicCanonicalVacancyCanonicalizer.js";
import { employerConfirmationCandidate } from "../../src/application/user/employerConfirmation.js";
import { createEmployerCluster } from "../../src/application/recognition/createEmployerCluster.js";
import type { SourceObservation } from "../../src/domain/capture/SourceObservation.js";
import { fromSelectedVacancyContext } from "../../src/domain/evidence/VacancyEvidenceInput.js";

function observation(text: string): SourceObservation { return { id: "linkedin", source: { sourceType: "JOB_BOARD", sourceName: "linkedin.com", sourceUrl: "https://www.linkedin.com/jobs/view/4461178074/x", externalId: "4461178074" }, observedAt: new Date("2026-09-06T12:00:00Z"), metadata: {} }; }

describe("LinkedIn direct selected header evidence", () => {
  it("extracts Manpower header facts and staffing contradiction", async () => {
    const text = "ManpowerGroup\nTechnicien maintenance/Technicienne maintenance\nStrasbourg, Grand Est, France · il y a 2 jours\nSur site\nTemps plein\nÀ propos de l’offre d’emploi\nManpower Cabinet de Recrutement de Strasbourg recherche pour son client un technicien.";
    const o = observation(text); const context = fromSelectedVacancyContext(o, { kind: "SELECTED_VACANCY", associationMethod: "PROVIDER_LOCATOR", providerKey: "LINKEDIN", providerExternalId: "4461178074", text, html: `<section data-linkedin-selected-vacancy-context="direct-view">${text}</section>`, associationEvidence: ["fixture"] });
    const e = await createVacancyEvidenceExtractor().extract(context);
    expect(e.vacancyTitles).toEqual([expect.objectContaining({ value: "Technicien maintenance/Technicienne maintenance" })]);
    expect(e.locations).toEqual([expect.objectContaining({ value: "Strasbourg, Grand Est, France" })]);
    expect(e.organizations).toEqual(expect.arrayContaining([expect.objectContaining({ value: "ManpowerGroup", role: "STAFFING_AGENCY" })]));
  });

  it("keeps a direct LinkedIn company eligible without staffing wording", async () => {
    const text = "Company X\nTechnicien maintenance H/F\nStrasbourg, Grand Est, France\nÀ propos de l’offre d’emploi\nDescription";
    const o = observation(text); const context = fromSelectedVacancyContext(o, { kind: "SELECTED_VACANCY", associationMethod: "PROVIDER_LOCATOR", providerKey: "LINKEDIN", providerExternalId: "4461178074", text, html: `<section data-linkedin-selected-vacancy-context="direct-view">${text}</section>`, associationEvidence: ["fixture"] });
    const e = await createVacancyEvidenceExtractor().extract(context);
    expect(e.organizations).toEqual(expect.arrayContaining([
      expect.objectContaining({ value: "Company X", role: "DISPLAYED_COMPANY" }),
    ]));
    expect(e.organizations).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ value: "Company X", role: "STAFFING_AGENCY" }),
    ]));
  });

  it("extracts Eurofirms search-results header facts without promoting the intermediary to employer", async () => {
    const text = [
      "Eurofirms Group | People first",
      "Ingénieur Méthodes Industrialisation H/F",
      "Toulouse, Occitanie, France · il y a 2 jours",
      "39K € par yr - 42K € par yr Sur site Temps plein",
      "À propos de l’offre d’emploi",
      "Eurofirms est spécialisée dans l’intérim, le recrutement, l’outsourcing, le headhunting et l’executive search.",
      "Notre client recherche un ingénieur. Budget d’investissement de 2M€ et 77 candidats.",
    ].join("\n");
    const o = observation(text);
    const context = fromSelectedVacancyContext(o, {
      kind: "SELECTED_VACANCY",
      associationMethod: "PROVIDER_LOCATOR",
      providerKey: "LINKEDIN",
      providerExternalId: "4473114996",
      text,
      html: `<section data-linkedin-selected-vacancy-context="search-results">${text}</section>`,
      associationEvidence: ["fixture"],
    });
    const extractor = createVacancyEvidenceExtractor();
    const evidence = await extractor.extract(context);

    expect(evidence.vacancyTitles).toEqual(expect.arrayContaining([
      expect.objectContaining({ value: "Ingénieur Méthodes Industrialisation H/F" }),
    ]));
    expect(evidence.locations).toEqual(expect.arrayContaining([
      expect.objectContaining({ value: "Toulouse, Occitanie, France", role: "WORKPLACE" }),
    ]));
    expect(evidence.engagements).toEqual(expect.arrayContaining([
      expect.objectContaining({ normalizedTerms: ["FULL_TIME"] }),
    ]));
    expect(evidence.workModes).toEqual([
      expect.objectContaining({
        value: "ON_SITE",
        provenance: expect.objectContaining({
          sourceObservationId: "linkedin",
          contentOrigin: "SELECTED_VACANCY_CONTEXT",
        }),
      }),
    ]);
    expect(evidence.compensations).toEqual([
      expect.objectContaining({
        rawText: "39K € par yr - 42K € par yr",
        currency: "EUR",
        minimum: 39000,
        maximum: 42000,
        period: "YEAR",
        provenance: expect.objectContaining({
          sourceObservationId: "linkedin",
          contentOrigin: "SELECTED_VACANCY_CONTEXT",
        }),
      }),
    ]);
    expect(evidence.organizations).toEqual(expect.arrayContaining([
      expect.objectContaining({ value: "Eurofirms Group | People first", role: "DISPLAYED_COMPANY" }),
      expect.objectContaining({ value: "Eurofirms Group | People first", role: "STAFFING_AGENCY" }),
    ]));
    expect(evidence.organizations).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ value: "Eurofirms Group | People first", role: "EMPLOYER" }),
      expect.objectContaining({ role: "CLIENT" }),
    ]));

    const canonical = new ExistingPipelineCanonicalVacancyAdapter(
      new DeterministicCanonicalVacancyCanonicalizer(),
    ).canonicalize({
      canonicalVacancyId: "canonical-linkedin-regression",
      observations: [o],
      extractedEvidence: [evidence],
      employerCluster: createEmployerCluster(
        { status: "UNRESOLVED", displayLabel: "Unknown employer — Toulouse, Occitanie, France" },
        { now: () => new Date("2026-09-08T10:00:00.000Z"), generateId: () => "anonymous-employer-cluster" },
      ),
      derivation: {
        algorithm: "normalized-candidate-resolution",
        algorithmVersion: "1.0.0",
        derivedAt: new Date("2026-09-08T10:00:00.000Z"),
      },
    });
    expect(canonical.role).toMatchObject({
      status: "RESOLVED",
      value: { title: "Ingénieur Méthodes Industrialisation H/F" },
    });
    expect(canonical.location).toMatchObject({
      status: "RESOLVED",
      value: { rawText: "Toulouse, Occitanie, France" },
    });
    expect(canonical.engagement).toMatchObject({
      status: "RESOLVED",
      value: { normalizedTerms: ["FULL_TIME"] },
    });
    expect(canonical.workMode).toMatchObject({ status: "RESOLVED", value: "ON_SITE" });
    expect(canonical.compensation).toMatchObject({
      status: "RESOLVED",
      value: { currency: "EUR", minimum: 39000, maximum: 42000, period: "YEAR" },
    });
    expect(canonical.organizationRelationships).toEqual(expect.arrayContaining([
      expect.objectContaining({ rawName: "Eurofirms Group | People first", role: "DISPLAYED_COMPANY" }),
      expect.objectContaining({ rawName: "Eurofirms Group | People first", role: "STAFFING_AGENCY" }),
      expect.objectContaining({ employerClusterId: "anonymous-employer-cluster", role: "EMPLOYER" }),
    ]));
    expect(canonical.organizationRelationships).not.toContainEqual(
      expect.objectContaining({ rawName: "Eurofirms Group | People first", role: "EMPLOYER" }),
    );
    expect(employerConfirmationCandidate(canonical.organizationRelationships)).toBeNull();
  });

  it.each([
    ["39k € par yr - 42k € par yr", 39000, 42000],
    ["39K € per year - 42K € per year", 39000, 42000],
    ["39K € par an - 42K € par an", 39000, 42000],
  ])("extracts localized LinkedIn annual compensation: %s", async (salary, minimum, maximum) => {
    const text = `Company X\nTechnicien maintenance H/F\n${salary}\nÀ propos de l’offre d’emploi`;
    const o = observation(text);
    const context = fromSelectedVacancyContext(o, {
      kind: "SELECTED_VACANCY",
      associationMethod: "PROVIDER_LOCATOR",
      providerKey: "LINKEDIN",
      text,
      html: `<section data-linkedin-selected-vacancy-context="search-results">${text}</section>`,
    });
    const result = await createVacancyEvidenceExtractor().extract(context);
    expect(result.compensations).toEqual([
      expect.objectContaining({ minimum, maximum, currency: "EUR", period: "YEAR" }),
    ]);
  });

  it("does not treat candidate counts, investment amounts, or body prose as compensation or work mode", async () => {
    const text = [
      "Company X",
      "Technicien maintenance H/F",
      "Toulouse, Occitanie, France",
      "Le site dispose de 42 machines.",
      "À propos de l’offre d’emploi",
      "77 candidats ont postulé. Budget d’investissement de 2M€. Fourchette indicative 39K € par yr - 42K € par yr.",
    ].join("\n");
    const o = observation(text);
    const context = fromSelectedVacancyContext(o, {
      kind: "SELECTED_VACANCY",
      associationMethod: "PROVIDER_LOCATOR",
      providerKey: "LINKEDIN",
      text,
      html: `<section data-linkedin-selected-vacancy-context="search-results">${text}</section>`,
    });
    const result = await createVacancyEvidenceExtractor().extract(context);
    expect(result.compensations).toEqual([]);
    expect(result.workModes).toEqual([]);
  });

  it.each([
    ["Hybride", "HYBRID"],
    ["À distance", "REMOTE"],
    ["Remote", "REMOTE"],
  ] as const)("normalizes LinkedIn header work mode %s", async (raw, expected) => {
    const text = `Company X\nTechnicien maintenance H/F\n${raw}\nÀ propos de l’offre d’emploi`;
    const o = observation(text);
    const context = fromSelectedVacancyContext(o, {
      kind: "SELECTED_VACANCY",
      associationMethod: "PROVIDER_LOCATOR",
      providerKey: "LINKEDIN",
      text,
      html: `<section data-linkedin-selected-vacancy-context="search-results">${text}</section>`,
    });
    const result = await createVacancyEvidenceExtractor().extract(context);
    expect(result.workModes).toEqual([expect.objectContaining({ value: expected })]);
  });
});
