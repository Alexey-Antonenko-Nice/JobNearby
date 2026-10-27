# LinkedIn selected-pane capture

## Layouts
- `/jobs/view/<id>/` direct view and `/jobs/search-results/?currentJobId=<id>` split view. Both are bounded by `LinkedInSelectedVacancyContextLocator`: the pane must be the unique detail for the URL's job ID, and the context is the selected-pane header plus the full "À propos de l'offre d'emploi" description. Left-hand job cards, recommendations, profile-match panels, Premium promotions and application statistics are never part of the context.
- Regression fixture: `tests/fixtures/linkedinSearchResultsWestinghouse.*`, the saved page of observation `da522925-321d-46b6-bb0e-a595c090b7d5` (job `4446930208`), read from the stored capture without modification.

## Header facts
The validated header reads: company, title link, `location · posting age · applicants`, then labelled chips (work mode, engagement).

- **Title** is the text of the unique link to `/jobs/view/<selected id>` in the header, and must also be a header line after the company. Zero or several distinct such links yield no title; the previous keyword heuristic remains the fallback for older layouts. The old rule required an `H/F` marker or French keywords, so titles such as "Supplier Manufacturing Engineer Lead" were lost.
- **Location** is the first `·`-separated segment of the line after the title ("Cracovie, Petite Pologne, Pologne"). Posting-age, applicant and compensation text is rejected. The generic rule previously only accepted places ending in "France".
- **Displayed company** is emitted only as `DISPLAYED_COMPANY`.
- Work mode, engagement and travel come from the header chips and description as before.

## Requirements
- Language: a direct profile statement ("Vous maîtrisez l'anglais professionnel") under a profile heading ("Votre profil ?", "Profil recherché", …) is `REQUIRED`. Hedged wording ("souhaité", "serait un plus") or other sections stay `UNKNOWN`. Shown in the review page under "Languages".
- Experience needs an explicit number of years. "expérimenté" or "de l'expérience en…" yields nothing.
- Unsupported by the evidence model (reported, not extracted): education level and skills (e.g. CAO/NX, ISO 8015, project management); the canonical fields exist but there is no evidence type to feed them.
- Fixture: `tests/fixtures/linkedinBHiveSelectedPane.*` (4483547375). The page has no education or years of experience, and "chez l'un de nos clients du secteur de l'énergie" names no client, so B-Hive stays displayed company with role unknown.

## Scrolled panes
A capture scrolled to the description starts at "À propos de l'offre d'emploi" and has no header. Then no title, company or header facts are taken from the context: the first line must not be a section label, and a fallback title/company must be a short header line, never a sentence. The earlier observation's header facts keep the canonical role resolved. Fixture: `tests/fixtures/linkedinBHiveScrolledAbout.*` (observation a103963f…). A canonical's existing unresolved employer cluster is untouched; B-Hive stays displayed company only.

## Deliberate limits
- "À distance"/Remote sets work mode only. It does not imply worldwide, or any, eligible countries.
- Displayed branding and canonical continuity never confirm the employer. The employer cluster stays unresolved until a human decision.
- Human decisions are never rewritten by recapture; identical recapture reuses the stored observation and canonical.
