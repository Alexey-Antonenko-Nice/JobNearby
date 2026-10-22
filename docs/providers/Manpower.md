# Manpower

| Capability | Status |
| --- | --- |
| Source/provider key | `manpower.com` (acquisition context `MANPOWER`) |
| Direct vacancy page | Supported: `/en/job/<category>/<slug>/<reference-number>` |
| Search-results pane | Not yet validated; fails closed |
| Stable identity | Numeric URL reference, required to agree with the bounded Reference Number |
| Title / location | Current header title / current job location sidebar |
| Contract / hours | Explicit Temporary → INTERIM; Full Time → FULL_TIME; Part Time → PART_TIME |
| Salary | Conservative USD amount/range; period only when explicitly attached to Pay Range |
| Recruiter organization | Explicit current-job Manpower / Manpower Engineering logo plus “Our client” wording → RECRUITER |
| Recruiter person | RECRUITER person evidence; email retained in source context, no dedicated person email field |
| Named client | No inferred identity; only explicit existing evidence rules may identify one |
| Unnamed client | Unresolved; industry text never becomes a client name |
| Agency memory | Compatible with human confirmation and later exact normalized name reuse |
| Industry | Explicit vacancy industry label → existing industryContexts projection |
| Publication date | Existing SourceObservation.publishedAt from header time datetime; no new canonical date field |
| Recapture | Exact fingerprint reuses observation and increments occurrence; changed fingerprint/same reference keeps canonical identity |
| Live regression | Saved live HTML replay passed in an isolated database copy; backend restart and actual live recapture pending |

The boundary requires one main region with a job-header, article-header-container,
details-block and single-job, plus one description, company and location region.
The extracted context is rebuilt from the header facts, description, current-job
company logo, location and recruiter sidebar. Breadcrumbs, action controls,
unrelated main siblings and outer navigation/footer are excluded. Conflicting
references/links/data identifiers, duplicate job regions, missing required
regions and unsupported layouts produce no vacancy facts. Trustworthy URL
identity survives failure; there is no whole-page evidence fallback. Reprocessing
revalidates the stored original HTML and never edits immutable source content.

The saved regression page contains one JSON-LD JobPosting matching reference
412687, plus WebPage and BreadcrumbList entries. Its salary has no period;
“Weekly Pay” in benefits describes payment frequency, not an hourly rate.
Page-level JSON-LD/embedded state is deliberately not projected: the verified DOM
provides the needed facts, and structured hiringOrganization must not promote
the agency to employer or bypass boundary/reference checks. Original scripts
remain in the immutable source HTML for diagnostics.

For the regression, the header “Failure Analysis Engineer” takes precedence over
the description's “Job Title: Failure Analysis Engineer I”. The existing model
accepts resolved compensation with minimum 32, USD, raw `$32`, and absent maximum
and period. No schema change is needed.

The existing no-match recognition fallback still creates an unresolved employer
cluster with ACCEPTED / new-employer-cluster. Agency confirmation does not alter
that assignment or identify the client. Exact recaptures do not duplicate it.

Older captures lacking external ID are not automatically merged with newly
identified captures. The newly bounded context can change the fingerprint once;
subsequent captures use the normal identity and fingerprint rules. No backfill,
source mutation or live database rewrite is performed by this milestone.

Other countries/languages, search panes, alternate direct-page markup and English
named-client attribution beyond existing generic rules remain unvalidated.

The 412512 compensation follow-up supports Pay Range after other labeled facts
in the same paragraph, separated by explicit HTML line breaks. The failure was
paragraph selection, not decimal parsing: `$32.00` already matches the numeric
grammar. `$32`, `$32.00` and `$38.33` retain their raw text, USD amount and absent
period/maximum. Thousands separators (for example `$1,250.00`) remain unsupported
and rejected; malformed text and multiple Pay Range lines also fail closed.
Replaying the saved 412512 capture in an isolated database copy reused its source
observation and canonical identity, resolved compensation to USD 32, and left
employer assignments unchanged across repeated recaptures.

## M13.2 files

New:

- `src/application/acquisition/ManpowerVacancy.ts`
- `src/application/evidence/ManpowerVacancyEvidenceExtractor.ts`
- `src/application/evidence/scopeManpowerVacancyEvidence.ts`
- `tests/acquisition/ManpowerDirectVacancy.test.ts`
- `tests/fixtures/manpowerDirectVacancy.html`
- `tests/fixtures/manpowerWholeDollarVacancy.html`
- `docs/providers/Manpower.md`

Updated wiring:

- `src/application/acquisition/ConservativeProviderVacancyIdExtractor.ts`
- `src/application/acquisition/HostnameAcquisitionProviderRecognizer.ts`
- `src/application/acquisition/ProviderCaptureRegistry.ts`
- `src/application/evidence/createVacancyEvidenceExtractor.ts`
- `src/application/evidence/scopeProviderVacancyEvidence.ts`
- `src/domain/acquisition/AcquisitionContext.ts`
- `src/domain/acquisition/ProviderKey.ts`
