# Gi Group direct vacancy capture

## Supported route and stable identity

French direct pages at `https://fr.gigroup.com/detail-offre-emploi/<slug>/<numeric-id>/` are supported. Source name is gigroup.com; provider key is GI_GROUP. The route's positive numeric ID is primary; titles and locations do not establish identity. Other hostnames/routes are not validated for direct vacancy extraction.

The saved regression is offer **85929**. Its JobPosting identifier, print Code de référence, current application URL and current print/apply CTA offerNumber agree. Current-detail data-offer-id/job-id/reference attributes, canonical/open-graph URLs and the official printable URL/reference are checked if present. Similar-job CTA IDs inside the recommendation widget are excluded from these checks. The unlabelled numeric category metadata value 725571 is not treated as the primary route identifier.

One contradictory current reference invalidates the context while preserving a trustworthy URL ID. A single contradictory JobPosting also fails closed. Multiple unrelated postings cannot contribute facts; structured contribution requires exactly one posting explicitly matched by identifier or current URL, with no conflicting identifier/URL. No title/location matching is used.

## Boundary and title precedence

Exactly one ggp-job-detail-wrap and one contained ggp-job-detail column are required. Three ggp-job-detail-div-group sections identify feature badges, main description, and current job category/workplace metadata. The feature group, first bold description paragraph and Vos missions / Votre profil sections must be present in this supported layout.

The first vacancy description paragraph supplies **Technicien de Maintenance Itinérant H/F**. The SEO h1 (`Technicien de maintenance -h/f chez Strasbourg, Bas-Rhin`) and the generic JSON-LD title never override it. Missing/ambiguous actual body title fails closed rather than falling back to SEO text.

Selected HTML/text excludes the similar-vacancy sidebar, SEO heading, print duplicate, navigation/footer and the saved description's generic Gi Group company-marketing paragraph. Category metadata stays out of generic text extraction. Sidebar offers including Champigneulles, Montataire, Saint-Quentin-Fallavier, La Rochelle and Cergy cannot contribute titles, locations, compensation, contract, experience, employers or agencies.

The original full captured page remains immutable for audit. Every extraction reconstructs/revalidates a transient selected context, including old observations without a stored context. Stale mapped title/company/location/salary/contract and whole-page raw text are stripped from the canonical derivation input. Unknown/ambiguous boundaries never fall back to page-wide extraction.

## Supported facts

- Workplace: current workplace metadata's city/province links produce **Strasbourg, Bas-Rhin**. The explicit body Secteur géographique `Strasbourg - 67` is checked against the workplace city. If city/province metadata is absent, that bounded body field is retained instead. No SEO/sidebar location fallback or new geographic taxonomy is introduced.
- Engagement: explicit Cdi/CDI yields INDEFINITE; Temps plein yields FULL_TIME. Neither implies the other. Body/header contract contradictions stay conflicted under existing semantics.
- Compensation: only the Rémunération paragraph is parsed. `2300 € à 2800 €`, `2 300 € à 2 800 €` (including nonbreaking/thin spaces), and `2300€ - 2800€` yield EUR 2300–2800. Dot/comma decimals and supported brut/net suffixes are accepted. Original normalized paragraph text is retained. Malformed/reversed ranges fail closed without borrowing JSON-LD description or benefit amounts.
- Period: absent in the saved case. `bruts (base 35 heures)` does not imply HOUR or MONTH; nearby `1 mois de salaire` benefits do not supply a unit. An explicit `/ h`, `/ mois`, `/ an`, `par ...`, mensuel/annuel/horaire suffix may supply the period.
- Structured period: optional only when a unique identity-matched JobPosting contains an explicit HOUR/MONTH/YEAR unit and the exact same EUR minimum/maximum. A separate DIRECT_FIELD compensation evidence item records `JobPosting[85929].baseSalary: ... / UNIT`. The visible record stays literal and unitless unless it explicitly supplies a unit. Canonical reconciliation can enrich an identical unitless range with the explicit unit while retaining both evidence references; different currencies/ranges or contradictory explicit units cannot be combined this way.
- Weekly hours: `Base hebdomadaire: 37 heures (dont 8 heures supplémentaires)` remains bounded source-only. Existing models have no appropriate working-hours field; no schema change.
- Start date: `Date de prise de poste: Dès que possible` remains bounded source-only; no suitable start-date field is introduced.
- Publication: visible feature date 2026-10-21 maps to existing source publishedAt with calendar validation. Website/WebPage publication dates do not substitute for this vacancy date.
- Benefits and profile remain in bounded context. Existing language/experience/travel rules run only on that context. Unquantified experience does not acquire years from similar jobs.

Provider facts use normal SELECTED_VACANCY_CONTEXT evidence provenance. Header fields carried through acquisition are title/location/publication only; there is no opaque salary/contract/company projection.

## Structured data and staffing safety

The saved page has a website/WebPage graph and one matching JobPosting. The latter identifies 85929, provides the SEO title, a duplicate description, datePosted 2026-10-21, FULL_TIME, Strasbourg/Bas-Rhin, and hiringOrganization **Gi Group SpA**. It has no baseSalary or salary period. Website organization/marketing data and the duplicate structured description are not used as vacancy facts.

A unique matched JobPosting may supply the exact hiring-organization label and a strictly matching explicit salary period. Visible body title, feature engagement, workplace and publication take precedence; generic structured fields are not projected around the boundary guard.

On this known staffing provider, an explicitly identified Gi Group / Gi Group SpA organization is DISPLAYED_COMPANY and STAFFING_AGENCY. Other arbitrary hiring organizations are not classified as the provider's staffing business merely because they appear in JobPosting. If no unique matched organization is available, the legal SpA name is not invented from a logo or SEO wrapper.

The saved description explicitly says `Nous recherchons pour l’un de nos clients...`; that client is unnamed and remains unresolved. Even without that sentence, the provider's explicit staffing-company semantics support the Gi Group staffing role. No human confirmation is automatic. Normal explicit named-client evidence remains available for future vacancies.

Existing review rules suppress Confirm as employer for the staffing company and offer Confirm as recruiting agency if it is not already known. Human memory is exact normalized name only. Gi Group, Gi Group SpA, Gi Group Holding and related brands are not fuzzy aliases; provider classification does not merge their memory identities. Employer assignment and agency confirmation remain independent.

## Recapture, failure and limitations

Identical provider/ID/fingerprint captures reuse the immutable SourceObservation and increment capture occurrences while reprojecting canonical state. Changed snapshots create an observation and keep the same canonical vacancy. Integration tests verify unchanged original content, canonical identity, one unresolved employer cluster, stable assignments, repeated capture after human agency confirmation, and later exact-name agency memory without repeated confirmation.

First upgraded capture may have a changed fingerprint because selected context/mapped fields changed. Historical null-ID captures are not automatically backfilled or merged into newly identified canonical vacancies. Restart and recapture are needed for the live workflow; saved-snapshot replay does not modify the live database.

Unsupported: non-French hosts/direct-route variants, listings, missing/duplicate detail columns, alternate description/title structures without the supported mission/profile markers, ambiguous/conflicting current IDs, unmatched/ambiguous structured organization, additional salary grammars and agency-brand aliases. These fail closed or leave individual unsupported facts unknown.

## Changed files

Added: `src/application/acquisition/GiGroupVacancy.ts`, `src/application/evidence/GiGroupVacancyEvidenceExtractor.ts`, `src/application/evidence/scopeGiGroupVacancyEvidence.ts`, `tests/acquisition/GiGroupDirectVacancy.test.ts`, `tests/fixtures/giGroupDirectVacancy.html`, and this document.

Updated: ConservativeProviderVacancyIdExtractor.ts, HostnameAcquisitionProviderRecognizer.ts, ProviderCaptureRegistry.ts, CoreVacancyHeaderFactsExtractor.ts, createVacancyEvidenceExtractor.ts, scopeProviderVacancyEvidence.ts, AcquisitionContext.ts, ProviderKey.ts, ExistingPipelineCanonicalVacancyAdapter.ts, ExistingPipelineCanonicalVacancyAdapter.test.ts, and recruitingAgencyMemory.integration.test.ts. No schema migration or commit. Pre-existing package.json/package-lock.json edits are preserved.

## Verification results

Added 52 Gi Group acquisition/evidence/recapture cases, one agency-name memory-isolation case, and three canonical salary-unit reconciliation cases. Focused acquisition/evidence/canonicalization/user/recognition/memory/recapture/runtime verification passed **1,359 tests in 82 files**. Full backend verification passed **1,758 tests in 122 files**. UI passed **60 tests in 4 files**. Backend build, UI build, typecheck and diff check passed. Controls include PROMAN, Start People, Actual, Crit, Synergie, Randstad, Adecco, Manpower and LinkedIn recruiter safety.

Replaying the original saved 85929 page into a fresh in-memory database produced GI_GROUP selected context, numeric external ID 85929, the exact real body title, Strasbourg/Bas-Rhin, INDEFINITE + FULL_TIME, and RESOLVED EUR 2300–2800 with no period. The complete literal salary appears in normal bounded evidence. Publication is 2026-10-21; Gi Group SpA is displayed/staffing, the employer is unresolved, employer confirmation is absent and agency confirmation is available. No similar-job locations entered the context. An identical repeat reused the observation/canonical, raised occurrences to two, retained one source/one unresolved cluster and left assignment history unchanged.

The live database was opened read-only and was not changed. Backend restart and live recapture remain pending.
