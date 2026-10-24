# Renault Group Workday capture

Validated from observation `9bdc9cd9-56f0-444a-9938-1afb39bb5907`, canonical `68a6d5cf-a4f4-4f4a-86c5-830726badbf6`, captured 24 October 2026. The original HTML was inspected using a read-only SQLite connection before implementation. No live database writes, schema changes or commit are involved.

## Scope and identity

`RENAULT_WORKDAY` is restricted to `alliancewd.wd3.myworkdayjobs.com` and the `renault-group-careers` site. The validated route is `/fr-FR/renault-group-careers/job/[optional location/]<slug>_JOBREQ_<digits>`, with an optional trailing slash. `JOBREQ_50273077` is the saved case. The Apply URL in that page contains `//apply`; only the Apply suffix is normalized for comparison.

The route, supplied external ID, displayed requisition, selected Apply action, other selected job links, canonical/OG URLs when present, and associated JobPosting identifier/URL must agree. Conflicts and incomplete/duplicate vacancy fields fail closed for vacancy facts. A trustworthy route ID remains available. Unrelated structured postings do not supply facts. Other locales and layouts are unvalidated. Kelly-specific code and generic Workday ID rules are unchanged; other tenants do not gain JOBREQ support.

## Bounded evidence

The original standalone page uses `jobPostingPage`, not Kelly's `jobDetails`. Its heading is a single `jobPostingHeader`; labeled facts use `locations`, `time`, `postedOn`, `timeLeftToApply` and `requisitionId`. The selected HTML contains those fields, the complete `jobPostingDescription`, and the validated Apply action. The selected text contains one heading, fact values and the description.

Navigation, the “page is loaded” accessibility announcement, the `jobSidebar` marketing/video panels and unrelated jobs are excluded. Description-local inclusion, application and privacy paragraphs are retained through the final privacy-policy link. The JSON-LD description is not substituted: it appends sidebar marketing to the actual vacancy description.

Original observations remain immutable. Evidence extraction reconstructs the bounded context from saved HTML and discards stale mapped title/company/location/contract/salary/contact/raw text. Unsupported or conflicting captures cannot bypass the guard through those fields.

## Facts and distinctions

- Title: **CS27 – BAC+5 – Stage ingénieur digitalisation métier synthèse prestation véhicules H/F**.
- The description's **Société: RENAULT s.a.s.** supplies displayed-company and explicit employer evidence. **Renault Group** is retained separately as branding from `Careers | Renault Group`, not substituted for the legal employer. This does not create a human-confirmed decision.
- **Aubevoye** supplies the displayed workplace. Associated structured location evidence is retained verbatim in context metadata: `addressLocality: FR_REN_RSAS - Aubevoye (Guyancourt)`, `addressCountry: France`. It does not replace Aubevoye or establish a reconciliation between Aubevoye and Guyancourt. No inferred coordinates or geographic normalization are added.
- **Temps plein → FULL_TIME** and the title plus explicit stage description **Stage → INTERNSHIP** are compatible dimensions. The existing canonical engagement model combines both without a global reconciliation change.
- **Anglais requis** remains English / REQUIRED evidence through the existing requirements extractor.
- Salary and work mode are **UNKNOWN** for this capture. Working at the test centre does not by itself establish a work-mode label.
- **Offre publiée il y a 2 jours** is retained as publication-relative text. The independently supplied JSON-LD `datePosted: 2026-10-22` supplies the absolute publication date; it is not computed from the capture clock.
- **Date de fin : 31 mars 2027 (Il reste plus de 30 jours pour postuler)** and JSON-LD `validThrough: 2027-03-31` are separate application-deadline metadata, never publication dates.

## Continuity and regression checks

The old observation had no external ID. A tenant-specific continuity resolver can attach a newly identified capture to exactly one existing canonical only after independently validating the old and new saved pages and every existing canonical member. It does not rewrite the old observation or its fingerprint. Ambiguous or incompatible membership fails closed.

`tests/fixtures/renaultWorkdaySelectedVacancy.html` preserves saved vacancy markup, JSON-LD, metadata and excluded panels. Executable scripts, styling, SVGs, extension attributes and resource URLs were removed; no live request is required. Regression tests cover evidence boundaries, identity conflicts, unsupported routes/tenants, stale projections, compatible engagement dimensions, canonical continuity, identical and changed recapture, and preserved human role/interaction decisions.

The optional actual-observation replay opens `job-nearby.sqlite` with `readonly: true`, serializes it into a private in-memory database, and runs capture processing there. Set `RENAULT_STORED_REPLAY=1` when running `tests/acquisition/RenaultWorkdaySelectedVacancy.test.ts`. It verifies the exact canonical ID above, repaired facts, identical recapture, preserved decision/assignment history and unchanged original observation. All writes occur only in memory.

Validation: full backend suite passed **2,020 tests in 128 files**, including the actual stored replay. Typecheck and backend build passed. Final focused checks passed **101 tests in 3 files**, covering Renault (including actual replay), Kelly and generic Workday controls. Whitespace/diff checks passed.

## Spanish vacancy in the French interface: JOBREQ_50271594

The original HTML of observation `ad559655-81c5-4b19-a2d7-fce07017bd1e`, canonical `0bbfb2dc-e930-4233-97df-9dabd5dc9cb1`, was inspected read-only. Its `/fr-FR/` URL and interface labels are French; its title and substantive description are Spanish. The locale is not evidence of the description's language or of a candidate language requirement.

**Exact failure:** after removing `jobSidebar`, the old locator passed the entire `jobPostingPage` to `renaultFacts`. This page contains three `similarJobsCard` entries after `job-posting-details`. Consequently the first labeled-field iteration (`locations`) found four elements and hit `if (found.length > 1) return undefined`. The same duplication affected time, publication and deadline fields. Even if that guard had been bypassed, the later selected-link check would have rejected related requisitions `JOBREQ_50278895`, `JOBREQ_50280911` and `JOBREQ_50276054`. Neither the short title “Becario” nor Spanish description text caused the rejection. The French `Société` / `Descriptif du poste` interface labels already bound the company name correctly.

The repair excludes only structurally validated related-job cards before selected-field and identity validation. Cards must follow the unique `job-posting-details` block and `similar-jobs-heading`, have one valid tenant job link, and contain no selected heading, description, requisition, Apply action or nested card. A related-card marker inside the selected details is rejected. Unmarked duplicate fields and conflicting selected links still fail closed. The selected description is preserved in full, independent of its language; no description wording is used to locate its boundary. Kelly and other tenants are unchanged.

Expected repaired facts:

- **Becario**, **Valladolid**, **RENAULT ESPAÑA, S.A.**, preserving accents and punctuation. Renault Group remains separate branding. There is no employer alias or automatic combination with **RENAULT s.a.s.**; an in-memory two-vacancy regression verifies distinct employer records.
- **Temps plein → FULL_TIME** together with **INTERNSHIP**, supported by the title, “La beca permitiría al estudiante adquirir conocimientos prácticos…” and supervised-work wording “bajo la tutela del equipo”. Raw Spanish training evidence is retained. A title or Spanish language alone does not supply internship evidence.
- No inferred language requirements, salary or work mode. The complete description, from training objectives through activities, student profile and the final application/privacy paragraphs, survives unchanged in the bounded projection.
- **Offre publiée il y a 2 jours** and JSON-LD **2026-10-22** remain publication evidence. **Date de fin : 9 novembre 2026 (Il reste 14 jour(s) pour postuler)** and **2026-11-09** remain distinct deadline metadata. Neighboring deadlines never enter this projection.
- Structured location `ES_REN_ESPANA VALLADOLID D.C.` / `Espagne` remains in metadata alongside displayed Valladolid, without inferred geographic reconciliation.

`tests/fixtures/renaultWorkdaySpanishSelectedVacancy.html` is derived from the actual saved HTML with the same inert-fixture sanitization as the French case. It retains all three related cards to reproduce the original boundary failure. `tests/acquisition/RenaultWorkdaySpanishVacancy.test.ts` covers full-description preservation, accents, dates, training evidence, no language inference, employer separation, selected-ID conflicts, duplicate-field controls, invalid card boundaries and preserved human role/interaction decisions.

With `RENAULT_STORED_REPLAY=1`, the Spanish regression also opens the saved database read-only and performs all replay writes on a serialized in-memory copy. It verifies the exact canonical above, repaired facts, unchanged original observation, preserved decision/assignment history and identical recapture. The older French duplicate-pair replay now permits reuse when a repaired observation already exists in the supplied database, while still checking continuity and immutable originals.

Validation for this repair: **119 tests in 5 focused files** and **2,038 tests in 130 backend files** passed with actual stored replays enabled. Typecheck, backend build and diff checks passed. No live database writes, schema changes or commit.

## Corroborated route suffix: JOBREQ_50267403-1

Observation `2d838002-46ff-47ea-9342-6b988b40faad`, canonical `6746aeed-02b5-4dac-911e-f5a5c11e5916`, was inspected through a read-only SQLite connection. The exact original rejection was the digits-only `renaultVacancyId` route expression: `_(JOBREQ_\d+)\/?$` cannot match `JOBREQ_50267403-1/`. The ID extractor returned undefined, and the locator's initial `!id` guard rejected the page before examining its vacancy facts.

Independent saved-page identity evidence agrees in two dimensions:

| Evidence | Value |
| --- | --- |
| Source URL, canonical URL, OG URL, selected Apply route | `JOBREQ_50267403-1` |
| Visible labeled requisition and JobPosting identifier | `JOBREQ_50267403` |

This supports interpreting `-1` as a **route discriminator**, not part of the displayed requisition. The saved page does not establish whether it represents a repost, version, duplicate-slug disambiguation or another Workday mechanism. No such lifecycle meaning is inferred.

The bounded Renault route parser recognizes a single positive-decimal suffix only on the already validated host, site and French-interface job route. Parsing alone does not publish that identity: the URL-only `renaultVacancyId` extractor remains digits-only. A suffixed context additionally requires a matching canonical route and exactly one associated JSON-LD posting with an explicit unsuffixed identifier agreeing with the displayed requisition. Apply, supplied external ID, OG and other selected job URLs must retain the exact full route ID; conflicting suffixes, unsuffixed route links or differing requisitions fail closed. Missing canonical or structured requisition corroboration also fails closed. Generic Workday and Kelly rules are untouched.

The full **source URL remains unchanged**. The published external identity is **JOBREQ_50267403-1**, with separate context metadata `routeId`, `requisitionId: JOBREQ_50267403` and `routeSuffix: 1`. Different routes such as the unsuffixed route and `-2` are not automatically combined merely because their requisition is shared. Legacy continuity uses the complete route identity and still independently validates the old and new HTML before reusing a canonical.

Repaired facts are **CA_Braking & Corner Module _Sr.Eng**, **Chennai**, **Société: RNTBCI PL** and **Temps plein → FULL_TIME**. The complete English description and trailing application/privacy paragraphs are retained; accessibility announcements and marketing panels are excluded. **30 novembre 2026** / `validThrough: 2026-11-30` remain deadline evidence, separate from **Offre publiée il y a 3 jours** / `datePosted: 2026-10-21`. No internship, permanent contract, language requirement, salary or work mode is inferred. RNTBCI PL remains a distinct employer from RENAULT s.a.s. and RENAULT ESPAÑA, S.A.; no employer alias is added.

`tests/fixtures/renaultWorkdaySuffixedVacancy.html` retains the actual saved markup and identity evidence with the same inert sanitization as the other Renault fixtures. `tests/acquisition/RenaultWorkdaySuffixedVacancy.test.ts` covers route/requisition distinctions, missing corroboration, genuine identity conflicts, malformed suffixes, tenant boundaries, complete description, unknown fields, separate routes/employers, identical/changed recapture and human-decision preservation. With `RENAULT_STORED_REPLAY=1`, the actual observation is replayed on a serialized in-memory copy of the read-only database, verifying the original canonical, immutable observation/source URL, repaired facts, identical recapture and preserved decisions.

Validation for the suffix repair: **140 focused tests in 6 files** passed, followed by **2,059 backend tests in 131 files** with stored replays enabled. Typecheck, backend build and diff checks passed. No live database writes, schema changes or commit.

## Selected split-view panes on /details/: JOBREQ_50282407

Observation `b4443e46-5a99-4ca5-a15e-020a702fac54`, canonical `b051d2c7-adfc-4c0a-b5f0-b15d19f30ad1`, was inspected read-only. Its route is `/fr-FR/renault-group-careers/details/Lead-Buyer-ADAS--H-F-_JOBREQ_50282407`.

The original rejection had two independent causes: both route expressions supported only `/job/`, and the locator required exactly one `jobPostingPage`. The split-view capture has no `jobPostingPage`: it has search controls and left-hand `jobResults`, plus a right-hand `<section data-automation-id="jobDetails">`. Simply accepting that section would still fail: its nested related-jobs section contributes duplicate locations/time/publication fields and unrelated job links.

The Renault parser now accepts `/details/<slug>_<route ID>` with no location segment, retaining the validated tenant and locale restrictions. `/job/` routes and full suffixed route identities retain their prior handling. A details capture requires exactly one visible `jobDetails` section with one selected heading, complete description and labeled requisition. Missing, duplicate, hidden or structurally invalid panes fail closed. The route, supplied external identity, pane requisition, selected Apply URL and selected open-in-new-window `/job/` URL must agree. Every other job/detail link remaining in the selected pane is checked too. Left-hand result IDs do not participate in that validation, including result-card selection hints.

The pane's related-jobs section is removed only when its unique `similar-jobs-heading` and `ul[aria-label="Similar jobs"]` identify a balanced section after the complete selected description, with no selected heading, requisition, description or Apply fields inside it. Unmarked duplicates or conflicting links in the selected vacancy are not suppressed. Selection uses the complete saved DOM rather than visible-text length, viewport height or scroll position. All description paragraphs, including the final application/privacy text, are retained; filters, navigation, result cards and related jobs are excluded.

This saved split-view page also demonstrates **stale document metadata**: the canonical URL, OG URL and singleton JSON-LD still describe the earlier Chennai / RNTBCI PL vacancy `JOBREQ_50267403-1`. They cannot establish the selected vacancy's employer, location, publication or deadline. In details mode, document URL metadata participates only when tied to the selected requisition; JSON-LD participates only when its identifier or URL independently associates it with the selection. Associated records must still agree, and conflicting associated IDs/URLs are rejected. The standalone `/job/` page's strict document-metadata checks remain unchanged. Suffixed routes still require canonical and structured requisition corroboration.

Repaired facts: **Lead Buyer ADAS (H/F)**, **Guyancourt**, **Société: RENAULT s.a.s.**, **Temps plein → FULL_TIME**. **Offre publiée hier** remains publication-relative text, distinct from **Date de fin : 31 décembre 2026 (Il reste plus de 30 jours pour postuler)**. There is no associated structured publication date or structured location in this saved page; neither is borrowed from Chennai or inferred from the capture clock. Description wording is preserved without inventing missing contract, salary or other facts.

`tests/fixtures/renaultWorkdayDetailsVacancy.html` retains the actual saved pane, result list, related section and stale metadata. Executable scripts, CSS blocks, SVGs and resource URLs are removed; inline styles remain available for visibility checks. `tests/acquisition/RenaultWorkdayDetailsVacancy.test.ts` covers isolation from result IDs and stale metadata, full-description retention with a scrolling viewport, genuine selected-ID disagreement, associated structured-data conflicts, invalid related sections, ambiguous/missing selection and preserved human decisions across identical/changed recapture. The optional actual stored replay runs only on an in-memory copy opened from a read-only source, verifying the original canonical, immutable original observation, repaired facts, identical recapture and preserved decision/assignment history.

Validation for details support: **157 focused tests in 7 files** and **2,076 backend tests in 132 files** passed with stored replays enabled, including French, Spanish, suffixed Renault, Kelly and generic Workday coverage. Typecheck, backend build and diff checks passed. No live database writes, schema changes or commit.
