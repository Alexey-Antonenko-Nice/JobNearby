import type { UserVacancyInteractionType } from "./UserVacancyInteractionEvent.js";

export interface VacancyContext {
  readonly currentCanonicalVacancyId: string;
  readonly seenBefore: boolean;
  readonly observationCount: number;
  readonly sourceCount: number;
  readonly sourceProviders: readonly string[];
  readonly firstSeenAt: Date | null;
  readonly lastSeenAt: Date | null;
  readonly currentSourceObservationId: string | null;
  readonly currentSourceProvider: string | null;
  readonly reviewedBefore: boolean;
  readonly interestedBefore: boolean;
  readonly appliedBefore: boolean;
  readonly contactedBefore: boolean;
  readonly interviewedBefore: boolean;
  readonly offeredBefore: boolean;
  readonly rejectedBefore: boolean;
  readonly withdrawnBefore: boolean;
  readonly closedBefore: boolean;
  readonly latestInteractionType: UserVacancyInteractionType | null;
  readonly latestInteractionAt: Date | null;
  readonly appliedViaProvider: string | null;
  readonly appliedViaSourceObservationId: string | null;
}
