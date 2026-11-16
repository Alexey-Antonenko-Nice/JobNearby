import type { EmployerDisplayState } from "../../src/domain/user/EmployerDisplayState.js";

const labels: Record<EmployerDisplayState, string> = {
  HUMAN_CONFIRMED: "Confirmed by you",
  MEMORY_REUSED: "Recognized from previous confirmation",
  INFERRED: "Automatically recognized",
  UNRESOLVED: "Employer not confirmed yet",
  REVIEW_REQUIRED: "Employer needs review",
};

const descriptions: Record<EmployerDisplayState, string> = {
  HUMAN_CONFIRMED: "You confirmed this employer role for this vacancy.",
  MEMORY_REUSED: "This association came from a previous employer confirmation; you have not confirmed the employer role for this vacancy.",
  INFERRED: "This employer match was made automatically, not confirmed by you.",
  UNRESOLVED: "No employer role has been confirmed for this vacancy.",
  REVIEW_REQUIRED: "The employer assignment has conflicting or ambiguous evidence.",
};

export function EmployerAssignmentStatus({ state, name, compact = false }: {
  readonly state: EmployerDisplayState;
  readonly name: string | null;
  readonly compact?: boolean;
}): React.JSX.Element {
  const summary = <><strong>{name ? `${name} — ` : ""}{labels[state]}</strong>{!compact && <p>{state === "UNRESOLVED" && name
    ? `The company name was observed, but its employer role has not been confirmed.`
    : descriptions[state]}</p>}</>;
  return compact
    ? <p><strong>Employer:</strong> {summary}</p>
    : <section aria-label="Employer status"><h2>Employer</h2>{summary}</section>;
}
