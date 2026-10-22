# Start People direct vacancies

Supported: `https://[www.]startpeople.fr/offre-emploi/<location>/<slug>/<numeric-offer-number>`.
No migration or source-observation rewrite is required. This provider is registered as `START_PEOPLE` with source name `startpeople.fr`.

## Identity and boundary

The URL supplies the stable numeric identifier. A unique main/h1, summary cards labelled with `name-zone`, and the two `description-offre` sections (Description du poste / Profil recherché) establish the supported boundary. The visible offer number must agree with the URL. Application links, bookmark reference attributes and canonical/open-graph vacancy URLs are checked for contradictions. Conflicting matched JobPosting identifiers also invalidate the boundary.

Only the title, summary cards and description/profile are retained in selected HTML. Navigation, share controls, advantages chrome, recommendations, footer and generic marketing elsewhere on the page are excluded. Agency labels remain in bounded HTML; agency cards are omitted from generic text extraction so agency contact addresses do not become workplace facts.

Missing/duplicate required components, ambiguous pages and unsupported routes fail closed. A trustworthy URL identifier survives boundary failure, but source title/company/location/salary/contract and full-page raw content cannot feed vacancy facts. Original HTML is revalidated even for old captures that predate provider support; extraction uses a transient view and leaves immutable observations unchanged.

## Supported evidence

- Title: literal h1 text, including punctuation and source spelling.
- Workplace: the Localisation summary card, never the agency address. Saved regression: `STRASBOURG (67)`.
- Salary: explicit `entre <decimal> et <decimal>€ / an|mois|heure`, with decimal dot or comma. Currency EUR and period come from that expression; reversed/malformed ranges fail closed. The complete visible range is ordinary compensation evidence, not a hidden structured projection.
- Contract: explicit CDI, CDD or intérim in the contract card. CDI does not imply full-time.
- Hours: explicit current-vacancy Temps plein/Temps partiel, or FULL_TIME/PART_TIME from a unique identity-matched JobPosting. Structured hours retain a normal evidence item with `JobPosting[offer-number].employmentType=...` raw terms and DIRECT_FIELD provenance. All provider facts identify SELECTED_VACANCY_CONTEXT as content origin.
- Experience: summary/profile numeric French ranges and separate `N ans minimum` statements. Distinct ranges remain distinct in the existing canonical requirement collection. A range's upper endpoint is not separately parsed as a new minimum. Language/travel extraction still runs normally on bounded text.
- Publication: the visible Publiée le day/month/year maps to existing source `publishedAt` support with calendar validation.
- Sector: retained in bounded source context. BTP is not promoted to employer industry without adequate employer-specific evidence; no taxonomy expansion.
- Offer number: ordinary provider externalIdentifiers evidence.

## Organization and human review

The exact Votre agence label becomes DISPLAYED_COMPANY. That label plus the current job's explicit `Notre client ... recherche/recrute` relationship supports STAFFING_AGENCY (the saved source misspells recherche as recheche, also supported). Generic agency wording alone does not support staffing. An unnamed client stays unresolved; no client identity is invented from the agency name. Existing named-client extraction remains available for explicit names.

Existing review rules suppress Confirm as employer for a staffing branch. Human Confirm as recruiting agency remains available unless the exact normalized branch is already remembered. Confirmation writes existing agency memory only, not employer confirmation. A later exact branch match uses AGENCY_MEMORY without repeating confirmation. Parent Start People and other branches are not fuzzy aliases.

## Saved regression and previous discrepancy

Offer 9481983's saved JSON-LD contains identifier and URL 9481983, title, datePosted 2026-09-15, FULL_TIME, workplace STRASBOURG/Grand Est/FR, salary EUR 28000–38000 YEAR, hiringOrganization Start People STRASBOURG BTP and industry BTP. Its bookmark data repeats the reference and visible salary/contract/experience. Bookmark values are not a second opaque fact source.

Previously there was no provider registration, ID rule or locator. Generic JSON-LD projection supplied source salary `28000 - 38000 EUR / YEAR` and source contract `FULL_TIME` directly to canonicalization. Generic visible salary extraction recognized only the currency-adjacent `38000.00€ / an` endpoint because the lower endpoint has no currency symbol. Direct field hours evidence did not recognize underscore-form FULL_TIME, while the canonical source-contract path did. The provider now strips those opaque mapped fields from canonical derivation and produces ordinary bounded salary/contract/hours evidence instead. Structured salary/location/company never silently override the visible cards.

Experience 2–3 years comes from the summary. `Expérience de 2 à 5 ans minimum` is genuinely in this job's profile. The previous separate `5 ans minimum` was an overlapping second parse of that same sentence, not another source. Both distinct ranges survive; the overlapping minimum disappears. Existing canonical semantics represent them as a requirement collection, not a newly invented conflict status.

Only unique identity-matched JobPosting hours are consumed; unrelated or ambiguous structured jobs cannot inject facts. Other structured fields and Drupal embedded bookmark state are deliberately not used as fallback evidence. Unsupported salary grammars, absent visible salary, alternative page layouts/listings/agency pages and parent/branch aliases remain unsupported.

## Recapture and verification

Exact same-provider/ID/fingerprint captures reuse the immutable SourceObservation and increment occurrences while reprojecting canonical state. Changed snapshots keep provider identity and canonical continuity but create a new observation. Integration tests cover occurrence increments, unchanged observations and assignment history, one unresolved employer cluster, agency confirmation, and later exact-branch memory. No new recognition or confirmation actions are replayed solely because of an exact recapture.

First capture after this upgrade may have a changed fingerprint because the provider context and mapped header fields changed. Historical captures with no provider ID are not automatically merged or backfilled into a newly identified canonical vacancy. Restart and recapture are needed for the live workflow; saved-snapshot validation does not mutate the live database.

## Implementation and validation

Added files:
- `src/application/acquisition/StartPeopleVacancy.ts`
- `src/application/evidence/StartPeopleVacancyEvidenceExtractor.ts`
- `src/application/evidence/scopeStartPeopleVacancyEvidence.ts`
- `tests/acquisition/StartPeopleDirectVacancy.test.ts` (37 cases)
- `tests/fixtures/startPeopleDirectVacancy.html`
- `docs/providers/StartPeople.md`

Updated files: `ConservativeProviderVacancyIdExtractor.ts`, `HostnameAcquisitionProviderRecognizer.ts`, `ProviderCaptureRegistry.ts`, `CoreVacancyHeaderFactsExtractor.ts`, `ExplicitCandidateRequirementsExtractor.ts`, `createVacancyEvidenceExtractor.ts`, `scopeProviderVacancyEvidence.ts`, `AcquisitionContext.ts`, `ProviderKey.ts`, and `recruitingAgencyMemory.integration.test.ts` (one additional parent/branch isolation test). Existing uncommitted M13.6 Actual work is preserved.

Validation: focused acquisition/evidence/canonicalization/user/recognition/agency-memory/recapture/runtime suite passed 1,253 tests in 80 files. Full backend suite passed 1,652 tests in 120 files; UI suite passed 60 tests in 4 files. Backend build, UI build, typecheck and diff check passed. Controls include Actual, Crit, Synergie, Randstad, Adecco, Manpower and LinkedIn recruiter safety.

A replay of the original saved 9481983 snapshot in an isolated in-memory copy of the live database produced the expected title/workplace, full salary range, CDI plus explicitly sourced FULL_TIME, both genuine experience ranges, the staffing branch, an unresolved employer, no employer confirmation candidate and an agency confirmation candidate. An identical repeat reused the observation/canonical and left assignment history unchanged. The live database was opened read-only and was not changed.
