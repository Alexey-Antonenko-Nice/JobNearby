# LHH (lhh.com/fr-fr/offres-emploi)

LHH Recruitment Solutions is a recruitment firm. Its vacancies are judged **per
vacancy**; there is no global `LHH → STAFFING_AGENCY` rule.

| Topic | Status |
|---|---|
| Split search layout `https://www.lhh.com/fr-fr/offres-emploi?jobId=<id>` | Supported |
| Legacy detail route `/fr-fr/offres-emploi/detail/<id>` | Supported (bounded `<main>`) |
| Stable ID | `jobId` query (or detail route) + the pane's `.job-id` reference + pane share/detail links; all must agree |
| Contract | Selected pane's contract field only: `CDI` → `INDEFINITE`, `CDD` → `FIXED_TERM` |
| Salary | `€ 40000 - € 45000 / Annuel`, `€40000 - €45000 / Annuel`, `40 000 € - 45 000 € / Annuel`, `€ 40000 à € 45000 / Annuel` → EUR / YEAR, raw text preserved |
| Organization | `LHH Recruitment Solutions` (displayed company) |
| Role | `STAFFING_AGENCY` only with vacancy-level client wording ("recherche pour son client"); the client stays unnamed and unresolved |
| Recapture | Exact → occurrence++, changed → new observation, same canonical vacancy; human role decisions persist |

## Identity and boundary

Exactly one `.job_Details` pane is accepted, containing one `.scrollbar-box`
header, one `.VacancyDescription` and one `b.job-id`. Only the header (title,
publication, category, salary, location, contract), the description and the
reference are retained; the left-hand result cards are never read. A missing,
duplicated or malformed pane, or any explicit ID disagreeing with the `jobId`,
fails closed: the URL `jobId` is kept but no vacancy context is captured and
nothing is taken from the page as a whole.

## Fields

* Title and location keep the source wording (`Ingénieur DevOps (H/F)`,
  `TOURS, Indre-Et-Loire`).
* The category (`Informatique - Technologie de l'information`) and publication
  (`Publié il y a 0 jour(s)`) are bounded context only; no absolute date is invented.
* "intérim spécialisé" in LHH's own business description does **not** make the
  vacancy `INTERIM`; only the contract field counts.
* Experience requirements come from the selected pane description only.

## Organization role

LHH's description of itself (cabinet de conseil en recrutement, intérim
spécialisé…) is not intermediary evidence. "…recherche pour son client…" is, and
recommends `STAFFING_AGENCY`; no employer or client organization is created for
the unnamed client. All human actions stay available, and choosing `EMPLOYER`
goes through the existing contradiction confirmation. Current-vacancy evidence
outranks any role history.

## Unsupported

Other LHH layouts (other locales, several panes, list-only pages) are not
captured.
