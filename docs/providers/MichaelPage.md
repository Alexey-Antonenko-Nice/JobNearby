# Michael Page France selected vacancy

Validated against saved direct-detail observations, including `jn-102026-7118382`. Stored HTML was opened through a read-only SQLite connection. No live database write or schema change is involved.

## Diagnosis and supported scope

The original direct-detail locator required a publication date of the form `Ajoutée le ...`; it rejected the otherwise matching updated vacancy whose visible date is `Mise à jour le ...`. Whole-page extraction could instead consume navigation and the **Offres similaires** aside, including its salaries, locations and contracts.

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

For the newer supported vacancy **jn-102026-7118382**, the bounded header provides **Technicien(ne) SAV France (F/H)** and **Cosse-le-Vivien** (the description also spells it Cossé-le-Vivien). **CDI → INDEFINITE**, without inferring full-time employment or work mode. A selected annual EUR range such as `30 000€ - 40 000€ par an`, including spaced and `K€` variants, yields EUR 30000–40000/YEAR while retaining the raw text. The visible **Mise à jour le 06/11/2026** remains in the selected context as an update, not a publication date. Travel wording remains in the bounded description; it does not imply a work mode.

Compatible required-travel evidence is combined at canonicalization, preserving both source wordings and evidence references. `REGULAR` plus `FREQUENT` resolves to `FREQUENT`; incompatible requirements, frequencies, scopes or quantitative values remain conflicts.

Michael Page branding provides **DISPLAYED_COMPANY** evidence. The selected company paragraph says **mon client** or **notre client**, and the selected summary names a consultant. Together these support **STAFFING_AGENCY** and lower-confidence **RECRUITMENT_AGENCY** evidence, recommending STAFFING_AGENCY. The JSON-LD `hiringOrganization: Michael Page France` is not treated as the legal employer. No client name is present: business descriptions are not named organizations, and the employer remains unresolved. Human role alternatives remain available, with confirmation required for contradictory decisions. Removing the vacancy-level client wording removes this provider's intermediary assertion.

## Continuity and verification

A valid direct context and meaningful title pass the vacancy acceptance gate. An unsupported, incomplete, ambiguous or identity-conflicting layout remains a diagnostic observation and does not create a vacancy or employer assignment. Exact recaptures reuse the observation and increment its occurrence count; changed snapshots with the same identity retain the canonical vacancy and human decisions. No automatic canonical merge is performed.

`tests/fixtures/michaelPageSelectedVacancy.html` preserves the saved page's structural classes, selected article, description and related offers. Executable scripts, styles, SVGs, iframe content and resource-source attributes are stripped; the original malformed JSON-LD is retained as a regression input. Tests cover complete-description retention, related salary/location/contract contamination, telework uncertainty, corrected JSON-LD role/mode safety, genuine ID conflicts, missing/ambiguous selection, an unnamed client and preserved human role/interaction decisions across identical and changed recapture.

Set `MICHAEL_PAGE_STORED_REPLAY=1` when running `tests/acquisition/MichaelPageSelectedVacancy.test.ts` to replay the actual stored observation. The test opens the source database with `readonly: true`, serializes it to a private in-memory database and performs all processing writes there. It verifies the original canonical above, repaired facts, identical recapture, preserved decision/assignment histories and unchanged original observation.

The additional `michaelPageTechnicienVacancy.html` fixture covers the updated-date layout, client wording, visible compensation, and contaminated similar jobs. Set `MICHAEL_PAGE_TECHNICIEN_STORED_REPLAY=1` to replay the original captured page into a fresh in-memory database.
