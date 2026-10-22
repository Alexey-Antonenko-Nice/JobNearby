import { useState } from "react";
import { confirmRecruitingAgency, type ReviewView } from "./api";

export function RecruitingAgencySection({ review, onConfirmed, disabled }: {
  readonly review: ReviewView; readonly onConfirmed: (review: ReviewView) => void; readonly disabled: boolean;
}): React.JSX.Element | null {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const context = review.agencyContext;
  if (!context || (!context.candidates.length && !context.known.length && !context.ambiguousNames.length)) return null;
  async function confirm(candidateId: string): Promise<void> {
    setPending(true); setError(null);
    try { onConfirmed(await confirmRecruitingAgency(review.vacancy.canonicalVacancyId, candidateId)); }
    catch (error) { setError(error instanceof Error ? error.message : "Unable to confirm recruiting agency."); }
    finally { setPending(false); }
  }
  return <section aria-label="Recruiting agency"><h2>Recruiting agency</h2>
    {error && <p role="alert">{error}</p>}
    {context.known.map((agency) => <p key={agency.memoryId}><strong>{agency.name}</strong>{" — "}
      {agency.role === "STAFFING_AGENCY" ? "Staffing agency" : "Recruiter"}{" — "}
      {agency.source === "USER_CONFIRMED" ? "Confirmed" : "Recognized from confirmed agency memory"}</p>)}
    {context.candidates.map((agency) => <p key={agency.candidateId}>Agency candidate: <strong>{agency.name}</strong>{" "}
      <button type="button" disabled={disabled || pending} onClick={() => void confirm(agency.candidateId)}>Confirm as recruiting agency</button></p>)}
    {context.ambiguousNames.map((name) => <p key={name}>Agency identity needs review: {name}</p>)}
  </section>;
}
