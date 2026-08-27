import type { SourceObservation } from "../../src/domain/capture/SourceObservation.js";
import type { VacancyIdentityMatch } from "../../src/domain/vacancy-identity/VacancyIdentityComparison.js";

export interface VacancyIdentityValidationCase {
  readonly caseId: "V01" | "V02";
  readonly observationIds: readonly [string, string];
  readonly expectedResult: VacancyIdentityMatch;
  readonly humanExplanation: string;
}

export type VacancyIdentityValidationFixture = SourceObservation;
