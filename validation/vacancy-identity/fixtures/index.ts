import type { VacancyIdentityValidationFixture } from "../types.js";

const observedAt = new Date("2026-09-01T08:00:00.000Z");

function fixture(
  input: Omit<VacancyIdentityValidationFixture, "observedAt" | "metadata">,
): VacancyIdentityValidationFixture {
  return { ...input, observedAt, metadata: {} };
}

export const vacancyIdentityValidationFixtures: readonly VacancyIdentityValidationFixture[] = [
  fixture({
    id: "v01-capture-a",
    source: { sourceType: "JOB_BOARD", sourceName: "Indeed", externalId: "d559a370adf21f3b" },
    title: "Technicien de maintenance industrielle 5X8 H/F",
    displayedCompanyName: "Le Recrutement Industriel",
    locationText: "Strasbourg",
  }),
  fixture({
    id: "v01-capture-b",
    source: { sourceType: "JOB_BOARD", sourceName: "Indeed", externalId: "d559a370adf21f3b" },
    title: "Technicien de maintenance industrielle 5X8 H/F",
    displayedCompanyName: "Le Recrutement Industriel",
    locationText: "Strasbourg",
  }),
  fixture({
    id: "v02-capture-a",
    source: { sourceType: "JOB_BOARD", sourceName: "Indeed", externalId: "4954bf2d3234bee8" },
    title: "Technicien de maintenance",
    displayedCompanyName: "Schindler France",
  }),
  fixture({
    id: "v02-capture-b",
    source: { sourceType: "JOB_BOARD", sourceName: "Indeed", externalId: "4954bf2d3234bee8" },
    title: "Technicien de maintenance",
    displayedCompanyName: "Schindler France",
  }),
];
