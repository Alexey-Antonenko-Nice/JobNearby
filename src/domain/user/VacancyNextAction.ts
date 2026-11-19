import { validateContactId, type ResolvedContact } from "./Contact.js";
import { VacancyCrmError } from "./VacancyCrm.js";

export type ActionCommand =
  | { kind: "CREATE"; contactId?:string; description: string; dueAt: string | null }
  | { kind: "COMPLETE" | "CANCEL" }
  | { kind: "RESCHEDULE"; dueAt: string | null }
  | { kind: "SET_REMINDER"; remindAt: string }
  | { kind: "DISMISS_REMINDER"; reminderId: string };
export type ActionRequest = ActionCommand & {
  canonicalVacancyId: string; actionId: string; requestId: string;
};
export interface ActionChange {
  readonly id: string;
  readonly kind: ActionCommand["kind"];
  readonly createdAt: Date;
  readonly dueAt: Date | null;
  readonly remindAt: Date | null;
  readonly reminderId: string | null;
}
export interface VacancyActionReminder {
  readonly id: string;
  readonly actionId: string;
  readonly remindAt: Date;
  readonly createdAt: Date;
  readonly dismissedAt: Date | null;
  readonly supersededAt: Date | null;
}
export interface VacancyNextAction {
  readonly contactId?:string;
  readonly contact?:ResolvedContact;
  readonly id: string;
  readonly canonicalVacancyId: string;
  readonly description: string;
  readonly createdAt: Date;
  readonly dueAt: Date | null;
  readonly completedAt: Date | null;
  readonly cancelledAt: Date | null;
  readonly reminders: readonly VacancyActionReminder[];
  readonly changes: readonly ActionChange[];
}
export interface NextActionView extends VacancyNextAction {
  readonly status: "ACTIVE" | "COMPLETED" | "CANCELLED";
  readonly dueState: "NONE" | "UPCOMING" | "DUE" | "OVERDUE" | "INACTIVE";
  readonly reminderDue: boolean;
}
export interface NextActionsView {
  readonly evaluatedAt: Date;
  readonly actions: readonly NextActionView[];
  readonly overdueCount: number;
}
/** Read-time only: no timers, notifications, process transitions or interactions. */
export function deriveNextActions(actions: readonly VacancyNextAction[], now: Date): NextActionsView {
  const views: NextActionView[] = actions.map(action => {
    const status = action.completedAt ? "COMPLETED" : action.cancelledAt ? "CANCELLED" : "ACTIVE";
    const dueState = status !== "ACTIVE" ? "INACTIVE" : !action.dueAt ? "NONE"
      : action.dueAt.getTime() < now.getTime() ? "OVERDUE"
      : action.dueAt.getTime() === now.getTime() ? "DUE" : "UPCOMING";
    return {...action, status, dueState, reminderDue: status === "ACTIVE" && action.reminders.some(
      reminder => !reminder.dismissedAt && !reminder.supersededAt && reminder.remindAt <= now)};
  });
  return {evaluatedAt: now, actions: views, overdueCount: views.filter(action => action.dueState === "OVERDUE").length};
}
export function validateUtcInstant(value: unknown): asserts value is string {
  if(typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)
    || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value)
    throw new VacancyCrmError("Use a valid UTC timestamp including milliseconds and Z.",400);
}
export function validateActionRequest(input: ActionRequest): void {
  if(input.kind!=="CREATE" && "contactId" in input)throw new VacancyCrmError("Action contact is fixed at creation.",400);
  for(const value of [input.canonicalVacancyId,input.actionId,input.requestId])
    if(typeof value !== "string" || !value.trim() || value.length > 200) throw new VacancyCrmError("Action request identity is invalid.",400);
  if(input.kind === "CREATE") {
    if(input.contactId!==undefined)validateContactId(input.contactId);
    if(typeof input.description !== "string" || !input.description.trim() || input.description.length > 2000)
      throw new VacancyCrmError("An action needs 1 to 2000 characters.",400);
    if(input.actionId !== input.requestId) throw new VacancyCrmError("Creation identity must match its request ID.",400);
  }
  if(input.kind === "CREATE" || input.kind === "RESCHEDULE") {
    if(input.dueAt !== null) validateUtcInstant(input.dueAt);
  } else if(input.kind === "SET_REMINDER") validateUtcInstant(input.remindAt);
  else if(input.kind === "DISMISS_REMINDER") {
    if(typeof input.reminderId !== "string" || !input.reminderId.trim()) throw new VacancyCrmError("Choose a reminder.",400);
  } else if(input.kind !== "COMPLETE" && input.kind !== "CANCEL") throw new VacancyCrmError("Unknown action command.",400);
}
