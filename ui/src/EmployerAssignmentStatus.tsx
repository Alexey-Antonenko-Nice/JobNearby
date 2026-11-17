import type { EmployerDisplayState } from "../../src/domain/user/EmployerDisplayState.js";

const labels: Record<EmployerDisplayState, string> = {
  HUMAN_CONFIRMED: "Confirmed for this vacancy",
  MEMORY_REUSED: "Recognized from prior employer knowledge",
  INFERRED: "Automatically recognized",
  UNRESOLVED: "Employer not identified",
  REVIEW_REQUIRED: "Employer needs review",
};

const descriptions: Record<EmployerDisplayState, string> = {
  HUMAN_CONFIRMED: "You confirmed this employer role for this vacancy.",
  MEMORY_REUSED: "Recognized from prior employer knowledge. Not yet confirmed for this vacancy.",
  INFERRED: "Automatically recognized. Not yet confirmed for this vacancy.",
  UNRESOLVED: "No employer has been identified from the available information.",
  REVIEW_REQUIRED: "Employer candidates need review; no candidate is selected here.",
};

export function EmployerAssignmentStatus({ state, name, compact = false }: {
  readonly state: EmployerDisplayState;
  readonly name: string | null;
  readonly compact?: boolean;
}): React.JSX.Element {
  const summary = <><strong>{name ? `${state === "UNRESOLVED" ? "Displayed company: " : state === "REVIEW_REQUIRED" ? "Candidate: " : ""}${name} — ` : ""}{labels[state]}</strong>{!compact && <p>{state === "UNRESOLVED" && name
    ? `This is a displayed company name, not a confirmed employer for this vacancy.`
    : descriptions[state]}</p>}</>;
  return compact
    ? <p><strong>Employer:</strong> {summary}</p>
    : <section aria-label="Employer status"><h2>Employer</h2>{summary}</section>;
}

/** Copy only: the caller supplies the shared presentation state. */
export function employerRoleAction(state: EmployerDisplayState, name?: string): string {
  return state === "HUMAN_CONFIRMED"
    ? name ? `Change employer to ${name}` : "Change employer for this vacancy"
    : "Confirm as employer for this vacancy";
}
