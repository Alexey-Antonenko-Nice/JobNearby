# Alstom careers capture

## Validated source and identifiers

The supported host is exactly `jobsearch.alstom.com`, with HTTP(S) detail routes
`/job/<slug>/<posting-id>/` (the final slash is optional). Search pages, other
hosts, malformed references and unvalidated layouts do not supply vacancy facts.
The provider key is ALSTOM; the source namespace remains the hostname.

The URL posting ID and the employer's requisition are different identifiers:

- `1440956933`: `URL_POSTING_ID`, also the source external ID used for capture
  deduplication and exact canonical identity.
- `521407`: `REQUISITION_ID`, read from the description's explicit `Req ID:` label.

Their different values are not a contradiction. Canonical evidence-reference IDs include
the provider and identifier type, keeping both references distinct. The selected Apply URLs must agree with the
posting ID; an explicit canonical URL, when present, must agree too. A supplied
external ID, conflicting posting link, multiple requisition labels or ambiguous
selected regions fail closed. Generic provider identity rules are unchanged.

## Selected boundary and evidence

The locator requires one `jobDisplayShell` marked as a schema.org JobPosting.
It selects the unique `job-title`, `job-date` when available, `job-location`,
`job-company`, and the complete `jobdescription` element. Balanced same-tag
traversal retains nested spans and the entire description table. The context is
one reconstructed region containing the original selected fragments, rather than
an arbitrary prefix of the page. Navigation, alerts, Apply/login forms, related
jobs and cookie tables are excluded. Missing/duplicate required fields, hidden
selected content and foreign modules inside selected fragments fail closed.

The regression fixture was extracted from stored observation
`de0183ea-1779-412c-a581-281272772f27`. It retains the public vacancy shell and
complete description table; scripts, forms and decorative styling were removed.
Adversarial navigation/alert/related-job content verifies isolation. Original
stored observations remain immutable. Extraction revalidates their saved HTML
and strips stale full-page mapped fields from its transient evidence input.

The saved vacancy supplies:

- Header title: **Software Developer**. The table's **Base Software Developer**
  text is description content and does not replace the selected header.
- Workplace: **Charleroi, BE**.
- Displayed company: **Alstom**.
- Publication: explicitly labelled **Date: 23 Oct 2026**, persisted as the
  publication day `2026-10-23T00:00:00Z`. The microdata's time and capture time do
  not establish a different publication date. Invalid/unlabelled dates remain unknown.
- Salary, engagement and work mode: **UNKNOWN**. `Job Type: Experienced`, real-time
  software, customers, internal/external relationships and company branding do not
  imply an employment contract, salary or workplace arrangement.

Optional normalization is deliberately narrow: unique selected-description labels
`Work mode:` (Remote/Hybrid/On-site), `Employment type:` (Full time/Part time), and
`Salary:` (numeric amount/range, explicit EUR/USD/GBP, optional explicit
year/month/hour) can supply those fields. A missing pay period is not inferred;
contradictory or unsupported labels remain unknown. No generic full-page salary
or mode fallback is enabled for this provider.

Organization identity comes from `Company:`, not the hostname. Contextual EMPLOYER
evidence requires matching first-person company wording (`At Alstom, we ...`) and
the equal-opportunity-employer statement, without recruiting-for-client wording.
The contextual confidence is 0.98; it is not a human confirmation. Without that
support the company remains displayed-only. Existing vacancy-specific human role
decisions remain authoritative, with recommendations independently derived from
current source evidence. No organization role is globally forced by this host.

## Legacy continuity and recapture

The original observation has no stored external ID and belongs to canonical vacancy
`ac370925-2f6f-4f7f-9bef-bf3dcec97235`. Corrected capture changes the snapshot and
gains an external ID, so ordinary exact-ID matching alone would create a new
canonical vacancy.

The Alstom continuity resolver looks up unidentified observations in this source,
then independently revalidates their saved routes, selected boundaries, Apply
posting IDs and requisitions. It requires matching posting **and** requisition,
exactly one candidate canonical, and validation of every existing claimed member.
URL/title similarity alone is insufficient. Conflicting requisitions, invalid
legacy HTML or multiple candidate canonicals do not select an arbitrary target.
The existing identity-claim transaction binds the repaired observation and posting
ID to the validated canonical. No old observation is rewritten or backfilled and
no schema change is required.

Repeated identified captures with the same fingerprint reuse their immutable
observation and increment capture occurrences. Changed selected content adds an
observation to that same canonical. Existing employer membership, append-only role
decisions and user interactions follow the original canonical identity. Reprojection
does not duplicate human decisions or replay accepted assignment side effects.

## Validation and operation

Tests cover route validation, distinct identifiers, full-table preservation,
contamination, dates, organization-role safety, conservative optional facts,
legacy continuity, ambiguity rejection, immutable sources, human employer/agency
choices, user interactions, and exact/changed recapture.

The live database is opened **read-only** for inspection. Full saved-page replay
uses a serialized in-memory copy, allowing the real canonical continuity to be
verified without live database writes. No migration or commit is part of this work.

To apply the repair after review:

1. Restart the capture backend using the rebuilt code (`npm run capture:server`).
2. Reopen the Alstom detail page and capture it again.
3. Verify that the review URL still uses
   `ac370925-2f6f-4f7f-9bef-bf3dcec97235`, with the selected facts/date and both
   identifier types. Existing human choices should remain visible.
4. Capture identically once more: its identified SourceObservation should be reused,
   its occurrence count should increase, and no human history should be duplicated.

The first repaired capture may add an observation because its identifiers and
selected fields change the fingerprint; the old unidentified observation remains
available for audit under the same canonical vacancy.

### Stored versus effective employer diagnostics

The Alstom projection at `2026-10-23T20:26:55.984Z` referenced unresolved cluster
`c66fea0c-ca81-4a57-b289-9947e7fc5855`. At `20:27:12.124Z`, the human employer
decision superseded both observations' accepted assignments with USER_CONFIRMED
assignments to `c101db13-1ec6-4d2e-b0cb-8c1e3d3fba34` (Alstom).

The former pointer is a stale capture-time projection, not an intentional current
relationship or the append-only history store. Human role decisions immediately
update effective assignments; stored canonical relationships refresh during capture
reprocessing. Historical assignments remain in the assignment log with supersession
timestamps. Neither cluster nor those historical rows should be deleted to make the
diagnostic appear consistent.

Review and inbox prefer effective assignments (USER_CONFIRMED first); review also
rewrites its returned employer relationship pointer to that effective cluster.
Employer-history membership/counts use the same assignment precedence in SQL,
excluding this vacancy from the old cluster. Raw repository reads, diagnostic
`canonicalVacancy.employerRelationships`, and nested stored relationship metadata
can still expose the capture-time pointer. They are not authoritative employer
membership when an effective assignment exists. Canonical relationships are a
fallback for consumers without an effective assignment.

The diagnostic now adds `canonicalVacancy.employerProjection`, identifying the
stored cluster IDs, the effective assignment **for the reported observation**, its
status, and whether they match. It preserves the raw relationship output instead
of silently presenting an effective overlay as persisted data.

Read-only inspection plus replay in a serialized in-memory database verified that
an identical recapture reused observation `52c3a33a-e621-4bde-8cfa-7e0d3a63f594`,
refreshed the canonical pointer to `c101…`, and left all role decisions, assignments
and clusters unchanged. No employer-resolution change or direct live repair was
needed. The regression covers the same confirmation/recapture sequence.

### Verification results

Focused Alstom/APEC/Kelly/organization-role checks: **159 tests in 4 files**, including
**36 Alstom regressions**. Full backend: **1,918 tests in 126 files**. UI: **66 tests
in 5 files**. Backend build, UI build, typecheck and diff check passed.

Full stored-HTML replay in the serialized in-memory copy retained canonical
`ac370925-2f6f-4f7f-9bef-bf3dcec97235`, produced both typed identifiers and the selected
title/workplace/publication date, and left all three unsupported fields UNKNOWN.
The selected context retained one complete description table. Identical replay
reused its repaired observation and increased occurrences to two. The original
source row, existing assignments and human decision rows compared unchanged.
