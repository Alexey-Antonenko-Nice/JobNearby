# Greenhouse EU job boards

Bounded extraction supports the demonstrated `job-boards.eu.greenhouse.io/<tenant>/jobs/<numeric-id>` route and modern `job-post-container` layout. The route supplies the numeric external ID; the tenant, canonical URL, optional og:url and application-form action must agree. The saved page uses HTTP for its canonical link and HTTPS for og:url; both protocols are accepted for identity comparison without rewriting the original source URL.

Exactly one selected title region, h1, location and description are required. Only `job__title` and `job__description` enter vacancy context. Navigation, application questions, country dropdown options, application salary expectations, footer and scripts are excluded. Missing, hidden or duplicate selected regions and conflicting identities fail closed. Old mapped fields and whole-page structured payloads are removed from the transient evidence view; original observations remain immutable. Generic header heuristics yield to the validated title and location.

The saved-page fixture derives from observation `5d9ef6e0-c22f-44df-87a4-309869b35a76`, read using a read-only database connection. It preserves the actual DOM with executable scripts, styles and image assets removed. For vacancy `4964827101` it yields:

- Manufacturing Engineer (m/f/d)
- Fürstenfeldbruck, Bavaria, Germany
- Complete German/English description, including responsibilities, requirements, benefits and the description's About us section.

The benefits allowance remains description text, not vacancy salary. Application questions cannot create language, salary or work-mode evidence. Other Greenhouse hosts, custom domains and alternate/legacy layouts are not validated by this implementation.

`tests/acquisition/GreenhouseSelectedVacancy.test.ts` covers exact route identity, tenant and link disagreement, malformed boundaries, noise isolation, complete description retention and runtime/identical recapture using only `createDatabase(":memory:")`. No live rows are written or migrated. This change does not add a migration for older observations without external IDs.

## Dexory qualification and review repair

Saved observation `de66bfac-b42a-4f4a-b785-aaf0f2ded9bf`, source ID `5017487101`,
canonical `ee30d9a8-b024-4d6c-9865-0714deb3c3cb`, contains a 3,747-character selected
context. The original HTML was inspected read-only and saved as
`tests/fixtures/greenhouseDexory.html` (scripts/styles/image assets stripped).

The existing canonical education/skill fields are now fed through provenance-bearing
optional evidence arrays, the composite extractor, canonical adapter and review DTO.
No persistence schema changes are needed. The Greenhouse parser uses explicit
`You'll need` and `Responsibilities` sections bounded by `Benefits`; it does not
scan application questions or unrelated page content for requirements.

The technical-degree sentence is retained whole, including the alternative of
equivalent hands-on experience and the statement that robotics exposure is welcome
but not essential. No degree level or experience-year count is invented. Linux,
command-line confidence, willingness to learn ROS, troubleshooting and the explicit
robot triage/logs/CAN/configuration/connectivity/mapping/deployment duties retain their
source wording. Duties carry a `Responsibility:` label so the review does not turn
on-the-job tasks into mandatory prior qualifications. These appear under Qualifications
and Technical requirements and responsibilities.

An opening first-person `At <company>, we're/we are ...` introduction corroborated
by the selected tenant supports DISPLAYED_COMPANY evidence. For this vacancy that is
Dexory. Tenant/hostname alone, a client mention or an unrelated footer cannot establish
company or employer identity. Existing employer assignments and human roles remain in
force; company evidence does not automatically assert legal-employer status.

Previously, any MATCHED_EXISTING_CLUSTER processing outcome produced the toast
“Linked to an existing employer record”, even for an unresolved placeholder. Feedback
now checks cluster state: unresolved reuse produces UNRESOLVED_EXISTING_RECORD and
“Employer not identified yet”; conflicted reuse asks for review. Resolved and probably
resolved reuse retain the existing linked-record message.

Run `DEXORY_STORED_REPLAY=1` for the optional actual-observation regression. It opens
the live database read-only, serializes it into memory, seeds nonempty interaction and
role decisions there, and checks exact observation/canonical reuse, unchanged original
source and decision/assignment histories, repaired review fields and matching toast
state across repeated captures. All writes occur in memory. Saved-page and UI regressions
also cover qualification alternatives, optionality, technical responsibilities and
company evidence boundaries.
