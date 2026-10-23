# Explicit employer identity selection

Organization role answers “Who is the employer for this vacancy?” Identity selection
answers “Is this the same employer identity as a previous vacancy?” They are separate
actions. Confirming EMPLOYER does not establish that every organization with that
name is the same legal employer.

## Review workflow

After confirming an organization as EMPLOYER, the review page shows **Employer
identity** when other confirmed employer identities have prior vacancies. This also
works for vacancies whose employer role was confirmed earlier.

Each option shows its name, prior vacancy titles, locations, and links to their review
pages. **Suggested** identities appear by default only when there is explicit
supporting evidence: a matching organization name, a known (user-confirmed) alias,
or a shared source/careers domain. These signals are advisory (a brand or careers
site may represent several employers) and never select an identity. Other confirmed
employers are not listed. To pick an unrelated identity, use **Search identities**
(minimum two characters, name match) under the section; results can be kept separate
or explicitly used like suggestions. API: `GET /vacancies/:id/employer-identity-search?q=`.

- **Use this existing identity** opens a confirmation step. **Confirm existing
  identity** assigns only this vacancy's observations to the selected identity.
- **Keep separate** records a vacancy-specific rejection of that candidate without
  changing current effective membership. The option stays visible, marked as kept
  separate; a later explicit selection can reverse that choice.

Employer history updates immediately. Other vacancies' assignments, organization-role
decisions, source observations, canonical IDs and employer clusters are untouched.
This is not a global cluster merge and does not create a global name alias.

## Persistence and concurrency

No schema change is needed. The existing assignment audit log stores one immutable
`user-employer-identity` record per affected observation. Selection appends
USER_CONFIRMED replacements and supersedes effective assignments; Keep separate
appends REJECTED records. The JSON explanation records request ID, canonical ID,
target identity, decision, previous identity and the reviewed candidate token. Role
decisions are neither appended nor rewritten by identity selection.

The transaction checks source membership, all effective assignment IDs, the role
decision head, earlier identity audit records and target membership. Stale reviews
return HTTP 409 and refresh the UI. Identical request retries converge without
reapplying a historical choice. Conflicting concurrent choices cannot both commit.
All affected observations change together, or none do.

Selection also refreshes stored canonical employer pointers with evidence references
to the identity decision, so raw diagnostics agree with effective membership
immediately. A pending capture cannot overwrite that pointer with an older identity.
Identical recapture preserves effective assignments and adds no identity history.
Changed-content captures inherit the vacancy's explicitly retained/selected identity
before generic employer matching. They do not spread that choice to other vacancies.

## Alstom reproduction and use

The regression seeds the original English and French canonical/observation IDs with
saved Alstom HTML in an in-memory database. Each role confirmation initially creates
a separate Alstom identity. Candidate discovery alone leaves them separate. Tests
exercise both explicit selection and Keep separate, including changed and identical
recaptures, history membership, diagnostics, unchanged human role decisions,
transaction rollback, request retries and stale/concurrent decisions.

Live Alstom inspection/replay opens `job-nearby.sqlite` read-only and serializes it to
an independent in-memory database. No live identity is chosen by this work.

Restart the rebuilt capture backend (`npm run capture:server`) and refresh the review
page. Confirm EMPLOYER first if needed. Under **Employer identity**, inspect the prior
vacancies and locations, then explicitly choose **Use this existing identity** or
**Keep separate**. For Alstom, decide whether the Charleroi and Crespin vacancies
should share the same employer identity; the application does not decide this from
the name or careers domain. Recapture is optional for applying the identity choice;
it is useful to verify reuse and continuity afterward.

API: `POST /vacancies/:id/employer-identity-decisions` with `requestId`,
`employerClusterId`, `candidateToken`, and `decision` (`USE_EXISTING` or
`KEEP_SEPARATE`). The response contains the updated review.

## Verification

Focused Alstom/role/memory checks passed: **118 tests in 4 files**, including
**97 Alstom tests**. Full backend: **1,979 tests in 126 files**. UI: **72 tests in
6 files**. Backend build, UI build, typecheck and diff check passed.

Both paths were also exercised independently on serialized in-memory copies of the
live database. Explicit USE_EXISTING changed only the French vacancy's effective
membership to the English vacancy's cluster and exposed its prior employer history.
KEEP_SEPARATE retained the French cluster and separate history. Both retained the
original canonical ID, aligned diagnostics, reused identical recaptures, and left
role decisions and employer cluster records unchanged. These were synthetic choices
inside separate in-memory copies, not decisions recorded for the live vacancies.
