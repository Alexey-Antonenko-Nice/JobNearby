# APEC (apec.fr)

Provider key `APEC`, source name `apec.fr`. Scope of this task: vacancy identity, selected-vacancy isolation and salary normalization. Skills, education and travel extraction are deferred.

## Identity

- The APEC reference (for example `179627528W`) is read from the candidate detail route `/candidat/recherche-emploi.html/emploi/detail-offre/<reference>` and must be confirmed by the selected article's `Ref. Apec :` line.
- `Ref. Société` (for example `2727430`) is the employer's own number. It is kept as context metadata only and is never an external identifier.
- All identity sources are compared: URL, article reference, article apply links (`#candidature/promotion/<id>`), article detail links, `canonical`/`og:url` links that carry a detail id, and a single JSON-LD identifier if present. More than one distinct APEC id, or a company reference equal to an APEC id, is a `CONFLICT`: no selected context and no external ID are published. A page without a verifiable reference is `UNVERIFIED` and is treated the same way.
- Source of truth: `src/application/acquisition/ApecVacancy.ts`.

## Selected-vacancy boundary

The selected vacancy is the single `<article>` inside the single `apec-detail-emploi` module, plus the one `<h1>` that sits outside the article (in `apec-header-nav`). The share widget is removed. The sibling `<aside class="map-zone">` (map, "Localisation du poste", "Autres postes qui pourraient correspondre") and previous/next navigation are never included.

The locator fails closed (no context, no fallback to page text) when there is not exactly one detail module, article or heading, the heading is inside the article, the reference block is missing or malformed, the article is hidden, a label repeats, or the bounded region contains navigation, aside, footer, form, map or recommended-job markers. Stored observations are re-scoped the same way at evidence time (`scopeApecVacancyEvidence`), so old captures are revalidated rather than trusted.

No DOM structure beyond the stored capture (observation `9a26205a-3f48-48cb-9a23-552ffd1cc29b`) was assumed. The fixture `tests/fixtures/apecSelectedVacancy.html` is the `<main>` of that capture plus its canonical links.

## Fields and salary

Title, displayed company, location (`Strasbourg - 67`), contract (`CDI` → `INDEFINITE`, `CDD` → `FIXED_TERM`) and published date come from the selected article. `50 - 55 k€ brut annuel` becomes EUR 50000–55000 per YEAR with the original text and selected-context provenance preserved. A salary without an explicit period (`annuel`/`mensuel`) is not normalized. If the matched JSON-LD `baseSalary` disagrees with the visible text, only the original text is kept.

The location text of the earlier capture (JSON-LD `STRASBOURG, STRASBOURG, FR`) changes to `Strasbourg - 67` after re-scoping.

## Company vs. employer

`Meent Life Sciences` is recorded only as `DISPLAYED_COMPANY`. No `EMPLOYER` or agency role is inferred; confirmation remains a human decision.

## Continuity

Observations captured before the reference was recognized have no external ID. `resolveLegacyApecContinuity` (called from `processVacancyObservation`) lets a new identified capture join the existing canonical vacancy only when: the reference is validated; no claim exists yet; the earlier observation re-validates to the same reference (and the same company reference when both exist); exactly one canonical vacancy results; and its other members carry no, or the same, external ID. Otherwise a separate canonical is created. Human decisions are keyed to the canonical vacancy and are therefore preserved. Identical recaptures reuse the observation and add a capture occurrence.

No schema migration. The only repository addition is the optional read method `findUnidentifiedBySourceUrlFragment`.

## Live verification

1. Stop the running capture server, then `npm run capture:server` (builds first). Reload the browser extension only if it was changed (it was not).
2. Re-capture the same APEC detail page.
3. Expect: new observation with `external_id = 179627528W`, same canonical `c4b217d9-dd36-41cc-8d4a-2badd1a804f8` (no duplicate), salary EUR 50000–55000 YEAR, Meent only as displayed company. Check with `npm run diagnose:captures`.
