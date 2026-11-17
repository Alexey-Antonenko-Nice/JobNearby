export const vacancyPriorities = ["NONE", "LOW", "NORMAL", "HIGH"] as const;
export type VacancyPriority = typeof vacancyPriorities[number];
/** Private user intent, independent of application state, archive, recognition,
 * next actions and interaction history. Notes never enter evidence extraction. */
export interface VacancyNote {
  readonly id: string;
  readonly canonicalVacancyId: string;
  readonly text: string;
  readonly createdAt: Date;
}
export interface VacancyCrmState {
  readonly priority: VacancyPriority;
  readonly notes: readonly VacancyNote[];
}
export interface VacancyCrmRepository {
  get(canonicalVacancyId: string): Promise<VacancyCrmState>;
  setPriority(canonicalVacancyId: string, priority: VacancyPriority): Promise<void>;
  addNote(note: VacancyNote): Promise<void>;
}
export class VacancyCrmError extends Error {
  constructor(message: string, readonly status: 400 | 404 | 409) { super(message); }
}
export function validatePriority(value: unknown): asserts value is VacancyPriority {
  if (!vacancyPriorities.includes(value as VacancyPriority)) throw new VacancyCrmError("Choose NONE, LOW, NORMAL or HIGH priority.", 400);
}
export function validateNote(note: VacancyNote): void {
  if (!note.id.trim() || note.id.length > 200 || !note.canonicalVacancyId.trim()) throw new VacancyCrmError("Note identity is invalid.", 400);
  if (!note.text.trim() || note.text.length > 10000) throw new VacancyCrmError("A note must contain 1 to 10000 characters.", 400);
  if (!Number.isFinite(note.createdAt.getTime())) throw new VacancyCrmError("Note date is invalid.", 400);
}
