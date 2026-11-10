# Hays (m.hays.fr internal careers)

Hays is globally a recruitment company, but a vacancy on its own careers site is
judged **per vacancy**. There is no `hays.fr → EMPLOYER` rule.

| Topic | Status |
|---|---|
| Internal careers route `https://m.hays.fr/careers/Job/Detail/<id>` | Supported |
| Stable ID | Numeric Detail ID (route) + visible `Réf.:` (`#jd_reference`); they must agree |
| Salary | Supported (annual `K€` ranges) |
| Permanent / CDI | Supported → `INDEFINITE` |
| Full-Time / Part-Time | Supported → engagement `FULL_TIME` / `PART_TIME` |
| Work mode | **Not inferred** from `Mode de travail: Full-Time`; stays `UNKNOWN` without explicit remote/hybrid/on-site evidence |
| Organization role | Contextual, per vacancy |
| Internal Hays vacancy | Employer recommendation (contextual, confidence 0.98) |
| Client-assignment vacancy | Separate semantics: `STAFFING_AGENCY` |
| Recapture | Tested (exact → occurrence++, changed → new observation, same canonical vacancy) |

## Identity and boundary

The route ID, the visible reference, the hidden `JobId`/`JobReference` analytics
spans and a canonical link (when present) must all agree; any conflict fails
closed (the trustworthy route ID is still kept, but no vacancy context is
captured). Exactly one `section.job-detail-cont` is accepted, containing one
`.job-details` pane (title + `.job-description`) and one summary box with a
`jd_reference` field. Only title, description and summary
(type, working time, location, specialty, salary, reference) are retained.
Search fields, navigation, related jobs, the internal-recruiter contact box,
share links, diversity boilerplate and footer are excluded. If the boundary
cannot be validated nothing is extracted from the page (Unknown > contamination).

## Fields

* Title: source wording preserved (`Team Leader / Manager Recrutement IT H/F`).
* Location: the clean summary value (`Strasbourg`), not the JSON-LD
  `locality, region` duplication.
* Salary: `38 à 40 K€`, `38-40 K€`, `38 K€ à 40 K€`,
  `Salaire fixe annuel de 38 à 40 K€ …` → EUR 38000–40000 / YEAR. The raw text is
  preserved; variable pay and `TR` are descriptive only. Monthly/daily/hourly
  wording or reversed ranges produce no compensation.
* Specialty (`IT Contracting`) is kept only inside the bounded context; no taxonomy.
* Organization: `Hays` (displayed company).

## Organization role

`EMPLOYER` is recommended (contextual) when the description has first-person Hays
wording (`Bienvenue chez HAYS`, `nos 9 500 experts …`) and no client-assignment
wording. Reasons shown: internal Hays careers route, first-person Hays employer
wording, no recruiting-for-client assignment evidence. All alternatives
(employer, staffing agency, recruiter, client, consultancy) stay available, and
historical Hays roles from other vacancies never override current-vacancy evidence.

Recruitment vocabulary (`recrutement`, `clients`, `talents`, `IT Contracting`,
`manager recrutement`) describes Hays's business and the employee's duties and
does **not** imply a staffing assignment. Only vacancy-level wording such as
`pour notre client`, `notre client recrute`, `mission chez notre client`,
`recrutons pour notre client` (or the English equivalents) yields `STAFFING_AGENCY`.

## Structured data

The page's JSON-LD (`JobPosting`) is inspected but deliberately not used: its
salary is malformed (`euro`, free text as value) and its location duplicates the
locality. The scoped bounded pane is the only evidence source.

## Unsupported Hays layouts

Other hosts (`www.hays.fr`, `fr.hays-careers.com`, other countries), other routes
(search results, non-numeric or suffixed IDs), pages with several vacancy
sections, missing/ambiguous summary fields, hidden panes or conflicting
references capture only the route ID (when valid) and no vacancy fields.
