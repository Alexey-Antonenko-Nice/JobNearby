# PROMAN authenticated vacancy-modal capture

## Supported capture and identity

The authenticated dashboard at `https://mon-espace.proman-emploi.fr/dashboard?offre_id=<numeric-id>` is supported from captured rendered HTML. Provider key is PROMAN; source name remains mon-espace.proman-emploi.fr. No navigation, credentials or live network request is required. Direct public vacancy pages are not validated or supported by this locator.

The primary ID is the single positive numeric offre_id query parameter. A panel-local public offer link (`https://www.proman-emploi.fr/mp<id>-...`), favorite action (`toggleJobFavorite(..., <id>, ...)`) or validated persisted `data-offre-id` must agree. Missing association, multiple URL ID parameters and contradictory primary values fail closed. Titles and workplace names never establish identity.

The visible REF is separate `PROMAN_REFERENCE` evidence; the primary identifier remains `SOURCE_EXTERNAL_ID`. Distinct identifier types are not compared as though identical. Multiple inconsistent references of the same type invalidate the panel.

The saved live capture's actual reference is **AIX71-MP1197787**, not the request's **AIX71-MPI197787**. The source spelling is preserved. A test also verifies that the latter format can be retained independently without replacing offre_id 1197787.

## Panel boundary and contamination safety

Exactly one active `role=dialog`, `aria-modal=true` container containing one `panel-container` is required. Explicitly hidden dialogs/panels/ancestor divs are excluded. The current header is identified by popin-header-nuage, and the summary/job/profile by the resume/poste/profil tab bindings. Inactive job/profile tabs belong to the same selected vacancy and are included even when their tab is not currently displayed.

The header, summary labels, branch card and the two vacancy tabs are the only fact sources. The dashboard underneath, account content, other offer cards, navigation, footer, comments, scripts, forms and arbitrary embedded state cannot contribute. Missing/duplicate/closed/ambiguous panels, incomplete required sections or conflicting IDs fail closed; a trustworthy URL ID survives but vacancy facts remain unknown. No whole-dashboard fallback is allowed, including for old full-page observations.

The saved panel contains its own public offer link and favorite action confirming 1197787. No unique JobPosting or useful selected Livewire snapshot was present in the saved rendered HTML. Generic Alpine/account state is deliberately not consumed. There is no structured-data fallback.

## Facts and provenance

- Literal heading: Technicien de deploiement informatique H/F.
- Workplace: VALBONNE (06), from the header's workplace paragraph; agency contacts and body references to colleagues in Paris do not replace it.
- Contract: explicit Intérim/CDI/CDD maps to INTERIM/INDEFINITE/FIXED_TERM.
- Hours: explicit Rythme de travail / Temps plein (or Temps partiel). Interim does not imply full-time.
- Salary: header range `13.74€ - 14.29€ / h` produces normal EUR 13.74–14.29 HOUR evidence. Dot/comma decimals and h/mois/an periods are supported; malformed or reversed ranges are rejected without fallback.
- Experience: normal bounded candidate-requirement extraction includes the explicit 2–3 year summary range. The full profile remains in source context.
- Duration: Durée / 6 Mois is retained in bounded source context. Existing vacancy/evidence models have no appropriate contract-duration field; no schema change is introduced.
- Publication: Publiée le 06/10/26 maps to existing source publishedAt 2026-10-06. Four-digit years are accepted; two-digit years mean 2000–2099. Invalid calendar dates are not projected.
- Normal evidence records SELECTED_VACANCY_CONTEXT provenance; secondary REF has its own evidence item. Canonical fields are derived from normal evidence rather than opaque source salary/contract fields.

## Agency, employer and memory

The Mission proposée par card combines `Logo PROMAN` with the visible branch text AIX EXPERTISE 2. Its explicit organization identity is **PROMAN AIX EXPERTISE 2**, not generic PROMAN or PROMAN EXPERTISE body marketing. An already fully branded branch label is not prefixed again. Agency contacts do not enter generic workplace/employer extraction.

The explicit branch label plus an interim contract (or explicit agency staffing/recruitment wording in this job) supports STAFFING_AGENCY. Generic branding alone does not classify staffing. This branch is DISPLAYED_COMPANY and STAFFING_AGENCY in the saved case. Its unnamed client stays unresolved; a normal future explicitly named client can still supply CLIENT evidence. The branch is never automatically human-confirmed as employer.

Existing review rules suppress Confirm as employer and offer Confirm as recruiting agency for this branch. Human confirmation persists exact normalized branch memory. Later exact branch matches use AGENCY_MEMORY and do not repeat confirmation. Parent PROMAN and other branches are not fuzzy aliases; tests preconfirm parent/other-branch memories and verify they do not propagate.

## Authenticated-page persistence

New PROMAN captures persist a reconstructed, escaped vacancy-only HTML representation and selected vacancy text. Full account/dashboard HTML, JavaScript, Livewire/Alpine snapshots, captured active attributes, cookies, arbitrary browser metadata and account page titles are not stored. Query parameters/fragments/userinfo are excluded from both source and occurrence URLs; only the dashboard route and validated offre_id are retained. Failed boundaries store a neutral placeholder, not private dashboard content. Fixtures contain only sanitized vacancy panel markup and need no credentials.

The sanitized HTML is revalidated on extraction; a data-offre-id marker retains the original validated association after application controls are removed. Existing immutable captures are not rewritten or purged; they are transiently rescoped from original HTML before extraction, so old account/background content cannot become new vacancy evidence.

## Recapture and limitations

Identical sanitized provider/ID/fingerprint captures reuse the SourceObservation and increment occurrences while reaching canonical reprojection. Background-only/account/session changes are excluded from this vacancy fingerprint. Changed selected-vacancy facts create a new observation and preserve canonical identity. Tests verify immutable originals, unchanged assignment history, one unresolved cluster, stable confirmation history after repeated capture, and later exact-branch memory.

The first upgraded capture can have a changed fingerprint. Historical null-ID observations are not automatically merged/backfilled into newly identified canonical vacancies. Restart/recapture is required for the live workflow; saved-snapshot replay does not update the live database.

Unsupported: public vacancy pages, alternate dashboard routes/hosts, unknown modal/header/tab structures, missing branch/logo identity, missing trustworthy panel ID association, multiple active vacancy panels, generic embedded-state extraction, additional salary grammars and parent/branch aliases. Ambiguous layouts remain unknown instead of falling back to the dashboard.

## Changed files

Added: `src/application/acquisition/PromanVacancy.ts`, `src/application/evidence/PromanVacancyEvidenceExtractor.ts`, `src/application/evidence/scopePromanVacancyEvidence.ts`, `tests/acquisition/PromanSelectedVacancy.test.ts`, `tests/fixtures/promanSelectedVacancy.html`, and this document.

Updated: BrowserCaptureAcquisitionAdapter.ts, ingestBrowserCapture.ts, ConservativeProviderVacancyIdExtractor.ts, HostnameAcquisitionProviderRecognizer.ts, ProviderCaptureRegistry.ts, CoreVacancyHeaderFactsExtractor.ts, createVacancyEvidenceExtractor.ts, scopeProviderVacancyEvidence.ts, AcquisitionContext.ts, ProviderKey.ts, and recruitingAgencyMemory.integration.test.ts. No schema migration or commit.

## Verification results

Added 49 PROMAN acquisition/evidence/privacy/recapture test cases and one parent/branch agency-memory integration case. Focused acquisition/evidence/canonicalization/user/recognition/memory/recapture/runtime verification passed **1,303 tests in 81 files**, including Start People, Actual, Crit, Synergie, Randstad, Adecco, Manpower and LinkedIn recruiter-safety controls.

Full backend verification passed **1,702 tests in 121 files** on an isolated rerun. The first full run, concurrent with focused tests/UI/builds, hit existing 5-second timeouts in four database tests; the isolated full rerun passed without changing tests or timeouts. UI passed **60 tests in 4 files**. Backend build, UI build, typecheck and diff check passed.

Replaying the original saved authenticated capture into a fresh in-memory database produced ID 1197787, PROMAN selected context, the exact title and VALBONNE (06), INTERIM + FULL_TIME, EUR 13.74–14.29 HOUR, 2–3 YEAR, publication 2026-10-06, and secondary reference AIX71-MP1197787. It exposed PROMAN AIX EXPERTISE 2 as displayed company/staffing agency, left employer unresolved, suppressed employer confirmation and offered branch agency confirmation. An identical repeat reused the observation/canonical, retained a single source observation and left assignment history unchanged. Stored selected HTML contained no app-state attributes/scripts. The live database was opened read-only and was not changed; backend restart and live recapture remain pending.
