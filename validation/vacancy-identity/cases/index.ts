import type { VacancyIdentityValidationCase } from "../types.js";

export const vacancyIdentityValidationCases: readonly VacancyIdentityValidationCase[] = [
  {
    caseId: "V01",
    observationIds: ["v01-capture-a", "v01-capture-b"],
    expectedResult: "SAME_VACANCY",
    humanExplanation: "Two independent Indeed captures retain the same provider-scoped external vacancy identifier for the same sanitized industrial-maintenance publication.",
  },
  {
    caseId: "V02",
    observationIds: ["v02-capture-a", "v02-capture-b"],
    expectedResult: "SAME_VACANCY",
    humanExplanation: "Two independent Indeed captures retain the same provider-scoped external vacancy identifier for the same sanitized Schindler France maintenance publication.",
  },
];
