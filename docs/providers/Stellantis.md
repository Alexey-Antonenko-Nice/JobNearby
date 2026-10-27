# Stellantis / jobs.groupe-psa.com

## Saved-capture diagnosis

Observation `7d4cfe85-24ed-41a4-a29f-e3a4b7e00aad` belongs to canonical vacancy
`3e6d50c4-49ef-4116-a213-96da28b5e636`. The original HTML was read through a
read-only SQLite connection. This host had no provider-specific route parser or
selected-vacancy locator, so it retained whole-page content without an external ID
or mapped title/location. The generic recruiter regex allows whitespace, including
newlines, between capitalized words followed by `recherche`. Navigation text
`Accueil\nMa recherche, mon alerte` therefore yielded the spurious recruiter
`Accueil Ma`. This is fixed by bounding this provider's evidence, without globally
suppressing similarly named organizations or rewriting human decisions.

## Validated boundary and identity

Supported route: `jobs.groupe-psa.com/offre-de-emploi/emploi-<slug>_<id>.aspx`.
The selected `ts-offer-page__body` must contain one `ts-offer-page__content` and
one `ts-offer-page__reference`. The latter displays `2025-17004`: the year-prefixed
reference is retained verbatim and its numeric component must agree with route
`17004`, supplied ID and selected print URL. The year is not a publication date.
The page renders two identical headings (normal and sticky); both must agree
with the explicit `fldjobdescription_jobtitle` field. Missing, hidden, conflicting
or ambiguous regions fail closed. Capture publishes the external ID only when
the selected context validates. Unrelated result-card references do not participate.

The context contains the full main content (mission, profile, location and
candidate criteria) plus only the displayed reference from the sidebar. It excludes
search filters, account controls, navigation, related jobs and employer-profile
marketing. Re-extraction reconstructs this context from original HTML and removes
stale generic fields from the transient evidence view; source rows remain immutable.

## Extracted facts

- Title: `Responsable Technique Sous-Système Propulsion`.
- Contract: CDI → INDEFINITE.
- Professional status: Cadre → CADRE, separately retained as `Statut : Cadre`
  in engagement raw terms and as professionalStatus metadata. It does not imply
  hours, a managerial job title or work mode.
- Location: Poissy, from the explicit Ville field, not the technical-centre
  narrative or related `Poissy Green Campus` job. The browser repaired the field
  into an empty paragraph followed by a sibling div; only that exact bounded
  structure or a directly populated field is accepted. If absent, location stays
  unknown even while the mission mentions Poissy. Regional text is retained
  separately without geographic inference.
- Company: `Stellantis`, from the current vacancy profile's first-person
  `Chez Stellantis, nous évaluons les candidats` statement, as DISPLAYED_COMPANY
  evidence. The separate employer profile and old PSA logo cannot independently
  establish company identity or automatically confirm an employer role.

## Continuity and checks

Legacy continuity validates both original and new snapshots, requires exactly one
matching canonical, and validates all its claimed members. URL resemblance alone
cannot join records. Existing exact identities are not automatically merged.

`tests/fixtures/stellantisSelectedVacancy.html` derives from the original saved
HTML with scripts, styles and image assets removed. Regressions cover facts,
complete mission/profile, identity/title disagreements, missing and ambiguous
boundaries, poisoned sidebar/related text, location evidence, company evidence,
legacy ambiguity and identical recapture.

Set `STELLANTIS_STORED_REPLAY=1` for the actual-original replay. It serializes a
read-only live connection to a private in-memory database, seeds nonempty human
interaction/role decisions there, and verifies original canonical continuity,
repaired facts, unchanged original source and preserved decision/assignment
history. The first new mapped snapshot may differ from the old generic snapshot;
subsequent identical captures reuse it. No live database writes or schema change.
