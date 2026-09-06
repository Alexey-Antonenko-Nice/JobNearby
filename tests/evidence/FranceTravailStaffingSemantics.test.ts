import { describe, expect, it } from "vitest";

import { createVacancyEvidenceExtractor } from "../../src/application/evidence/createVacancyEvidenceExtractor.js";
import { fromSelectedVacancyContext } from "../../src/domain/evidence/VacancyEvidenceInput.js";
import type { SourceObservation } from "../../src/domain/capture/SourceObservation.js";
import { employerConfirmationCandidate } from "../../src/application/user/employerConfirmation.js";

const observation: SourceObservation = {
  id: "france-travail-staffing",
  source: { sourceType: "JOB_BOARD", sourceName: "candidat.francetravail.fr", sourceUrl: "https://candidat.francetravail.fr/offres/recherche/detail/213LMMK", externalId: "213LMMK" },
  observedAt: new Date("2026-09-06T12:00:00Z"), metadata: {},
};

describe("France Travail staffing semantics", () => {
  it("does not promote agency listing metadata to an end employer", async () => {
    const context = fromSelectedVacancyContext(observation, {
      kind: "SELECTED_VACANCY", associationMethod: "PROVIDER_LOCATOR", providerKey: "FRANCE_TRAVAIL", providerExternalId: "213LMMK",
      text: "Technicien de maintenance industriel (H/F)\nSATIS JOBS CENTER INDUSTRIE recrute un Technicien de maintenance industriel (H/F) en CDI.\nSATIS JOBS CENTER INDUSTRIE COLMAR, expert(e) dans ce domaine vous propose des contrats de l'intérim au CDI.\nEmployeur\nSATIS TT COLMAR\nSecteur d'activité : Activités des agences de travail temporaire",
      html: "<section>context</section>", associationEvidence: ["fixture"],
    });
    const evidence = await createVacancyEvidenceExtractor().extract(context);
    expect(evidence.organizations).toEqual(expect.arrayContaining([
      expect.objectContaining({ value: "SATIS JOBS CENTER INDUSTRIE", role: "RECRUITER" }),
      expect.objectContaining({ value: "SATIS TT COLMAR", role: "STAFFING_AGENCY" }),
    ]));
    expect(evidence.organizations).not.toContainEqual(expect.objectContaining({ value: "SATIS TT COLMAR", role: "EMPLOYER" }));
    expect(employerConfirmationCandidate([
      { role: "DISPLAYED_COMPANY", rawName: "SATIS TT COLMAR" },
      { role: "STAFFING_AGENCY", rawName: "SATIS TT COLMAR" },
    ] as any)).toBeNull();
  });
});
