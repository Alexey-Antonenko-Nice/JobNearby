# Adecco capture capability

| Capability | Status |
| --- | --- |
| Provider / namespace | Adecco / `adecco.com` |
| Search-results selected pane | Supported: French `/fr-fr/offres-emploi` with one `section.job_Details`, selected header, description, reference, and matching direct-detail link |
| Direct vacancy page | Not validated; text extraction remains disabled. An explicit ID in a recognized direct URL may be retained. |
| External ID | Supported: selected `.job-id` reference must agree with `.static_jobdetailpage_url` and any other explicit pane ID |
| Salary | Selected header euro ranges with Annuel / Mensuel / Heure |
| Contract / full-time | Explicit selected metadata; CDI does not imply full-time |
| Location | Selected `location_on` metadata, independent of search location |
| Position count | Positive integer, projected into the existing EXACT canonical position-count field |
| Contract start date | Retained in immutable bounded source context; no suitable canonical start-date field currently exists |
| Agency/client separation | Conservative: explicit named recruiting cabinet evidence only; no employer or agency identity from hostname |
| Agency memory | M12.10 confirmation and exact-name reuse tested; employer remains independent |
| Recapture | Exact observation reuse, occurrence increments, changed snapshots with the same ID, and employer continuity tested |
| Structured data | Page-level scripts/state are excluded. The saved live regression contains no JSON-LD JobPosting. |
| Live regression | Saved-page replay tested; pending a real recapture after backend restart |

Regression: Technicien de Maintenance (h/f), STRASBOURG, Bas-Rhin, EUR 34,000–44,000 / YEAR, CDI, Temps plein, one position. Stable reference: `2129846001`.

Missing/ambiguous boundaries, multiple selected panes, conflicting references/links/attributes, and embedded result cards fail closed. Unsupported localized layouts, alternate detail components, apply-only identity variants, and direct-page extraction need separate validation. No title/location/salary/search-query identity fallback is used.

The previous live observation has no external ID. It remains immutable; a first newly identified capture may receive a separate canonical identity. No backfill or merge is performed by this milestone. Existing no-match employer fallback semantics are unchanged.
