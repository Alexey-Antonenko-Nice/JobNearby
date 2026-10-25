# Randstad France

| Capability | Status |
| --- | --- |
| Source / acquisition provider | `randstad.fr` / `RANDSTAD` |
| Direct vacancy | Supported for the validated `header--job-detail--alternative` / `job-details` layout |
| Stable identity | Existing `/emploi/<slug>_<reference>/` URL parser; exact URL reference retained |
| Reference validation | Summary reference and header favorite ID must agree with URL, ignoring letter case |
| Salary | Bounded salary summary; EUR integer amount or range with explicit `par année`, `par mois` or `par heure` |
| Contract | Explicit CDI → INDEFINITE, CDD → FIXED_TERM, intérim → INTERIM |
| Hours | FULL_TIME / PART_TIME only from a unique identity-matched JobPosting |
| Location / title | Current summary location / current header title, preserving source spelling and casing |
| Experience | Integer `année(s)` summary requirement → minimumYears, unit YEAR; no invented maximum |
| Education | BAC+2 preserved in context; canonical UNKNOWN (no education evidence/parser pipeline) |
| Publication | Existing source publishedAt from the matched posting's datePosted; visible date retained in context |
| Agency identity | Matched posting's explicit Randstad name plus vacancy hiring-for-client wording supports recruitment role (0.98); name/activity/CDI alone do not |
| Named client | Existing explicit client rules only; unnamed client remains unresolved |
| Agency memory | Human confirmation and subsequent exact normalized name reuse tested |
| Recapture | Exact observation reuse/occurrence increment and changed snapshot/canonical continuity tested |
| Live regression | Saved live HTML replay passed in an isolated database copy; actual restart/recapture pending |

The context combines the validated header title, current job summary and one
description body. The page renders identical mobile and desktop descriptions:
these must agree before one copy is selected. Qualification accordion titles,
sharing controls, navigation, application-process marketing, agency-location
chrome, related vacancies and alerts remain outside evidence context. The
summary retains publication, education, experience and reference labels.

The previous generic acquisition path projected the page's JobPosting to source
fields. Its baseSalary became `salaryText = 29000 - 31000 EUR / YEAR`, and
`employmentType = FULL_TIME` became contractText. The canonical adapter accepted
those direct fields even when normal text extraction did not expose matching
compensation/hours evidence. CDI came separately from visible text.

The provider guard now reconstructs and validates context from original stored
HTML, strips mapped direct fields and untrusted structured payloads from the
transient extraction input, and feeds the normal evidence path. Salary, CDI,
title, location and experience carry SELECTED_VACANCY_CONTEXT provenance.
Structured hours have DIRECT_FIELD provenance within that context and raw terms
such as `JobPosting.employmentType=FULL_TIME`. Canonical supporting references
use the corresponding normal evidence kinds, rather than SOURCE_SALARY_TEXT or
SOURCE_CONTRACT_TEXT shortcuts. The generic header parser yields to this provider
extractor so that `307-UST-...` cannot become a false department/location.

Only one reference-matched JSON-LD JobPosting can supplement a valid DOM boundary.
Its identifier is compared case-insensitively to the URL reference; an explicit
URL must agree too. A single conflicting posting invalidates the boundary.
Unrelated postings do not contribute, duplicate matches disable the structured
source, and structured data cannot rescue a missing DOM boundary. Only matched
identity, employmentType, datePosted and organization name enter context
metadata. Structured title/description/salary cannot introduce alternate facts.
The original full page and JSON-LD remain in immutable source HTML.

On missing/ambiguous regions, mismatched references, conflicting rendered
descriptions or nested search/chrome, facts fail closed. A trustworthy URL ID
survives, but there is no whole-page vacancy evidence fallback, including for old
observations. No source rows are rewritten and no migration is introduced.
The new context/mapped representation may change the first post-upgrade
fingerprint once; provider identity retains the canonical vacancy. Subsequent
identical captures reuse that observation. Employer history and agency memory
remain independent; no hostname automatically creates human confirmation.

Unvalidated variants include other countries/domains, alternate direct layouts,
search panes, pages missing the validated summary/favorite reference markers,
decimal/other-currency salary formats and education canonicalization. Without a
unique matched posting, hours and agency identity may remain unknown; the visible
publication date stays in context when no structured source date is available.

## M13.3 files

New provider implementation:

- `src/application/acquisition/RandstadVacancy.ts`
- `src/application/evidence/RandstadVacancyEvidenceExtractor.ts`
- `src/application/evidence/scopeRandstadVacancyEvidence.ts`

Wiring and generic parser guard:

- `src/application/acquisition/HostnameAcquisitionProviderRecognizer.ts`
- `src/application/acquisition/ProviderCaptureRegistry.ts`
- `src/application/evidence/createVacancyEvidenceExtractor.ts`
- `src/application/evidence/scopeProviderVacancyEvidence.ts`
- `src/application/evidence/CoreVacancyHeaderFactsExtractor.ts`
- `src/domain/acquisition/ProviderKey.ts`
- `src/domain/acquisition/AcquisitionContext.ts`

Tests, fixture and documentation:

- `tests/acquisition/RandstadDirectVacancy.test.ts`
- `tests/acquisition/ProviderCaptureRegistry.test.ts`
- `tests/fixtures/randstadDirectVacancy.html`
- `docs/providers/Randstad.md`

## Saved single-amount salary repair

Observation `63377f35-1da6-4204-9425-5927a0faf575` (canonical
`4e7a6aa5-1003-4dbe-856e-440f593c113e`) was inspected from the original
stored HTML using a read-only database connection. Its validated summary says
`38 000 € par année`. The former parser required two EUR amounts separated by
a dash, so it returned no compensation. The matched JSON-LD has minValue 38000
and maxValue 0; it is not used to override the visible summary.

The bounded parser now accepts a single integer amount as equal minimum and
maximum, retaining EUR and the explicitly stated period. Gross/net remains
unspecified. Existing ranges and rejection of missing/unknown periods, other
currencies, malformed amounts and reversed ranges remain covered.

The previous provider rule converted any `notre client` mention into
STAFFING_AGENCY and reused the confidence-1 provenance of literal summary
fields. This confused company-level staffing activity with the relationship to
this vacancy. Here the description explicitly says “Nous recherchons pour le
compte de notre client” and describes an unnamed industrial client. That supports
RECRUITMENT_AGENCY with contextual confidence 0.98, independently of CDI.
The agency name still comes only from the unique identity-matched posting;
it does not establish employment or staffing. The client's identity stays
unresolved. Client-site duties, generic client mentions and company staffing
boilerplate do not establish a staffing assignment. The bounded extraction path
strips the legacy displayed-company field before generic name-based rules run.

`tests/fixtures/randstadSingleSalaryVacancy.html` preserves the actual saved DOM
and JSON-LD with executable scripts, styles and image assets removed.
`tests/acquisition/RandstadSingleSalaryVacancy.test.ts` covers the scalar salary,
role distinction, outside-content exclusion, and nonempty human decisions across
identical/changed recapture. Set `RANDSTAD_STORED_REPLAY=1` to additionally replay
the actual original HTML in an in-memory serialization of the read-only live
database, verifying repaired compensation, original canonical continuity,
identical recapture, immutable source and preserved decision/interaction history.
No live rows or schema are changed.
