import { describe, expect, it } from "vitest";

import type { SourceObservation } from "../../src/domain/capture/SourceObservation.js";
import { ExplicitTextVacancyEvidenceExtractor } from "../../src/application/evidence/ExplicitTextVacancyEvidenceExtractor.js";
import { fromSelectedVacancyContext } from "../../src/domain/evidence/VacancyEvidenceInput.js";

function observation(
  overrides: Partial<SourceObservation> = {},
): SourceObservation {
  return {
    id: "observation-1",
    source: { sourceType: "JOB_BOARD", sourceName: "HelloWork" },
    observedAt: new Date("2026-08-21T00:00:00.000Z"),
    metadata: {},
    ...overrides,
  };
}

describe("ExplicitTextVacancyEvidenceExtractor", () => {
  const extractor = new ExplicitTextVacancyEvidenceExtractor();

  function selectedContext(text: string) {
    return fromSelectedVacancyContext(observation(), {
      kind: "SELECTED_VACANCY",
      associationMethod: "PROVIDER_LOCATOR",
      text,
      associationEvidence: ["bounded fixture"],
    });
  }

  it("preserves explicit France Travail employer and contextual organization roles", async () => {
    const result = await extractor.extract(selectedContext([
      "Ingénieur Industrialisation Composants Plastiques H/F",
      "Ingénieur Industrialisation Composants Plastiques H/F",
      "Employeur",
      "Geser Best",
      "Notre agence GESER-BEST recherche un ingénieur.",
      "GESER-BEST accompagne les entreprises pour renforcer leurs équipes en mettant à disposition des experts qualifiés.",
      "Pour le compte de notre client, nous intervenons sur le projet.",
    ].join("\n")));

    expect(result.organizations).toEqual(expect.arrayContaining([
      expect.objectContaining({ value: "Geser Best", normalizedName: "geser best", role: "EMPLOYER" }),
      expect.objectContaining({ value: "GESER-BEST", normalizedName: "geser best", role: "RECRUITER" }),
      expect.objectContaining({ value: "GESER-BEST", normalizedName: "geser best", role: "CONSULTANCY" }),
    ]));
    expect(new Set(result.organizations.map(({ normalizedName }) => normalizedName))).toEqual(new Set(["geser best"]));
    expect(result.organizations).not.toContainEqual(expect.objectContaining({ role: "CLIENT" }));
    expect(result.organizations).not.toContainEqual(expect.objectContaining({
      value: "Ingénieur Industrialisation Composants Plastiques H/F",
    }));
    expect(result.organizations.every(({ provenance }) => provenance.contentOrigin === "SELECTED_VACANCY_CONTEXT")).toBe(true);
  });

  it.each([
    "Technicien de maintenance H/F",
    "Responsable méthodes F/H",
    "Ingénieur projet M/F",
    "Cheffe de projet F/M",
  ])("does not infer a confidently marked repeated vacancy title as a header organization: %s", async (title) => {
    const result = await extractor.extract(selectedContext([title, title, "67 - Strasbourg"].join("\n")));
    expect(result.organizations).toEqual([]);
  });

  it("preserves bounded Akkodis organization, recruitment, and consultancy context", async () => {
    const result = await extractor.extract(selectedContext([
      "Akkodis",
      "Ingénieur conception mécanique H/F",
      "Promue par un recruteur",
      "La ligne de service Consulting & Solutions d'Akkodis France renforce ses équipes et recrute un ingénieur.",
      "Akkodis recrute de nouveaux talents.",
    ].join("\n")));

    expect(result.organizations).toEqual(expect.arrayContaining([
      expect.objectContaining({ value: "Akkodis", role: "UNKNOWN" }),
      expect.objectContaining({ value: "Akkodis", role: "RECRUITER" }),
      expect.objectContaining({ value: "Akkodis France", role: "CONSULTANCY" }),
      expect.objectContaining({ value: "Akkodis France", role: "RECRUITER" }),
    ]));
    expect(result.organizations.filter(({ value, role }) => value === "Akkodis" && role === "RECRUITER")).toHaveLength(1);
    expect(result.organizations).not.toContainEqual(expect.objectContaining({ role: "CLIENT" }));
  });

  it("does not bind LinkedIn's generic recruiter promotion text to the header organization", async () => {
    const result = await extractor.extract(selectedContext([
      "Akkodis",
      "Ingénieur conception mécanique H/F",
      "Promue par un recruteur",
    ].join("\n")));
    expect(result.organizations).toContainEqual(
      expect.objectContaining({ value: "Akkodis", role: "UNKNOWN" }),
    );
    expect(result.organizations).not.toContainEqual(
      expect.objectContaining({ role: "RECRUITER" }),
    );
  });

  it("preserves an explicitly labelled named end client without inventing an employer role", async () => {
    const result = await extractor.extract(selectedContext([
      "Client final",
      "ACME Industries",
      "Le projet concerne une modernisation de ligne.",
    ].join("\n")));

    expect(result.organizations).toEqual([
      expect.objectContaining({
        value: "ACME Industries",
        normalizedName: "acme industries",
        role: "CLIENT",
      }),
    ]);
    expect(result.organizations).not.toContainEqual(
      expect.objectContaining({ role: "EMPLOYER" }),
    );
  });

  it.each([
    "Entreprise client groupe agence",
    "Notre client recherche un technicien.",
    "La marque ROBOPAC apparaît dans une description de machine.",
  ])("does not invent an organization from unbound generic or brand-like prose: %s", async (text) => {
    const result = await extractor.extract(selectedContext(text));
    expect(result.organizations).toEqual([]);
  });

  it("extracts HEUFT France as the explicitly named ACTUA client", async () => {
    const result = await extractor.extract(
      observation({
        displayedCompanyName: "ACTUA SAVERNE",
        description:
          "Nous recherchons pour l'un de nos clients, HEUFT France...",
      }),
    );

    expect(result.organizations).toContainEqual({
      value: "HEUFT France",
      role: "EMPLOYER",
      provenance: {
        sourceObservationId: "observation-1",
        extractionMethod: "TEXT_EXTRACTION",
        confidence: 0.98,
      },
    });
  });

  it("does not invent an employer from an anonymous client phrase", async () => {
    const result = await extractor.extract(
      observation({ description: "Nous recrutons pour notre client." }),
    );
    expect(result.organizations).toEqual([]);
  });

  it.each([
    "Nous recrutons pour notre client, acteur majeur du secteur industriel.",
    "Nous recherchons pour notre client une entreprise familiale locale.",
    "Mission réalisée pour le compte de notre client spécialisé en maintenance.",
    "Nous recrutons pour notre client ACME sans ponctuation fiable",
  ])("does not cross an unreliable employer-name boundary: %s", async (description) => {
    const result = await extractor.extract(observation({ description }));
    expect(result.organizations).toEqual([]);
  });

  it.each([
    ["Nous recrutons pour notre client ACME.", "ACME"],
    ["Nous recherchons pour l'un de nos clients, Blue Paper...", "Blue Paper"],
    ["Mission pour le compte de notre client Groupe SIAT; démarrage rapide.", "Groupe SIAT"],
  ])("extracts a conservatively bounded employer from %s", async (description, name) => {
    const result = await extractor.extract(observation({ description }));
    expect(result.organizations).toContainEqual(
      expect.objectContaining({ value: name, role: "EMPLOYER" }),
    );
  });

  it("classifies a displayed cabinet de recrutement conservatively", async () => {
    const result = await extractor.extract(
      observation({
        displayedCompanyName: "Cabinet Alpha",
        description: "Cabinet Alpha est un cabinet de recrutement spécialisé.",
      }),
    );
    expect(result.organizations).toContainEqual(
      expect.objectContaining({
        value: "Cabinet Alpha",
        role: "RECRUITMENT_AGENCY",
      }),
    );
  });

  it.each(["agence d'emploi", "agence d’intérim", "travail temporaire"])(
    "classifies a displayed staffing intermediary described as %s",
    async (description) => {
      const result = await extractor.extract(
        observation({
          displayedCompanyName: "ACTUA SAVERNE",
          description: `ACTUA SAVERNE est une ${description}.`,
        }),
      );
      expect(result.organizations).toContainEqual(
        expect.objectContaining({
          value: "ACTUA SAVERNE",
          role: "STAFFING_AGENCY",
        }),
      );
    },
  );

  it("classifies an explicitly named employment agency as staffing", async () => {
    const result = await extractor.extract(
      observation({
        displayedCompanyName: "Agency Alpha",
        description: "Agency Alpha is an employment agency.",
      }),
    );
    expect(result.organizations).toContainEqual(
      expect.objectContaining({
        value: "Agency Alpha",
        role: "STAFFING_AGENCY",
      }),
    );
  });

  it("accepts an explicit employment-agency self-description even when source and display names match", async () => {
    const result = await extractor.extract({
      ...observation({
        displayedCompanyName: "Agency Alpha",
        description: "Agency Alpha is an employment agency.",
      }),
      source: {
        sourceType: "RECRUITMENT_AGENCY",
        sourceName: "Agency Alpha",
      },
    });
    expect(result.organizations).toContainEqual(
      expect.objectContaining({
        value: "Agency Alpha",
        role: "STAFFING_AGENCY",
      }),
    );
  });

  it("extracts and normalizes the named recruiter Emma MICHEL", async () => {
    const result = await extractor.extract(
      observation({
        contactText: " Personne en charge du recrutement :   Emma MICHEL. ",
      }),
    );
    expect(result.people).toEqual([
      {
        value: "Emma MICHEL",
        role: "RECRUITER",
        provenance: {
          sourceObservationId: "observation-1",
          extractionMethod: "TEXT_EXTRACTION",
          confidence: 0.98,
        },
      },
    ]);
  });

  it("keeps displayed location distinct from an explicit workplace", async () => {
    const result = await extractor.extract(
      observation({
        locationText: "Strasbourg",
        description: "Le poste est basé à Molsheim.",
      }),
    );
    expect(result.locations).toEqual([
      expect.objectContaining({ value: "Molsheim", role: "WORKPLACE" }),
    ]);
    expect(result.locations).not.toContainEqual(
      expect.objectContaining({ value: "Strasbourg" }),
    );
  });

  it("extracts a clearly stated Wasselonne workplace", async () => {
    const result = await extractor.extract(
      observation({ description: "Le poste est situé à Wasselonne." }),
    );
    expect(result.locations).toEqual([
      expect.objectContaining({ value: "Wasselonne", role: "WORKPLACE" }),
    ]);
  });

  it("does not extract unrelated city mentions as workplaces", async () => {
    const result = await extractor.extract(
      observation({
        description: "Notre équipe de Strasbourg accompagne plusieurs régions.",
      }),
    );
    expect(result.locations).toEqual([]);
  });

  it("does not classify a source provider as an intermediary", async () => {
    const result = await extractor.extract(
      observation({
        displayedCompanyName: "HelloWork",
        description: "HelloWork présente une agence de recrutement partenaire.",
      }),
    );
    expect(result.organizations).toEqual([]);
  });

  it("does not associate a generic first-person intermediary phrase with the displayed organization", async () => {
    const result = await extractor.extract(
      observation({
        displayedCompanyName: "Unrelated Displayed Company",
        description: "Nous sommes une agence de recrutement à taille humaine.",
      }),
    );
    expect(result.organizations).toEqual([]);
  });

  it("classifies from the displayed organization's local description, not unrelated vocabulary", async () => {
    const result = await extractor.extract(
      observation({
        displayedCompanyName: "Cabinet Alpha",
        description: [
          "Cabinet Alpha est un cabinet de recrutement spécialisé.",
          "Le poste accompagne des équipes de travail temporaire dans une autre région et sur un autre sujet qui ne décrit pas Cabinet Alpha.",
        ].join("\n"),
      }),
    );

    expect(result.organizations).toContainEqual(
      expect.objectContaining({
        value: "Cabinet Alpha",
        role: "RECRUITMENT_AGENCY",
      }),
    );
    expect(result.organizations).not.toContainEqual(
      expect.objectContaining({
        value: "Cabinet Alpha",
        role: "STAFFING_AGENCY",
      }),
    );
  });

  it("returns multiple explicit facts with common provenance", async () => {
    const result = await extractor.extract(
      observation({
        displayedCompanyName: "ACTUA SAVERNE",
        description: [
          "ACTUA SAVERNE est une agence d'emploi.",
          "Nous recrutons pour le compte de notre client HEUFT France.",
          "Le poste est situé à Brumath.",
        ].join(" "),
        contactText: "Votre recruteur : Emma MICHEL;",
        rawContent: "Pour notre client HEUFT France...",
      }),
    );

    expect(result.sourceObservationId).toBe("observation-1");
    expect(result.organizations).toHaveLength(2);
    expect(result.locations).toHaveLength(1);
    expect(result.people).toHaveLength(1);
    const allEvidence = [
      ...result.organizations,
      ...result.locations,
      ...result.people,
    ];
    expect(
      allEvidence.every(
        ({ provenance }) =>
          provenance.sourceObservationId === "observation-1" &&
          provenance.extractionMethod === "TEXT_EXTRACTION" &&
          provenance.confidence === 0.98,
      ),
    ).toBe(true);
  });
});
