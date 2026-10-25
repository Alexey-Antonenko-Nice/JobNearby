# Michael Page France selected vacancy

Validated from saved observation `49e72d11-361b-4682-82d1-bf3100cb67ee`, canonical `d9286dca-4ead-4478-a136-e4132aa8d68d`. The original stored HTML was opened through a read-only SQLite connection before implementation. No live request, live database write, schema change or commit is involved.

## Diagnosis and supported scope

There was no Michael Page provider rule. The observation had no external reference or mapped title, location or contract. Its saved JobPosting JSON-LD also contains literal control characters in its description string and fails JSON parsing. Whole-page extraction could instead consume navigation and the **Offres similaires** aside, including its salaries, locations and CDI contracts.

`MICHAEL_PAGE` supports `michaelpage.fr` / `www.michaelpage.fr`, route `/job-detail/<slug>/ref/jn-<six digits>-<digits>`. References are normalized to lowercase. Query parameters do not define identity; the original source URL remains unchanged. No other PageGroup domains or providers are broadened.

## Boundary and identity validation

The saved page has a unique `job-apply-block-container` header and a unique `article.job-advert`, both with matching `about` URLs. The complete article's `#job-description` contains the company description, missions, candidate profile, conditions/advantages and contact/reference fields. `#summary` independently supplies location, contract and reference. The selected projection retains these blocks and the validated Apply action; tab navigation and the related-jobs aside are excluded.

The route, supplied external ID, both `about` URLs, displayed contact reference, summary reference, Apply URL, selected vacancy links and canonical/OG URLs must agree. Header location/contract/telework values must agree with their summary counterparts. Duplicate or missing articles, incomplete descriptions, hidden selections and mismatches fail closed. Related-offer IDs outside the article are not selected-vacancy evidence. Associated valid JobPosting records are checked for identity disagreement but do not inject generic facts.

Legacy stored observations are transiently rescoped from original HTML, discarding stale mapped title, company, location, contract, salary, publication and raw-text projections. The original stored content remains immutable. Missing or rejected selected contexts cannot fall back to unrelated page content.

## Extracted facts and limits

- Reference: **jn-082026-7089819**.
- Title: **Ingénieur Conception Mécanique H/F**.
- Workplace: **Neuilly-sur-Seine**, agreeing between the header and summary. The description's broader “Paris Ile de France” wording remains in the full text; no geographic reconciliation is invented.
- **Interim → INTERIM**. Neighboring CDI labels never enter the selected projection.
- Publication: **Ajoutée le 25/08/2026 → 2026-08-25**, validated as a calendar date and retained as literal publication evidence.
- **Télétravail possible** is retained in selected text and `teleworkText` metadata. The full description additionally preserves “Possibilité de télétravail 1 jour / semaine une fois formé(e) et autonome.” Normalized work mode remains **UNKNOWN**: neither the optional label nor the JSON-LD `TELECOMMUTE` supplies fully remote status. No schedule beyond the displayed wording is invented.
- Salary remains **UNKNOWN**. The selected article has no salary, and the JSON-LD salary object is empty. Neighboring Toulouse/Cergy Pontoise/Massy/Lisses salary ranges are excluded.

Michael Page branding identifies the publisher. The selected company paragraph says **mon client**, and the selected summary names a consultant. Together these support **Michael Page / RECRUITMENT_AGENCY** evidence (canonical role RECRUITER). The JSON-LD `hiringOrganization: Michael Page France` is not treated as the legal employer. No client name is present: “un groupe français…” is descriptive, not a named organization, and the employer remains unresolved. Human decisions are not created or overwritten. Removing the vacancy-level client wording removes this provider's intermediary assertion.

## Continuity and verification

A new identified capture can reuse the unidentified observation's canonical only when exactly one existing canonical matches and both old/new saved HTML, plus all existing canonical members, independently validate the same reference. No automatic canonical merge is performed.

`tests/fixtures/michaelPageSelectedVacancy.html` preserves the saved page's structural classes, selected article, description and related offers. Executable scripts, styles, SVGs, iframe content and resource-source attributes are stripped; the original malformed JSON-LD is retained as a regression input. Tests cover complete-description retention, related salary/location/contract contamination, telework uncertainty, corrected JSON-LD role/mode safety, genuine ID conflicts, missing/ambiguous selection, an unnamed client and preserved human role/interaction decisions across identical and changed recapture.

Set `MICHAEL_PAGE_STORED_REPLAY=1` when running `tests/acquisition/MichaelPageSelectedVacancy.test.ts` to replay the actual stored observation. The test opens the source database with `readonly: true`, serializes it to a private in-memory database and performs all processing writes there. It verifies the original canonical above, repaired facts, identical recapture, preserved decision/assignment histories and unchanged original observation.

Validation: **15 focused tests passed**, including the actual stored replay. Full backend verification passed **2,104 tests in 136 files**, with 2 existing opt-in tests skipped; Michael Page and Renault stored replays were enabled. Typecheck, backend build and diff checks passed.
