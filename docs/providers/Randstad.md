# Randstad France

| Capability | Status |
| --- | --- |
| Source / acquisition provider | `randstad.fr` / `RANDSTAD` |
| Direct vacancy | Supported for the validated `header--job-detail--alternative` / `job-details` layout |
| Stable identity | Existing `/emploi/<slug>_<reference>/` URL parser; exact URL reference retained |
| Reference validation | Summary reference and header favorite ID must agree with URL, ignoring letter case |
| Salary | Bounded salary summary; EUR integer range with explicit `par année`, `par mois` or `par heure` |
| Contract | Explicit CDI → INDEFINITE, CDD → FIXED_TERM, intérim → INTERIM |
| Hours | FULL_TIME / PART_TIME only from a unique identity-matched JobPosting |
| Location / title | Current summary location / current header title, preserving source spelling and casing |
| Experience | Integer `année(s)` summary requirement → minimumYears, unit YEAR; no invented maximum |
| Education | BAC+2 preserved in context; canonical UNKNOWN (no education evidence/parser pipeline) |
| Publication | Existing source publishedAt from the matched posting's datePosted; visible date retained in context |
| Agency identity | Matched posting's explicit Randstad France name plus current-client wording supports staffing role |
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
