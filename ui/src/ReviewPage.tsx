import { useEffect, useState } from "react";

import { getReview, recordInteraction, type OrganizationRelationship, type ReviewView } from "./api";

const actions = ["REVIEWED", "INTERESTED", "APPLIED", "CONTACTED", "INTERVIEW", "OFFER", "REJECTED", "WITHDRAWN", "CLOSED"];
const organizationGroups = [
  ["Employer", "employerRelationships"], ["Displayed company", "displayedCompanies"],
  ["Recruiter", "recruiters"], ["Consultancy", "consultancies"],
  ["Staffing agency", "staffingAgencies"], ["Client", "clients"],
] as const;

export function ReviewPage(): React.JSX.Element {
  const canonicalVacancyId = reviewIdFromPath(window.location.pathname);
  const [review, setReview] = useState<ReviewView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (canonicalVacancyId === null) { setError("A canonical vacancy ID is required."); return; }
    getReview(canonicalVacancyId).then(setReview).catch((requestError: Error & { status?: number }) => {
      setNotFound(requestError.status === 404);
      setError(requestError.status === 404 ? null : "Unable to load vacancy review.");
    });
  }, [canonicalVacancyId]);

  async function submit(type: string): Promise<void> {
    if (canonicalVacancyId === null) return;
    setPending(true); setError(null);
    try { setReview(await recordInteraction(canonicalVacancyId, type)); }
    catch (requestError) {
      const message = requestError instanceof Error ? requestError.message : "Unable to record interaction.";
      setError(message || "Unable to record interaction.");
    } finally { setPending(false); }
  }

  if (notFound) return <main className="page"><p>Vacancy not found.</p></main>;
  if (error !== null && review === null) return <main className="page"><p role="alert">{error}</p></main>;
  if (review === null) return <main className="page"><p>Loading...</p></main>;

  return <main className="page">
    <a href="/">Back to inbox</a>
    <header><h1>{text(review.vacancy.title)}</h1><p>Current state: <strong>{review.user.currentState}</strong></p></header>
    {error !== null && <p className="error" role="alert">{error}</p>}
    <section><h2>Vacancy</h2><Details values={[
      ["Location", review.vacancy.location], ["Engagement", review.vacancy.engagement], ["Work mode", review.vacancy.workMode], ["Compensation", review.vacancy.compensation],
      ["Canonicalization status", review.vacancy.canonicalizationStatus], ["Latest observed date", date(review.vacancy.latestObservedAt)], ["Source observation count", review.vacancy.sourceObservationCount],
    ]} /></section>
    <section><h2>User state</h2><Details values={[["Applied before to this vacancy", yesNo(review.user.everApplied)], ["Interviewed for this vacancy", yesNo(review.user.everInterviewed)], ["Rejected for this vacancy", yesNo(review.user.everRejected)], ["Last interaction date", date(review.user.lastInteractionAt)]]} /></section>
    <section><h2>Employer memory</h2>{review.employer.employerClusterId === null ? <p>Employer unresolved / not linked</p> : <Details values={[["Employer status", review.employer.status], ["Known employer before", yesNo(review.employer.knownBefore)], ["Previous vacancies from this employer", review.employer.previousVacancyCount], ["Previous interacted vacancies", review.employer.previousInteractedVacancyCount], ["Previously applied to employer", yesNo(review.employer.everAppliedToEmployer)], ["Previously interviewed with employer", yesNo(review.employer.everInterviewedWithEmployer)], ["Previously rejected by employer", yesNo(review.employer.everRejectedByEmployer)]]} />}</section>
    <section><h2>Organization context</h2>{organizationGroups.map(([label, key]) => <Organizations key={key} label={label} values={review.organizations[key] ?? []} required={key === "employerRelationships"} />)}</section>
    <section><h2>Review signals</h2><ul className="signals">{signals(review).map((signal) => <li key={signal}>{signal}</li>)}</ul></section>
    <section><h2>Actions</h2><div className="actions">{actions.map((action) => <button key={action} type="button" disabled={pending} onClick={() => void submit(action)}>{action}</button>)}</div></section>
  </main>;
}

function Details({ values }: { readonly values: readonly [string, unknown][] }): React.JSX.Element { return <dl>{values.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{text(value)}</dd></div>)}</dl>; }
function Organizations({ label, values, required }: { readonly label: string; readonly values: readonly OrganizationRelationship[]; readonly required: boolean }): React.JSX.Element | null { if (!required && values.length === 0) return null; return <div className="organization"><h3>{label}</h3><p>{values.length === 0 ? "Unknown" : values.map((value) => value.rawName ?? value.organizationId ?? value.employerClusterId ?? "Unknown").join(", ")}</p></div>; }
function signals(review: ReviewView): string[] { const entries: [boolean, string][] = [[review.reviewSignals.isNewVacancy, "New vacancy"], [review.reviewSignals.isKnownEmployer, "Known employer"], [review.recognition.sameCanonicalVacancySeenBefore, "Same vacancy seen before"], [review.reviewSignals.hasMultipleSourceObservations, "Multiple source observations"], [review.reviewSignals.alreadyAppliedToThisVacancy, "Already applied to this vacancy"], [review.reviewSignals.previouslyAppliedToEmployer, "Previously applied to employer"], [review.reviewSignals.previouslyInterviewedWithEmployer, "Previously interviewed with employer"], [review.reviewSignals.previouslyRejectedByEmployer, "Previously rejected by employer"]]; return entries.filter(([visible]) => visible).map(([, label]) => label); }
function text(value: unknown): string { if (value === null || value === undefined || value === "") return "Unknown"; return typeof value === "object" ? JSON.stringify(value) : String(value); }
function yesNo(value: boolean): string { return value ? "yes" : "no"; }
function date(value: string | null): string { return value === null ? "Unknown" : new Date(value).toLocaleDateString(); }
function reviewIdFromPath(path: string): string | null { const match = /^\/review\/([^/]+)$/u.exec(path); return match === null ? null : decodeURIComponent(match[1]!); }