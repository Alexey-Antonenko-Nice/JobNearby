# Crit

| Capability | Status |
| --- | --- |
| Provider | `crit-job.com`, acquisition key `CRIT` |
| Direct page | Validated single-main MUI layout with Job description, Desired profile, Summary and Other information |
| Identity | Exact UUID from `/offres/<uuid>`; matching canonical/og URLs, current data IDs and structured UUIDs required |
| Title/location | Current h1 / Summary Location; postal code retained in rawText |
| Salary | Summary decimal EUR range and explicit per hour/month/year, emitted as normal bounded evidence |
| Engagement | Explicit summary and Job description evidence; incompatible contract types remain CONFLICTED |
| Hours | Explicit summary Temps plein / Temps partiel; no inference from duration or weekly hour count |
| Experience | Equivalent numeric range/unit/context values deduplicated canonically, individual evidence retained |
| Publication | Existing source publishedAt from a unique identity-matched JobPosting; visible publication retained in context |
| Duration/start | `18 mois` and `Dès que possible` retained in context; no suitable current canonical duration/start field |
| Education | BEP/CAP retained in context; canonical UNKNOWN (no education extraction pipeline) |
| Agency/client | Matched displayed organization plus explicit recruiting-for-client wording → staffing intermediary; unnamed client unresolved |
| Agency memory | Exact normalized names only; branch classification independent of parent memory |
| Recapture | Exact snapshot reuse/occurrence increment and changed snapshot/canonical continuity tested |
| Live regression | Saved full-page replay passed in an isolated database copy; backend restart/actual recapture pending |

The previous generic path had no Crit UUID rule or selected-context locator.
JobPosting.hiringOrganization supplied the displayed branch, but its client-facing
role was missing, allowing the existing employer shortcut to offer that branch.
The new classification supplies STAFFING_AGENCY evidence for
`CRIT ILLKIRCH-GRAFFENSTADEN Industrie` because Job description explicitly says
`nous recherchons pour notre client`. Existing employer-confirmation rules then
suppress that shortcut. No employer is automatically confirmed or named.
Explicit named-client evidence remains available to existing review rules.

The boundary selects one h1/publication paragraph and exactly one MUI section
for each required heading. Navigation, map controls, recommendations and the
global About the company block stay outside evidence. This matters because the
company marketing lists many contract types that do not describe this vacancy.
Mapped source fields and generic structured payloads are removed from the
transient extraction input; the stored source is never rewritten. Provider
evidence explains title, location, compensation and every engagement term.

The live source itself contradicts its contract: the summary/body say intérim
for 18 months, while Job description also says CDI. The existing canonical
adapter already retains conflicting contract candidates, and the canonicalizer
already supports CONFLICTED with alternatives. Crit extraction emits the two
supported alternatives INTERIM + FULL_TIME and INDEFINITE + FULL_TIME, preserving
the shared explicit hours and both source statements. The overall vacancy is
therefore CONFLICTED. Neither order, repetition nor structured employmentType
OTHER silently resolves this contradiction. No schema or new conflict model is
introduced.

Experience extraction retains `1 à 2 ans`, `Expérience de 1 à 2 ans` and
`1-2 ans` as auditable evidence. The canonical adapter now compares requirements
by minimumYears, maximumYears, unit and optional context, ignoring wording only.
It selects one representative rawText and retains every supporting reference.
Equivalent requirements across observations also agree. Different ranges or
explicit contexts remain distinct; genuinely differing candidates still conflict.

The saved JobPosting matches the UUID through its URL and an identifier array.
Its second identifier `CMCCS` is a business reference, not a conflicting UUID.
Only the unique matched record contributes organization name and publication
date. Structured salary/employment/location/description do not override visible
facts. Embedded serialized application state was inspected but is not executed
or used as a second unvalidated evidence source. Duplicate matching postings
disable structured contributions; explicit conflicting UUIDs fail closed.

The confirmed agency parent `Crit` and branch
`CRIT ILLKIRCH-GRAFFENSTADEN Industrie` remain different normalized names. The
branch's source role is established even when parent memory cannot match it.
It may require its own human agency confirmation; that confirmation can be
reused by later exact branch-name matches. No fuzzy name/branch aliases are
created. Employer assignments and agency memory remain independent.

Unsafe/ambiguous boundaries preserve a trustworthy URL UUID but emit no
whole-page vacancy facts. Unsupported variants include other domains, non-UUID
routes, alternate/localized section headings, missing summary labels, and salary
formats outside the explicit supported range grammar. Without a unique matched
posting, precise branch identity/source date may remain unknown. Old ID-less
captures are not automatically merged or backfilled: the first identified
capture may create a new canonical, after which normal same-ID recapture rules
apply. The live database remains untouched by implementation/testing.

## M13.5 files

- `src/application/acquisition/CritVacancy.ts`
- `src/application/acquisition/ConservativeProviderVacancyIdExtractor.ts`
- `src/application/acquisition/HostnameAcquisitionProviderRecognizer.ts`
- `src/application/acquisition/ProviderCaptureRegistry.ts`
- `src/application/evidence/CritVacancyEvidenceExtractor.ts`
- `src/application/evidence/scopeCritVacancyEvidence.ts`
- `src/application/evidence/createVacancyEvidenceExtractor.ts`
- `src/application/evidence/scopeProviderVacancyEvidence.ts`
- `src/application/evidence/CoreVacancyHeaderFactsExtractor.ts`
- `src/application/vacancies/ExistingPipelineCanonicalVacancyAdapter.ts`
- `src/domain/acquisition/ProviderKey.ts`
- `src/domain/acquisition/AcquisitionContext.ts`
- `tests/acquisition/CritDirectVacancy.test.ts`
- `tests/fixtures/critDirectVacancy.html`
- `tests/vacancies/ExistingPipelineCanonicalVacancyAdapter.test.ts`
- `tests/infrastructure/recruitingAgencyMemory.integration.test.ts`
- `docs/providers/Crit.md`
