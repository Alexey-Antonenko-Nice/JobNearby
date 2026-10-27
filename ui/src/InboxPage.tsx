import { useEffect, useState } from "react";

import { getVacancyInbox, type VacancyInboxItem } from "./api";
import { formatEngagement, formatLocation, formatWorkMode } from "./formatVacancyFacts";

export function InboxPage(): React.JSX.Element {
  const [vacancies, setVacancies] = useState<readonly VacancyInboxItem[] | null>(null);
  const [archived, setArchived] = useState(false);
  const [error, setError] = useState(false);
  useEffect(() => { setVacancies(null); setError(false); let current = true; getVacancyInbox(undefined, archived).then(v => { if (current) setVacancies(v); }).catch(() => { if (current) setError(true); }); return () => { current = false; }; }, [archived]);
  if (error) return <main className="page"><p role="alert">Unable to load vacancy inbox.</p></main>;
  if (vacancies === null) return <main className="page"><p>Loading...</p></main>;
  return <main className="page"><header><h1>Vacancy inbox</h1><button onClick={() => setArchived(!archived)}>{archived ? "Show active vacancies" : "Show archived vacancies"}</button><p>{archived ? "Archived vacancies" : "Active vacancies"}</p></header>{vacancies.length === 0 && <p>{archived ? "No archived vacancies." : "No captured vacancies yet."}</p>}<div className="inbox-list">{vacancies.map((vacancy) => <InboxItem key={vacancy.canonicalVacancyId} vacancy={vacancy} />)}</div></main>;
}

function InboxItem({ vacancy }: { readonly vacancy: VacancyInboxItem }): React.JSX.Element {
  const organizations = [["Employer", vacancy.organizations.employerName === null ? null : [vacancy.organizations.employerName]], ["Displayed company", vacancy.organizations.displayedCompanyNames], ["Recruiter", vacancy.organizations.recruiterNames], ["Consultancy", vacancy.organizations.consultancyNames]] as const;
  return <article className="inbox-item"><div className="inbox-heading"><h2>{text(vacancy.title)}</h2><strong>{vacancy.userState}</strong></div>
    <p>{locationText(vacancy.location, vacancy.locationAlternatives)} {vacancy.engagement === null ? "" : `| ${formatEngagement(vacancy.engagement)}`} {vacancy.workMode === null ? "" : `| ${formatWorkMode(vacancy.workMode)}`}</p>
    {organizations.filter(([, names]) => names !== null && names.length > 0).map(([label, names]) => <p key={label}><strong>{label}:</strong> {names?.join(", ")}</p>)}
    <p><strong>Employer status:</strong> {vacancy.employer.unresolvedEmployer ? "Unresolved" : text(vacancy.employer.status)}</p>
    <p>Latest observed: {date(vacancy.latestObservedAt)} | Source observations: {vacancy.sourceObservationCount}{vacancy.signals.hasMultipleSourceObservations ? " | Seen before" : ""}</p>
    {vacancy.sourceLinks.length > 0 && <p><a href={vacancy.sourceLinks[0]!.url} target="_blank" rel="noreferrer">Open source vacancy</a>{vacancy.sourceLinks.length > 1 ? ` (${vacancy.sourceLinks.length} sources)` : ""}</p>}
    <a href={`/review/${encodeURIComponent(vacancy.canonicalVacancyId)}`}>Open review</a>
  </article>;
}

function text(value: unknown): string { if (value === null || value === undefined || value === "") return "Unknown"; return String(value); }
function date(value: string | null): string { return value === null ? "Unknown" : new Date(value).toLocaleDateString(); }
function locationText(value: unknown, alternatives: readonly unknown[]): string { return alternatives.length > 1 ? `Multiple locations (${alternatives.map(formatLocation).join("; ")})` : formatLocation(value); }