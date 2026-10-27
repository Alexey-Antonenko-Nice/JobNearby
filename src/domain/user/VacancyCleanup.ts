export interface VacancyCleanupState {
  readonly canonicalVacancyId: string;
  readonly title: string | null;
  readonly archived: boolean;
  readonly token: string;
  readonly captures: readonly { id: string; title: string | null; url: string | null; observedAt: string }[];
}
export interface VacancyDeletionPreview extends VacancyCleanupState {
  readonly targetObservationId: string | null;
  readonly affected: readonly { label: string; count: number }[];
  readonly retainedSourceIds: readonly string[];
  readonly requiresHistoryAcknowledgement: boolean;
}
export interface VacancyCleanup {
  state(id: string): VacancyCleanupState;
  setArchived(id: string, archived: boolean, expectedToken: string): VacancyCleanupState;
  preview(id: string, observationId?: string): VacancyDeletionPreview;
  delete(input: { canonicalVacancyId: string; observationId?: string; token: string; confirmation: string; acknowledgeApplicationHistory: boolean }): Promise<{ deletedVacancy: boolean }>;
}
export class VacancyCleanupError extends Error {
  constructor(message: string, readonly status: 400 | 404 | 409) { super(message); }
}
