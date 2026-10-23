# Kelly corporate-careers Workday selected vacancies

## Scope and identity

Supported: captured split-view details on `kellyservices.wd503.myworkdayjobs.com/en-US/corporatecareers-kellyservices-com/details/<slug>_<requisition>`. Provider key KELLY_WORKDAY is scoped to that exact host; the source name remains the hostname. Generic Workday identity and employer/staffing semantics are unchanged. Other Kelly tenants, client-assignment sites, locale/route variants and standalone `/job` pages are not validated and fail closed for vacancy facts on this host.

Supported requisition forms are **JR-prefixed digits** (for example `JR100451`) and **numeric digits** (for example `14860`). Numeric support is restricted to this exact Kelly corporate-careers host, locale and details route; it does not change the generic Workday grammar or accept trailing numbers on other tenants/routes.

The primary requisition is taken from the details route and normalized to uppercase. The selected pane's labeled job requisition id must agree. The selected Apply action and any selected Workday job/detail links must agree as well; selected links may use `/job/...` or `/details/.../apply`. Job titles/locations and left-side search-result IDs never establish identity. A conflicting supplied ID, selected pane reference, Apply link or matched structured identity fails closed while a trustworthy route ID survives.

The original saved live case is **JR100451**; the numeric regression is **14860**. Both formats are handled only in this scoped provider; the existing generic Workday `JR-...` grammar and controls are preserved.

## M13.10.1 numeric regression

The regression route `/details/Talent-Supply-Chain-Consultant_14860` previously returned no provider external ID: `kellyVacancyId` accepted only `JR` followed by digits, so the locator returned before reading the pane. The pane's labeled requisition validator and selected-link identity parser also required JR-prefixed digits. All three now accept either supported form, with the same strict route/pane/Apply/selected-link agreement. Matching JSON-LD numeric identifiers are compared as exact safe integers; explicit conflicting or malformed numeric identifiers on a record tied to the selected URL fail closed. Unrelated postings remain excluded.

The numeric identity fix was necessary but not sufficient on the saved live capture. Its unique jobDetails pane also contains a nested Similar Jobs section, which repeats remoteType, locations, time and postedOn for other vacancies. The old duplicate-field guard therefore still rejected the pane. The locator now removes only a validated section containing a unique `similar-jobs-heading` and a `Similar jobs` list before checking the selected fields/links. A module containing selected title/description/reference/Apply markers, unidentified recommendation content, duplicate headings, or remaining duplicate primary fields fails closed. The source HTML stays immutable.

The numeric fixture combines the original search list (JR100451, JR100418 and JR100331) with the actual saved 14860 detail pane, including its nested JR100414/14878 recommendations. Decorative classes, telemetry attributes and SVGs are omitted; the selected source text and field structure are retained. It verifies:

- External ID **14860**, selected context captured.
- Title **Talent Supply Chain Consultant**.
- Workplace **United States-Texas-Remote**.
- **Remote → REMOTE**, **Full time → FULL_TIME**.
- **Posted 2 Days Ago** retained without inventing an absolute date.
- Kelly recommended as **EMPLOYER**, with all human alternatives available.

Client-facing work, clients, hiring managers, temporary/contract talent and recruitment responsibilities describe what the employee does. They do not establish that this vacancy is a client assignment. Even recruiting for client accounts or coordinating a temporary assignment as an employee duty does not suffice. Explicit company hiring `for our client`, `our client is hiring`, or a vacancy described as an assignment with our client remains positive intermediary evidence.

Replay of the full saved capture also verifies the same selected facts and USD 51300–68400 YEAR from its explicit annual-pay statement. Current corporate-careers evidence outranks coexisting human employer/staffing histories. The role resolver and UI did not need changes. Numeric exact captures reuse the immutable observation and increment occurrences; changed selected content creates an observation on the same canonical vacancy. Existing vacancy-specific human decisions and employer cluster continuity survive both paths. No new schema migration is introduced; the existing organization-role migration/work is preserved.

## Root causes of previous results

The generic Workday ID expression required `JR-...`, so it missed JR100451. With no recognized reference, generic subtitle selection took the first search-result subtitle. That subtitle contained only JR100451, while the old location splitter filtered only hyphenated `JR-...` references. The result was a job reference used as location.

Without a selected context, generic core extraction scanned the whole captured page and accepted a neighboring card's exact Remote label. The selected In Person value did not have a dedicated mapping. The first site header was Corporate Careers; generic Workday company extraction stripped Careers and emitted Corporate as displayed company. The selected time field is `data-automation-id=time` with a `time type` label, rather than generic Workday's expected timeType field.

## Boundary and normal evidence

Exactly one `data-automation-id=jobDetails` pane is required, containing one jobPostingHeader and one jobPostingDescription, a labeled workplace/requisition and a unique Apply action. Labeled fields use one dt/dd pair each: remoteType/remote type, locations/locations, time/time type, postedOn/posted on, and requisitionId/job requisition id. Missing required fields, duplicate/ambiguous panes or fields, hidden panes, malformed labels and unsupported boundaries fail closed. A standalone requisition is never a valid workplace.

Only this right-side pane, after excluding a validated nested Similar Jobs module when present, becomes selected HTML/text. The left result list, Corporate Careers site header, neighboring jobs, locations and Remote labels are excluded. Original captured content remains immutable for audit. Old full-page observations are transiently revalidated/rescoped and stale mapped title/company/location/contract/salary/raw text cannot bypass the guard. The generic Workday extractor and header projector defer to this provider on the Kelly host.

Normal selected-context evidence supplies:

- Title: **Supervisor Site**, exactly as selected.
- Workplace: **United States-New Mexico-Customer On-site**, from the selected labeled locations field.
- Mode: **In Person → ON_SITE**. Explicit selected Remote/Hybrid values map to REMOTE/HYBRID; missing mode stays unknown rather than reading another card or inferring from a title.
- Engagement: **Full time → FULL_TIME**, or explicit Part time → PART_TIME. No permanence/duration is inferred. Missing selected time type stays unknown.
- Reference: ordinary SOURCE_EXTERNAL_ID evidence JR100451.
- Posting: **Posted Today** remains bounded source text. No absolute source publication date is invented; there is no existing safe relative-date policy to apply here.
- Salary: the saved selected description explicitly says `The annual base pay for this position is listed below` and then **$61,575.00 - $82,100.00**. This supports **USD 61575–82100 YEAR**, rather than unknown compensation. YEAR comes from the explicit annual statement; USD is supported by the dollar range and explicit United States workplace. Whole-dollar decimals, grouped thousands, finite/non-reversed ranges and a unique nearby range are checked. Without that annual statement, a supported US workplace, or a valid unambiguous range, compensation remains unknown. Neighboring-card salaries/benefits cannot supply it.

All normal provider facts record SELECTED_VACANCY_CONTEXT provenance. No opaque source company/contract/salary projection is used.

## Kelly identity and contextual roles

The selected description explicitly states `Kelly is a team of experts...` and `Kelly is an equal opportunity employer...`. That supports the literal name **Kelly**. Corporate is a presentation label; Kelly Services is not invented from the hostname or a benefits-link caption.

On this supported corporate-careers route, the first-person wording yields DISPLAYED_COMPANY Kelly and contextual EMPLOYER source evidence, with confidence 0.98 for the contextual role. This is not a confidence-1 explicit employer identity or a USER_CONFIRMED decision: the existing recognition path leaves the initial employer cluster **UNRESOLVED**, and human confirmation remains required. Existing review offers Confirm as employer: Kelly. Source-context EMPLOYER evidence also prevents existing agency memory from treating Kelly's own internal vacancy as a staffing assignment. Neither the memory extractor nor review policy needed a global Kelly-specific exception.

Generic references to clients, client communication, CRM, client support and recruitment responsibilities do not imply staffing. Explicit recruiting/hiring `for our client` or `on behalf of our client`, or staffing/temporary-assignment wording takes precedence over corporate boilerplate: it can supply STAFFING_AGENCY context and a strictly named client when present, without emitting contextual EMPLOYER. Other Kelly sites have no blanket employer or staffing rule.

The normal corporate case has no recruiter/staffing evidence or agency-confirmation candidate, even if exact Kelly staffing memory already exists. No employer or agency is human-confirmed automatically. Existing employer history/confirmation actions remain independent from provider identity and source role interpretation.

## Embedded state

The saved page contains no JobPosting JSON-LD or selected-job API payload in the captured scripts. Its inline Workday configuration exposes tenant/site setup but does not contain JR100451. That configuration and left-list/result state are not used for vacancy projection. Visible selected references and labeled fields are sufficient; no API request is made.

If structured JobPosting data is present later, only identity checks for records tied to the selected requisition/current URL are used. Unrelated result-list postings are ignored, not promoted into the pane. A record claiming the current URL but a different reference fails closed. Structured fields never replace the visible title, work mode, workplace, organization or time type in this implementation.

## Recapture and limitations

Exact provider/ID/fingerprint recapture reuses the immutable SourceObservation and increments occurrences while reaching canonical reprojection. Changed selected content creates an observation with the same canonical vacancy. Tests cover unchanged originals, one unresolved employer cluster, stable assignment history, and stable USER_CONFIRMED employer history after a human action followed by exact recapture. No agency memory is created by capturing a corporate role.

First upgraded capture may change fingerprint because provider context and mapped fields change. Historical null-ID observations are not automatically backfilled or merged into newly identified canonical vacancies. Backend restart/live recapture is required; saved-page replay does not modify the live database.

Unsupported: other Kelly hosts/tenants/locales, alternate pane/label structures, standalone job/application pages, multiple or incomplete selected panes, unvalidated structured/API fallbacks, relative-date conversion, and additional salary formats/countries without explicit currency support. Unsupported routes/layouts on the guarded Kelly host leave facts unknown instead of extracting the search page. Other Workday hosts retain their existing generic behavior; they do not acquire this Kelly-specific support.

## Changed files

Added: `src/application/acquisition/KellyWorkdayVacancy.ts`, `src/application/evidence/KellyVacancyEvidenceExtractor.ts`, `src/application/evidence/scopeKellyVacancyEvidence.ts`, `tests/acquisition/KellyWorkdaySelectedVacancy.test.ts`, `tests/fixtures/kellyWorkdaySelectedVacancy.html`, and this document.

Updated: ConservativeProviderVacancyIdExtractor.ts, HostnameAcquisitionProviderRecognizer.ts, ProviderCaptureRegistry.ts, CoreVacancyHeaderFactsExtractor.ts, WorkdayVacancyEvidenceExtractor.ts, createVacancyEvidenceExtractor.ts, scopeProviderVacancyEvidence.ts, AcquisitionContext.ts, ProviderKey.ts, and recruitingAgencyMemory.integration.test.ts. No schema migration or commit.

## Original M13.10 verification results

Added 45 Kelly acquisition/evidence/role-safety/recapture cases and one integration case protecting a direct corporate vacancy from pre-existing Kelly agency memory. Focused acquisition/evidence/canonicalization/user/recognition/memory/recapture/runtime verification passed **1,405 tests in 83 files**. Full backend passed **1,804 tests in 123 files**; UI passed **60 tests in 4 files**. Backend build, UI build, typecheck and diff check passed. Existing generic Workday, PROMAN, Gi Group, Start People, Actual, Crit, Synergie, Randstad, Adecco, Manpower and LinkedIn recruiter-safety controls remain green.

Replaying the original saved capture in a fresh in-memory database produced JR100451 / KELLY_WORKDAY selected context, Supervisor Site, United States-New Mexico-Customer On-site, ON_SITE, FULL_TIME only, and explicit USD 61575–82100 YEAR. Posted Today was retained without an absolute publication date. Kelly was displayed with contextual employer evidence; the employer cluster remained UNRESOLVED and offered Confirm as employer: Kelly, with no known/candidate agency context. No neighboring titles, locations or Remote values entered the selected projection. Identical recapture reused the observation/canonical, raised occurrences to two, retained one source/one unresolved cluster and left assignment history unchanged.

The live database was opened read-only and was not changed. Backend restart and live recapture remain pending.

## M13.10.1 verification results

Kelly numeric/JR, generic Workday and vacancy-role focused checks passed **101 tests in 3 files**. Full backend passed **1,854 tests in 124 files**; UI passed **66 tests in 5 files**. Backend build, UI build, typecheck and diff check passed.

The failed capture `15f9b032-a7a9-4a22-bbea-b320610f1914` was opened read-only and its original full HTML replayed into a fresh in-memory database. It produced external ID 14860 and a KELLY_WORKDAY selected context, Talent Supply Chain Consultant, United States-Texas-Remote, REMOTE, FULL_TIME, Posted 2 Days Ago and USD 51300–68400 YEAR. Reading the existing role histories without modifying them showed both EMPLOYER and STAFFING_AGENCY; the current recommendation remained EMPLOYER with all five alternatives. A repeated full-page replay reused the observation and raised its occurrence count to two. Integration tests additionally verify changed-content canonical continuity and persistence of vacancy-specific human decisions.

The live source/canonical rows were not rewritten. Restart and recapture are required to refresh the running application's live projection. No commit or additional schema migration was made.
