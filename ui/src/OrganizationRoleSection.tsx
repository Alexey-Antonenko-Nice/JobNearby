import { useState } from "react";
import { decideOrganizationRole, getReview, type ReviewView } from "./api";
import type { OrganizationRoleReviewItem, HumanOrganizationRole } from "../../src/domain/organizations/VacancyOrganizationRoleDecision.js";

const label = (role: string) => role.toLowerCase().replaceAll("_", " ");
export function OrganizationRoleSection({ review, onConfirmed, disabled }: {
  readonly review: ReviewView; readonly onConfirmed: (review: ReviewView) => void; readonly disabled: boolean;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [override, setOverride] = useState<{ card: OrganizationRoleReviewItem; role: HumanOrganizationRole; warning: string } | null>(null);
  async function save(card: OrganizationRoleReviewItem, role: HumanOrganizationRole, acknowledged: boolean) {
    setPending(true); setError(null);
    try {
      onConfirmed(await decideOrganizationRole(review.vacancy.canonicalVacancyId, { requestId: crypto.randomUUID(), identityKey: card.identityKey, role, candidateToken: card.candidateToken, acknowledgeContradiction: acknowledged }));
      setOverride(null);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Unable to save organization role.");
      if ((failure as { status?: number }).status === 409) {
        setOverride(null);
        try { onConfirmed(await getReview(review.vacancy.canonicalVacancyId)); } catch { /* Keep the error visible if refresh also fails. */ }
      }
    } finally { setPending(false); }
  }
  return <section aria-label="Organization roles"><h2>Organization roles</h2>
    <p>Choose each organization’s role for this vacancy. Its role can differ in other vacancies.</p>
    {error && <p role="alert">{error}</p>}
    {review.organizationRoleReview?.map(card => <article key={card.identityKey} aria-label={card.name}>
      <h3>{card.name}</h3>
      <p>Recommended: <strong>{label(card.recommendedRole)}</strong> ({Math.round(card.confidence * 100)}% confidence)</p>
      <ul>{card.reasons.map(reason => <li key={reason}>{reason}</li>)}</ul>
      {card.confirmedRole && <p>Confirmed for this vacancy: {label(card.confirmedRole)}</p>}
      {card.history.length > 0 && <p>Previously confirmed roles: {[...new Set(card.history.map(h => label(h.role)))].join(", ")}. These roles may coexist.</p>}
      <div>{card.actions.map(action => <button key={action.role} type="button" disabled={disabled || pending || card.confirmedRole === action.role} onClick={() => {
        if (action.warning) setOverride({ card, role: action.role, warning: action.warning });
        else void save(card, action.role, false);
      }}>{card.confirmedRole === action.role ? `Confirmed as ${label(action.role)}` : `${card.recommendedRole === action.role ? "Confirm as" : "Mark as"} ${label(action.role)}`}</button>)}</div>
    </article>)}
    {override && <div role="dialog" aria-modal="true" aria-label="Confirm organization role override">
      <h3>Confirm role for {override.card.name}</h3><p>{override.warning}</p>
      <button type="button" disabled={pending} onClick={() => void save(override.card, override.role, true)}>Confirm override as {label(override.role)}</button>
      <button type="button" disabled={pending} onClick={() => setOverride(null)}>Cancel</button>
    </div>}
  </section>;
}
