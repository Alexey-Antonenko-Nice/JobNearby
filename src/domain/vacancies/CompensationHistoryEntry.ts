import type { VacancyCompensation } from "./CanonicalVacancy.js";

/** Read-only reconstruction from immutable snapshots, not persisted events. */
export interface CompensationHistoryEntry {
  readonly sourceObservationId: string;
  readonly observedAt: Date;
  readonly status: "RESOLVED" | "CONFLICTED";
  readonly values: readonly VacancyCompensation[];
  readonly supportingEvidenceIds: readonly string[];
}
