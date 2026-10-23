# Direct Emploi (`directemploi.com`)

Provider key `DIRECT_EMPLOI`. Hosts `directemploi.com` and `www.directemploi.com` only, with source name `directemploi.com`.

## Identity

- The **posting ID** comes only from the URL path `/candidatOffre/<digits>` (for example `56666163`). Tracking parameters such as `utm_source` are ignored. It becomes the observation `externalId`.
- The **displayed reference** (the `#` badge and the JSON-LD `identifier`, for example `31223894`) is a different identifier. It is stored as `DIRECT_EMPLOI_REFERENCE`; the posting ID is `DIRECT_EMPLOI_POSTING_ID`. The two are never required to match.
- Posting-ID sources are compared with each other: URL, JSON-LD `url`, canonical/`og:url`, share links, copy-link `data-url` and the hidden application form `id_offre`. Any disagreement is a conflict: no external ID and no selected context are published. Two disagreeing displayed references are also a conflict.
- Similar-offer links on the page are never an identity source.

## Selected vacancy boundary

The bounded context is the single `h1.job-title`, the header facts (date, contract and reference badges, company, location) and `div.job-details` (company card, "Description de l'offre", "Profil recherché").

Excluded: breadcrumb (`#fil_ariane`), site navigation, share, apply and favourite widgets, the application form, alert modal, similar offers and footer.

The locator fails closed (no context, no fallback to page content) when the page does not have exactly one `h1`, one `job-header` and one `job-details`, when the heading is outside the header, when the description section is missing, when foreign modules appear inside the region, or when a JSON-LD posting describes a different title or company.

## Evidence

- Title: the vacancy heading only. The breadcrumb text is no longer role evidence.
- Location: `City, Region` from the header, as workplace.
- Contract: the `Interim` badge and the matched JSON-LD `TEMPORARY` are kept as **one compatible engagement** with raw terms `["Interim", "TEMPORARY"]` and normalized terms `["INTERIM", "TEMPORARY"]`. `TEMPORARY` alone never implies agency work.
- Organizations: the displayed company (`sup interim`) is recorded as `DISPLAYED_COMPANY`. It also receives `STAFFING_AGENCY` only with explicit evidence (an `Interim` contract badge or "recherche pour son client" wording). No `EMPLOYER` is inferred and no `CLIENT` is emitted, because the client is unnamed. The client's identity is not guessed from the activity description.
- Name variants in the description (for example "Sup Intérim Strasbourg") stay separate evidence; they are not merged with the displayed name.
- Salary: none; "Rémunération à convenir" is not a salary.

Every item carries `SELECTED_VACANCY_CONTEXT` provenance.

## Continuity

Captures made before this provider existed have no external ID. When the same validated posting ID arrives, `resolveLegacyDirectEmploiContinuity` attaches the new observation to the existing canonical vacancy only if exactly one such canonical is found, the earlier stored HTML re-validates through the locator with the same posting ID, and displayed references do not disagree. Otherwise a separate canonical is created. Identical recaptures reuse the observation and add a capture occurrence. Human decisions are keyed by canonical vacancy and are preserved. No schema change is involved.

A new `UNRESOLVED` "Unknown employer" cluster is created for any new vacancy as usual. It does not resolve Sup Intérim as an employer; existing assignments are never rewritten.

## Live verification

1. Stop the running capture server and start it with `npm run capture:server` (it builds first).
2. Re-capture the same Direct Emploi page.
3. Expected: a new observation with external ID `56666163` attached to the existing canonical vacancy (no duplicate), a single heading-derived title, one `Interim` + `TEMPORARY` engagement, no breadcrumb alternative, `sup interim` as displayed company and staffing agency without employer or client.
4. `npm run diagnose:captures` confirms the continuity.

Tests: `tests/acquisition/DirectEmploiSelectedVacancy.test.ts`, fixture `tests/fixtures/directEmploiSelectedVacancy.html`.
