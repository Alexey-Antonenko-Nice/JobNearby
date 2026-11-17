export const vacancyPriorities = ["NONE", "LOW", "NORMAL", "HIGH"] as const;
export type VacancyPriority = typeof vacancyPriorities[number];
export const vacancyProcessStates = [
  "DISCOVERED", "REVIEWING", "PLANNED_TO_APPLY", "APPLIED", "AWAITING_RESPONSE",
  "INTERVIEWING", "OFFER", "REJECTED", "WITHDRAWN", "NO_LONGER_RELEVANT",
] as const;
export type VacancyProcessState = typeof vacancyProcessStates[number];

/** Private notes never enter vacancy evidence extraction. */
export interface VacancyNote {
  readonly id: string;
  readonly canonicalVacancyId: string;
  readonly text: string;
  readonly createdAt: Date;
}
export interface VacancyProcessTransition {
  readonly id: string;
  readonly canonicalVacancyId: string;
  readonly fromState: VacancyProcessState;
  readonly toState: VacancyProcessState;
  readonly createdAt: Date;
}
/** Private vacancy state kept separate from interaction history and employer recognition. */
export interface VacancyCrmState {
  readonly priority: VacancyPriority;
  readonly notes: readonly VacancyNote[];
  readonly processState: VacancyProcessState;
  readonly processTransitions: readonly VacancyProcessTransition[];
}
export interface VacancyCrmRepository {
  get(canonicalVacancyId: string): Promise<VacancyCrmState>;
  setPriority(canonicalVacancyId: string, priority: VacancyPriority): Promise<void>;
  addNote(note: VacancyNote): Promise<void>;
  setProcessState(input: {
    readonly canonicalVacancyId: string;
    readonly requestId: string;
    readonly state: VacancyProcessState;
    readonly createdAt: Date;
  }): Promise<void>;
}
export class VacancyCrmError extends Error {
  constructor(message: string, readonly status: 400 | 404 | 409) { super(message); }
}
export function validatePriority(value: unknown): asserts value is VacancyPriority {
  if (!vacancyPriorities.includes(value as VacancyPriority)) throw new VacancyCrmError("Choose NONE, LOW, NORMAL or HIGH priority.", 400);
}
export function validateProcessState(value: unknown): asserts value is VacancyProcessState {
  if (!vacancyProcessStates.includes(value as VacancyProcessState)) {
    throw new VacancyCrmError("Choose a valid vacancy process state.", 400);
  }
}
export function validateProcessStateChange(input: {
  readonly canonicalVacancyId: string;
  readonly requestId: string;
  readonly state: unknown;
  readonly createdAt: Date;
}): asserts input is typeof input & { readonly state: VacancyProcessState } {
  if (!input.canonicalVacancyId.trim() || !input.requestId.trim() || input.requestId.length > 200) {
    throw new VacancyCrmError("Process-state request identity is invalid.", 400);
  }
  validateProcessState(input.state);
  if (!Number.isFinite(input.createdAt.getTime())) throw new VacancyCrmError("Process-state date is invalid.", 400);
}
export function validateNote(note: VacancyNote): void {
  if (!note.id.trim() || note.id.length > 200 || !note.canonicalVacancyId.trim()) throw new VacancyCrmError("Note identity is invalid.", 400);
  if (!note.text.trim() || note.text.length > 10000) throw new VacancyCrmError("A note must contain 1 to 10000 characters.", 400);
  if (!Number.isFinite(note.createdAt.getTime())) throw new VacancyCrmError("Note date is invalid.", 400);
}
