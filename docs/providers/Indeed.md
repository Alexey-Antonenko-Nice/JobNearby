# Indeed

Provider key `INDEED`, hosts `*.indeed.com`; the external ID is the `jk` / `vjk` job key.

## Selected vacancy facts

`IndeedSelectedVacancyEvidenceExtractor` reads the validated selected-vacancy context.
Header facts are read only from the lines above `Continuer pour postuler` /
`Détails du poste` / `Description du poste`, never from the description.

- **Title, company, contract, full/part time and salary** (`De 22 000 € à 27 000 € par an`)
  come from the header and are unchanged.
- **Location:** a header address line such as `23 Rue Saglio, 67100 Strasbourg` is kept
  verbatim as workplace evidence (`NNNNN City` with an optional street prefix).
- **Work mode:** `Télétravail partiel` (also `hybride`, `occasionnel`) maps to `HYBRID`.
  Qualified telework is never `REMOTE`, and no remote-eligible countries are inferred.
  The model stores only the enum, so the exact wording is not persisted.
  `Trouvé sur Télétravail partiel in …` is a search echo and is ignored.
- **Organization role:** the header company is `UNKNOWN` unless the vacancy text
  identifies it as the hiring company in the first person: a line starting
  `Nous sommes <same company>` plus `nous recherchons … nos équipes/notre agence/notre société`,
  with no recruiter wording (`pour le compte de`, `notre client`, `cabinet de recrutement`,
  `intérim`). Then the role is `EMPLOYER` (for example Sapian). This is evidence only: it
  does not confirm or merge an employer record, and branding or canonical continuity alone
  never qualifies.

## Tests

`tests/acquisition/IndeedSapianSelectedPane.test.ts` uses the saved page
`tests/fixtures/indeedSapianSelectedPane.*` (observation
`479143cf-a2e7-42ce-9cb7-1c328e13057a`). With `INDEED_STORED_REPLAY=1` it replays on an
in-memory copy of `job-nearby.sqlite`: same canonical, identical recapture adds nothing,
and human decisions, interactions and cluster assignments are unchanged.
