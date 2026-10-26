# Orano saved vacancy

Support is bounded to `jobs.orano.group/{en_US|fr_FR}/jobs/JobDetail/<slug>/<reference>`
and the demonstrated banner/general-information/description/benefits layout.
The route reference, supplied external ID, General Information reference and
selected ApplicationMethods `jobId` must agree. Available JobPosting identifiers
and URLs must also agree. Missing, duplicate or hidden selected regions, title
disagreement and identity disagreement fail closed; no whole-page fallback is used.
Other result cards and the related-jobs widget do not contribute evidence.

## Actual observation and title disagreement

Observation `acd22422-5ca6-42de-a5d5-bbda53c96771`, canonical
`7b4c34e8-24e0-4a15-b1f6-2b6f4b345e55`, was read from the original stored HTML
through a read-only SQLite connection. It previously had no external ID.
The generic JobPosting projection supplied the direct title
`Stage Ingénieur travaux en préparation de chantier F/H`. The same older wording
appears in the slug and share-control metadata. The visible h1 and General
Information Name both say `Ingénieur préparation chantier F/H`. General
Information and the application URL both identify reference `16958`.
Share-element IDs end in `16999`, but these are UI element identifiers, not the
vacancy reference; the destination links use `16958`.

The provider selects the agreeing visible titles only after the boundary and
identity checks. Alternative structured titles remain in context metadata and
original HTML stays immutable. Transient extraction removes stale generic direct
fields and structured payloads. Global title conflict handling is unchanged.

## Facts and limits

The actual snapshot has English interface labels and French vacancy text:

- Location: `Cherbourg-en-Cotentin, Manche, France`, from the visible city, region
  and country fields (also displayed together in Location Details).
- Contract: `Internship` -> INTERNSHIP. Literal `Stage` is supported too.
- Publication: `Friday, October 23, 2026` -> source publishedAt `2026-10-23`.
- `Durée (Mois): 3`: raw value and durationMonths 3 in selected-context metadata.
- Desired Starting Date: `01-06-2027`, retained verbatim in metadata. There is no
  dedicated duration/start-date canonical field; the ambiguous numeric date is
  not reinterpreted using URL locale, nor confused with publication/deadline.
- Work Schedule: `Standard Schedule` in this snapshot; neither that nor
  `Horaire Normal` becomes FULL_TIME.
- Remote Work: explicit `Hybrid` supports HYBRID. The complete benefits retain
  the qualification about the possibility of one telework day per week.
  `Télétravail possible` alone is retained as text and metadata without assigning
  REMOTE or HYBRID. No fully remote claim is made.
- The vacancy narrative explicitly introduces `Orano Aval du futur`; this is
  DISPLAYED_COMPANY evidence, not an assertion about the legal employer. `ADF`
  remains business-unit metadata. Brand/site ownership cannot create employer
  evidence. Salary remains unknown.

The full description, requirements and benefits are retained, including content
inside the expandable description region. Navigation, sharing controls, the
separate Orano Group marketing panel, maps, related jobs and footer are excluded.

## Regression and replay

`tests/fixtures/oranoSelectedVacancy.html` is the actual saved page with executable
scripts, styles, image assets, embedded maps and session configuration removed;
selected DOM and JobPosting JSON-LD remain. Tests cover title selection, identity
conflicts, missing/ambiguous/hidden boundaries, unrelated jobs, literal facts,
qualified telework, organization caution and human decisions across recapture.

Set `ORANO_STORED_REPLAY=1` to replay the unsanitized original HTML from a read-only
live database serialized to a private in-memory connection. The test verifies
original canonical continuity, repaired evidence, identical recapture, immutable
original observation and preserved decision/interaction history. Nonempty human
decisions are also seeded and checked in a fresh in-memory database.

Legacy continuity requires both old and new snapshots to independently validate
the same vacancy, exactly one existing canonical, and agreement from every
claimed member. URL resemblance alone cannot merge records. No live writes,
schema migration or global title-conflict suppression is needed.
