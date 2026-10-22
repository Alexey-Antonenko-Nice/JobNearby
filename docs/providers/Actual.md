# Actual direct vacancy capture

| Capability | Status |
| --- | --- |
| Provider | `actualgroup.com`, acquisition key `ACTUAL` |
| Direct page | Validated French offer heading/cards and Le poste / Le profil recherché / L'entreprise sections |
| Stable identity | `/offres-emploi/<slug>-re<digits>a<digits>` → uppercase canonical reference |
| Reference validation | Canonical/og URLs and any explicit current offer reference must agree; identity conflicts fail closed |
| Title | Actual h1, removing only the accessibility-only “Offre d'emploi :” wrapper |
| Workplace | Explicit city/postcode/region badge retained together in existing location rawText |
| Agency address | Retained in bounded HTML, excluded from workplace evidence and generic extraction text |
| Contract | CDI/CDD/intérim badges → existing normalized terms |
| Hours | Explicit Temps plein / Temps partiel badge, or explicit wording in Le poste; no inference from CDI/opening hours |
| Position count | Exact positive count in Nous recrutons associated with the current heading's role; contradictory counts withheld |
| Salary | Live compensation UNKNOWN; other salary formats remain unsupported rather than inferred |
| Agency identity | Exact agency card link name; explicit agence d'intérim → STAFFING_AGENCY |
| Client semantics | Explicit recruiting-for-client wording supports intermediary status; unnamed employer remains unresolved |
| Category | Metadata retained in source; job family is not asserted as employer industry |
| Agency memory | Exact normalized name only; branch confirmation/reuse tested without parent/other-branch aliases |
| Recapture | Exact source reuse/occurrence increments and changed same-ID snapshot/canonical continuity tested |
| Live regression | Saved full-page replay passed in an isolated database copy; restart/actual recapture pending |

The old generic path had no Actual provider/reference rule or vacancy context.
It left title/location unknown and scanned the company section as prose. The
L'entreprise heading, Actual Strasbourg subheading and Actual Schiltigheim
sentence could be combined into a malformed recruiter identity.

The locator now requires one main, one current heading section with exactly one
title card and one explicit agency card, plus the three current-job sections.
It reconstructs context HTML from those cards and job sections. Navigation,
600+ agences promotion, application forms, recommendations, related vacancies,
footer and unrelated agency-finder cards are excluded.

Context HTML keeps agency address, phone, email and opening hours, as well as the
company section, for audit. Generic extraction text contains only title metadata,
Le poste and Le profil recherché. Provider-specific extraction reads the agency
card separately. This prevents both agency-address contamination and company
prose concatenation without stripping arbitrary prefixes from organization
names. `Actual emploi Schiltigheim` is emitted literally, once per supported role;
no parent/prose-derived organization identities are manufactured.

The workplace badge is `STRASBOURG, 67100, Grand Est`; the contact address
`22 avenue De L'Europe · 67300 Schiltigheim` never becomes workplace evidence.
Current contact storage has no suitable agency-contact projection, so those
details stay source-only. Start/working-date prose and category remain bounded
source facts without adding fields or taxonomies.

The saved h1 spells `Teleconseiller (H/F)` without an accent. That literal heading
is preserved. A supplied accented `Téléconseiller (H/F)` is also preserved; no
dictionary/spelling correction is invented. Position-count matching normalizes
accents/case only to associate `Nous recrutons 10 Téléconseillers clientèle...`
with the current heading, then emits EXACT 10 through existing position-count
evidence. Missing, zero, unrelated-role or disagreeing current-role counts do not
produce an exact count. Agency/recommendation numbers are never count sources.

Agency-card wording `Agence d’intérim, emploi, recrutement, CDI, CDD et missions
temporaires` establishes staffing status. The separate Le poste wording
`pour l'un de nos client` reinforces the intermediary relationship. Recruiting
for a client can independently support RECRUITMENT_AGENCY when the card does not
state staffing. Generic design/consulting agency wording alone cannot. Existing
employer-confirmation rules suppress the branch as employer whenever that
intermediary evidence exists. Human agency confirmation remains separate.

The saved JSON-LD graph describes the website/homepage/global Actual group
publisher, not a current JobPosting. Inspected Nuxt data likewise did not expose
a uniquely matched current offer record. Neither is used to supply vacancy or
employer facts. A structured JobPosting's explicit reference/URL, if present,
must be consistent; its title, company, salary and employment fields cannot
override the validated DOM or client/intermediary semantics. Original page and
scripts remain in immutable source HTML.

Parent `Actual`, `ACTUAL MARSEILLE` and `Actual emploi Schiltigheim` remain
different exact normalized identities. Tests verify parent/other-branch agency
memories do not propagate fuzzily. The new branch may be confirmed separately,
then reused for later exact branch-name matches without another human record.
No employer is automatically confirmed and no schema migration is introduced.

On unsafe/ambiguous boundaries or inconsistent IDs, trustworthy URL identity is
retained but mapped legacy fields/full-page text cannot supply vacancy facts.
Old ID-less observations are not automatically merged/backfilled: first capture
with recognized identity can create a newly identified canonical. Subsequent
same-ID snapshots follow existing fingerprint/occurrence rules. No immutable
source, assignment history or live database is rewritten by implementation.

Unsupported variants include other domains, English `/en/jobs` routes,
search/results or agency-finder pages, alternate card/section markup, missing
required agency/profile/company sections, nonstandard workplace badges, and
salary extraction outside this live salary-free case.

## M13.6 files

- `src/application/acquisition/ActualVacancy.ts`
- `src/application/acquisition/ConservativeProviderVacancyIdExtractor.ts`
- `src/application/acquisition/HostnameAcquisitionProviderRecognizer.ts`
- `src/application/acquisition/ProviderCaptureRegistry.ts`
- `src/application/evidence/ActualVacancyEvidenceExtractor.ts`
- `src/application/evidence/scopeActualVacancyEvidence.ts`
- `src/application/evidence/createVacancyEvidenceExtractor.ts`
- `src/application/evidence/scopeProviderVacancyEvidence.ts`
- `src/application/evidence/CoreVacancyHeaderFactsExtractor.ts`
- `src/domain/acquisition/ProviderKey.ts`
- `src/domain/acquisition/AcquisitionContext.ts`
- `tests/acquisition/ActualDirectVacancy.test.ts`
- `tests/infrastructure/recruitingAgencyMemory.integration.test.ts`
- `tests/fixtures/actualDirectVacancy.html`
- `docs/providers/Actual.md`
