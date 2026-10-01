import type { UserVacancyInteractionType } from "./UserVacancyInteractionEvent.js";

/** Factual private action history for the current effective employer; current vacancy excluded. */
export interface EmployerActionContext {
  readonly knownEmployer: true;
  readonly appliedBefore: boolean;
  readonly applicationCount: number;
  readonly contactedBefore: boolean;
  readonly contactCount: number;
  readonly interviewedBefore: boolean;
  readonly interviewCount: number;
  readonly offeredBefore: boolean;
  readonly offerCount: number;
  readonly rejectedBefore: boolean;
  readonly rejectionCount: number;
  readonly withdrawnBefore: boolean;
  readonly withdrawalCount: number;
  readonly lastApplicationAt: Date | null;
  readonly lastInteractionAt: Date | null;
  readonly lastInteractionType: UserVacancyInteractionType | null;
}
