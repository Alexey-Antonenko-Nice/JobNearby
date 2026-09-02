import { useEffect, useState } from "react";

import { getVacancyInbox, type VacancyInboxItem } from "./api";

export function InboxPage(): React.JSX.Element {
  const [vacancies, setVacancies] = useState<readonly VacancyInboxItem[] | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => { getVacancyInbox().then(setVacancies).catch(() => setError(true)); }, []);
  if (error) return <main className="page"><p role="alert">Unable to load vacancy inbox.</p></main>;
  if (vacancies === null) return <main className="page"><p>Loading...</p></main>;
  if (vacancies.length === 0) return <main className="page"><h1>Vacancy inbox</h1><p>No captured vacancies yet.</p></main>;
  return <main className="page"><header><h1>Vacancy inbox</h1></header><div className="inbox-list">{vacancies.map((vacancy) => <InboxItem key={vacancy.canonicalVacancyId} vacancy={vacancy} />)}</div></main>;
}

function InboxItem({ vacancy }: { readonly vacancy: VacancyInboxItem }): React.JSX.Element {
  const organizations = [["Employer", vacancy.organizations.employerName === null ? null : [vacancy.organizations.employerName]], ["Displayed company", vacancy.organizations.displayedCompanyNames], ["Recruiter", vacancy.organizations.recruiterNames], ["Consultancy", vacancy.organizations.consultancyNames]] as const;
  return <article className="inbox-item"><div className="inbox-heading"><h2>{text(vacancy.title)}</h2><strong>{vacancy.userState}</strong></div>
    <p>{text(vacancy.location)} {vacancy.engagement === null ? "" : `| ${text(vacancy.engagement)}`} {vacancy.workMode === null ? "" : `| ${text(vacancy.workMode)}`}</p>
    {organizations.filter(([, names]) => names !== null && names.length > 0).map(([label, names]) => <p key={label}><strong>{label}:</strong> {names?.join(", ")}</p>)}
    <p><strong>Employer status:</strong> {vacancy.employer.unresolvedEmployer ? "Unresolved" : text(vacancy.employer.status)}</p>
    <p>Latest observed: {date(vacancy.latestObservedAt)} | Source observations: {vacancy.sourceObservationCount}{vacancy.signals.hasMultipleSourceObservations ? " | Seen before" : ""}</p>
    <a href={`/review/${encodeURIComponent(vacancy.canonicalVacancyId)}`}>Open review</a>
  </article>;
}

function text(value: unknown): string { if (value === null || value === undefined || value === "") return "Unknown"; return typeof value === "object" ? JSON.stringify(value) : String(value); }
function date(value: string | null): string { return value === null ? "Unknown" : new Date(value).toLocaleDateString(); }