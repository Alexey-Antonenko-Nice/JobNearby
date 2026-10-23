import { useState } from "react";
import { decideEmployerIdentity, getReview, searchEmployerIdentities, type ReviewView } from "./api";

export function EmployerIdentitySection({review,onConfirmed,disabled}: {
  readonly review:ReviewView; readonly onConfirmed:(review:ReviewView)=>void; readonly disabled:boolean;
}) {
  const [pending,setPending]=useState(false);
  const [error,setError]=useState<string|null>(null);
  const [selected,setSelected]=useState<string|null>(null);
  const [results,setResults]=useState<NonNullable<ReviewView["employerIdentityReview"]>["candidates"]|null>(null);
  const [query,setQuery]=useState("");
  const identity=review.employerIdentityReview;
  if (!identity) return null;
  const suggestedIds=new Set(identity.candidates.map(c=>c.employerClusterId));
  const searched=(results??[]).filter(c=>!suggestedIds.has(c.employerClusterId));
  const known=[...identity.candidates,...searched];
  async function search() {
    setPending(true);setError(null);
    try {setResults((await searchEmployerIdentities(review.vacancy.canonicalVacancyId,query)).candidates);}
    catch (failure) {setError(failure instanceof Error ? failure.message : "Unable to search employer identities.");}
    finally {setPending(false);}
  }
  async function save(employerClusterId:string,decision:"USE_EXISTING"|"KEEP_SEPARATE") {
    const candidate=known.find(c=>c.employerClusterId===employerClusterId)!;
    setPending(true);setError(null);
    try {
      onConfirmed(await decideEmployerIdentity(review.vacancy.canonicalVacancyId,{requestId:crypto.randomUUID(),employerClusterId,candidateToken:candidate.candidateToken,decision}));
      setSelected(null);setResults(null);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Unable to save employer identity.");
      if ((failure as {status?:number}).status===409) {
        setSelected(null);setResults(null);
        try {onConfirmed(await getReview(review.vacancy.canonicalVacancyId));} catch { /* Retain the visible failure. */ }
      }
    } finally {setPending(false);}
  }
  return <section aria-label="Employer identity"><h2>Employer identity</h2>
    <p>{identity.employerName} is confirmed as employer for this vacancy. Separately, choose whether it is the same employer as a previously confirmed identity.</p>
    <p>Matching names and careers domains are clues only. Different employers can share a brand or careers site. No identity is selected automatically.</p>
    {error && <p role="alert">{error}</p>}
    {!identity.candidates.length && <p>No suggested identities: nothing in the confirmed history matches this employer by name, known alias or careers domain.</p>}
    {known.map(candidate=><article key={candidate.employerClusterId} aria-label={`Existing identity: ${candidate.displayLabel}`}>
      <h3>{candidate.displayLabel}</h3>
      <ul>{candidate.advisoryReasons.map(reason=><li key={reason}>{reason}</li>)}</ul>
      <p>Prior vacancies:</p><ul>{candidate.priorVacancies.map(v=><li key={v.canonicalVacancyId}><a href={`/vacancies/${encodeURIComponent(v.canonicalVacancyId)}/review`}>{v.title ?? "Untitled vacancy"}</a> — {v.location ?? "Location unknown"}</li>)}</ul>
      {candidate.keptSeparate && <p>Kept separate for this vacancy. You can still choose this identity later.</p>}
      <button type="button" disabled={disabled||pending} onClick={()=>setSelected(candidate.employerClusterId)}>Use this existing identity</button>
      <button type="button" disabled={disabled||pending||candidate.keptSeparate} onClick={()=>void save(candidate.employerClusterId,"KEEP_SEPARATE")}>Keep separate</button>
    </article>)}
    <form role="search" aria-label="Search employer identities" onSubmit={event=>{event.preventDefault();void search();}}>
      <label>Search another confirmed identity by name <input value={query} onChange={event=>setQuery(event.target.value)} maxLength={200}/></label>
      <button type="submit" disabled={disabled||pending||query.trim().length<2}>Search identities</button>
    </form>
    {results && !searched.length && <p>No other confirmed identity matches that name.</p>}
    {selected && <div role="dialog" aria-modal="true" aria-label="Confirm employer identity">
      <h3>Use {known.find(c=>c.employerClusterId===selected)?.displayLabel}?</h3>
      <p>Use this employer identity for this vacancy and include its employer history? Other vacancies and earlier decisions will stay unchanged.</p>
      <button type="button" disabled={disabled||pending} onClick={()=>void save(selected,"USE_EXISTING")}>Confirm existing identity</button>
      <button type="button" disabled={pending} onClick={()=>setSelected(null)}>Cancel</button>
    </div>}
  </section>;
}
