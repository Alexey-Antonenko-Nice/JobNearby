# Synergie France

| Capability | Status |
| --- | --- |
| Provider | `synergie.fr`, acquisition context `SYNERGIE` |
| Direct vacancy | Supported for the validated single-article heading/details/description layout |
| Stable identity | `/trouver-un-emploi/<slug>/offre-<digits>-<digits>`; URL reference retained exactly |
| Reference validation | Each rendered details card must agree with URL; `OFFRE - 626 659` normalizes to `626-659` |
| Title | Actual h1 takes precedence over page/JobPosting SEO title |
| Location / postal code | Mission location retained together in existing rawText, e.g. `Bischheim - 67800` |
| Contract | Interim → INTERIM; explicit CDI/CDD supported; no inferred hours |
| Salary | EUR amount or range, including K€; no period inferred from thousands notation |
| Salary period | Explicit visible period, or a unique reference-matched structured salary with agreeing amounts/currency |
| Publication | Existing SourceObservation.publishedAt, parsed from the bounded DD/MM/YYYY field |
| Availability | Bounded source-only; no suitable current start/end availability projection |
| Métier | Preserved as source category; not emitted as a second title |
| Recruiter | Recruiting sentence identifies `SYNERGIE Haguenau`; one logical candidate |
| Named client | Existing explicit client extraction only; location/sector/descriptions do not identify unnamed clients |
| Agency memory | Human confirmation and exact normalized name reuse tested; employer remains independent |
| Recapture | Exact observation reuse/occurrence increment and changed snapshot/canonical continuity tested |
| Live regression | Saved full-page replay passed in an isolated database copy; restart and actual recapture pending |

The provider previously had no registered direct URL identity rule or selected
context locator. Generic whole-page/structured extraction could use the SEO title,
miss `35-40 K€`, and expose competing recruiter names from overlapping rules.

The locator requires one article, one h1, one or two agreeing details cards, and
exactly one section each for Descriptif du poste, Profil recherché and A propos de
notre client. It rebuilds a context from that heading, one validated card and
those sections. Responsive cards must agree on reference and facts. Related-job
sections, navigation, footer, recruitment marketing/benefits, agency finder and
publisher/contact cards do not enter vacancy evidence. Unrelated amounts in
recommendations or description cannot become salary: only the Salary card field
is parsed. The generic header extractor yields to the provider's labeled facts.

The recruiter duplication came from `extractBoundedOrganizationRoles`: the
`notre agence NAME recrute` rule captured the name, while a capitalized sentence
rule captured `Notre Agence NAME` before the same recruiting verb. Introductory
Agence / Notre Agence is now normalized only in these recruiting-sentence rules.
Explicit organization labels and arbitrary stored/company names retain their
prefixes. The generic fix is tested independently of Synergie names.

The saved page has a JobPosting whose identifier is `OFFRE - 626 659`. Its title
is an SEO wrapper and it contains no salary or annual period. Embedded Next.js
state repeats page content; it is not executed or used as an independent salary
source. Only a unique identity-matched JobPosting may supply salary-period
metadata. Its title, employer/publisher name, description and validity date never
override the selected vacancy facts or identify the client. Conflicting explicit
references fail closed; duplicate structured matches disable that source.

For the regression, compensation resolves to raw `35-40 K€`, EUR minimum 35000,
maximum 40000, and absent period. Availability `Du 26/10/2026 au 28/12/2026` stays
in source context. JobPosting.validThrough is not treated as mission end date.
The employer remains an anonymous unresolved cluster; agency confirmation never
automatically confirms an employer.

Branch-name alias debt remains: `SYNERGIE Haguenau` and parent `Synergie` are not
exact normalized matches. No brand/branch alias propagation is introduced.
Old observations without an external ID are not automatically merged with new
identified captures. First recapture can create a newly identified canonical;
subsequent same-ID captures follow normal fingerprint/occurrence rules. No source
rows, assignment history or live database are rewritten by this implementation.

Unsupported layouts include other Synergie domains, search/results panes,
alternate direct markup, missing required sections/cards, disagreeing responsive
copies and unrelated currencies. Unsafe boundaries retain trustworthy URL identity
but yield no whole-page vacancy facts, including during legacy reprocessing.
No schema migration is introduced.

## M13.4 files

- `src/application/acquisition/SynergieVacancy.ts`
- `src/application/acquisition/ConservativeProviderVacancyIdExtractor.ts`
- `src/application/acquisition/HostnameAcquisitionProviderRecognizer.ts`
- `src/application/acquisition/ProviderCaptureRegistry.ts`
- `src/application/evidence/SynergieVacancyEvidenceExtractor.ts`
- `src/application/evidence/scopeSynergieVacancyEvidence.ts`
- `src/application/evidence/scopeProviderVacancyEvidence.ts`
- `src/application/evidence/createVacancyEvidenceExtractor.ts`
- `src/application/evidence/CoreVacancyHeaderFactsExtractor.ts`
- `src/application/evidence/ExplicitTextVacancyEvidenceExtractor.ts`
- `src/domain/acquisition/ProviderKey.ts`
- `src/domain/acquisition/AcquisitionContext.ts`
- `tests/acquisition/SynergieDirectVacancy.test.ts`
- `tests/evidence/ExplicitTextVacancyEvidenceExtractor.test.ts`
- `tests/fixtures/synergieDirectVacancy.html`
- `docs/providers/Synergie.md`
