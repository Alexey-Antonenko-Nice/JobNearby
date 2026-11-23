# Job Nearby - Product Specification

**Version:** 0.2 (M18.1, Chapter 2 CRM alignment)
**Status:** Working product specification; requirements are not claims of delivery
**Implementation audit baseline:** `d5732bea57f594c094dac32418c251a172f5c5ce`

## 1. Product definition

Job Nearby is intended to be a completely free, open-source desktop CRM for job
seekers, with employer-recognition capabilities. It helps a person manage the
complete lifecycle of a job opportunity. Recognition of the likely original
employer behind recruiting-agency publications is an important differentiating
capability inside that CRM, not the whole product.

The vacancy/opportunity is the central user-facing CRM record. Employer and agency
views provide reusable context across opportunities. The current implementation is
a local developer-run application; the ordinary-user desktop distribution is a
required future deliverable. Source is intended to be publicly available on GitHub
for inspection and contribution. M24.1 selected the MIT License (`LICENSE`); public
release distribution is not yet complete.

## 2. Opportunity lifecycle and lightweight use

The conceptual flow is discovery/capture → vacancy understanding → original-employer
recognition where possible → decision whether to pursue → application preparation
→ CV/letter association → application/outreach → contacts and communication history
→ follow-up/next action → interview/process progression → outcome, archive and history.

Stages are optional and may repeat or occur out of order. A user can simply capture
an opportunity and record an application, or maintain detailed documents, contacts
and process steps. An unresolved employer must not prevent applying or following up.
A recognized employer must not imply that the user intends to apply.

## 3. Opportunity record

The user should eventually be able to carry or reference:

| Information | User-visible capability |
| --- | --- |
| Vacancy facts | Title, location, work mode, compensation, publication and capture dates |
| Organizations | Employer/likely original employer, agency, displayed company, recognition state and uncertainty |
| Provenance | Source provider, source URL/identity, preserved observations/publications |
| Private tracking | Application/process state, priority, notes, next action and follow-up date |
| People and preparation | Relevant contacts, planned/used CV and motivation-letter versions |
| History | Communication/activity timeline, interviews/process steps and final outcome |
| Organization | Active/archive state and recovery of archived opportunities |

This describes a composed CRM view, not a single persistence table. Evidence-backed
canonical facts and private subordinate records retain separate ownership.

## 4. Application/process pipeline

The CRM needs to distinguish discovered, reviewing, planned to apply, applied,
awaiting response, follow-up due, recruiter/contact engaged, interview scheduled,
interview completed, additional test/assignment, offer, rejected, withdrawn and no
longer relevant. These are semantic needs, not a frozen enum. Follow-up due may be
a task-derived condition; archive is a separate visibility/lifecycle dimension.

Recognition state, application state, task state and archive state are independent.
Current state must not replace chronological history. The existing latest-interaction
projection is a foundation, not a complete process pipeline: recording a phone call
must not eventually erase the fact that an application is awaiting response.

## 5. Application documents

A document library must support multiple CV/résumé and motivation/cover-letter
variants: generic engineering, commissioning, electromechanical technician,
startup/R&D, and English/French variants, for example. An opportunity must identify
exactly which versions are planned and which were actually used for an application
or subsequent document submission.

Document identity, version and use in a particular application are different facts.
Editing a CV or letter later must not change the recorded version used historically.
Renaming or replacing an external file must not silently rewrite that history.

M19.1 implements a managed-copy library for CV and MOTIVATION_LETTER documents.
Review can import a logical document with its first version, add newer versions,
and select an exact existing version for a vacancy. Each import retains immutable
bytes and SHA-256 metadata independently of the original local file. Maximum file
size is 5 MiB; document editing, rendering and standalone deletion are deferred.

An association means **selected for this vacancy**, not sent or submitted. Selecting
another version of the same kind preserves the prior association in history. The
same version can be selected for several vacancies. Recapture and archive/restore
preserve selections; whole-vacancy deletion removes its associations but retains
the shared library. Recording actual submission/use remains a later capability.

Missing or altered managed files are shown as unavailable and cannot be newly
selected or downloaded. A complete future backup must include both the database
and managed document files; original external paths are not required. Letter
generation and automatic submission are not prerequisites.

M19.2 adds a Documents library reachable from Inbox and Review. It defaults to
active documents and offers archived/all views. Logical documents can be renamed,
archived and restored. Detail shows ordered version history, original filenames,
import dates, sizes, integrity and current/historical reference counts, with verified
browser downloads and the shared version-import flow.

Archive is not deletion: existing selected and historical versions remain visible
and downloadable when intact. Archived documents are excluded from new Review
selections and imports until restored. Renaming changes only the current display
name, not version identity/content or selection history. Permanent deletion remains
unavailable even for unreferenced versions; referenced history is protected.

## 6. Contacts

Contacts are first-class private CRM information: recruiters, hiring managers, HR
representatives, agency consultants, employees/referrals, interviewers, company
contacts and other relevant people. Useful optional fields include name, role/title,
organization, email, phone, profile/LinkedIn URL and notes with appropriate provenance.
One contact can relate to several opportunities; one opportunity can have several
contacts with different roles. Contact identity and vacancy relationships must not
be collapsed. Captured person evidence is not automatically a user-maintained contact.

## 7. Activity and communication history

A chronological timeline should answer: “What happened with this opportunity, and
when?” It includes application submitted, email sent/received, phone/recruiter call,
LinkedIn message, interview invitation/completion, follow-up sent, rejection/offer
received, document sent, note added, status changed and contact created/linked.
Activities may refer to contacts and exact document versions. Occurrence time and
recording time are distinct where needed. Corrections must remain auditable; a
current-state projection must not replace events. Manual recording is sufficient
initially; mailbox or messaging integration is not required.

## 8. Next actions, follow-ups and reminders

A task/next action is something the user intends to do. A reminder is a mechanism
that alerts the user about that action or an event. They are separate concepts.

Examples include applying before a deadline, sending a follow-up, calling a recruiter,
preparing an interview, sending requested documents, checking a portal, asking for
the original employer identity, updating a CV, preparing a technical assignment and
contacting a hiring manager. A task needs a description, due date/time, related
opportunity, optional contact, completion state and notes. Reminder configuration
and delivery state belong to the alert mechanism. Upcoming and overdue follow-ups
must be visible even when a notification was missed. Scheduling must eventually
address time zones, application restart/sleep and completed/cancelled tasks.

M18.4 provides Review-first tracking: create multiple actions, optionally set due
times, complete/cancel, reschedule, and set/dismiss a separate reminder. History is
retained. Reminder status updates on reading or refreshing Review; no notification
is delivered while the application is closed. Description editing and the daily
work queue remain future work.

## 9. Daily work queue and search

The daily view should answer what to do today, which applications need follow-up,
which interviews are upcoming, which vacancies await action or review, which
contacts need a response, which opportunities are stalled, and what recently
advanced or was rejected. This is a product requirement, not a final dashboard design.

Search/filter combinations should include employer, agency, title, location,
status/application state, priority, follow-up due, contact, date, CV used,
source/provider, active/archive and employer-recognition state. Views must not
create interaction events merely by being opened.

## 10. Employer recognition as CRM context

An agency publication may expose a provider, recruiting agency, named client,
displayed company and original-employer candidates. Recognition preserves those
roles and uncertainty. It helps prevent duplicate applications, identify agencies
advertising a common opportunity, understand who is hiring, reuse relevant employer,
contact and application history, improve follow-ups and reveal related opportunities.

Anonymous employer clusters remain valid. Clustering confidence and identity
confidence are independent; location, industry and other fingerprints are evidence,
not proof. Source/provider domains and shared brand words never establish an
employer identity or transfer human role confirmation. Employer/location history
and optional future geographic or labor-market analysis support CRM decisions.
Detailed recognition design remains in [RECOGNITION_MODEL.md](RECOGNITION_MODEL.md).

## 11. Publications, duplicates and evidence

Different employer/agency sites, syndicated boards, several agencies for a client,
and reposts may describe one underlying opportunity. Source observations,
publication families, recruitment campaigns, employer clusters and canonical
vacancies are distinct. A campaign may contain several positions; shared employer
identity alone does not prove vacancy sameness. Link a shared opportunity only with
sufficient evidence; do not automatically merge uncertain opportunities.

Preserve source identities, observations and provenance while interpreting them.
New captures normally extend evidence history. Raw capture is not permission to
retain unrelated private dashboard data: sanitization and privacy remediation take
precedence over historical payload fidelity. Private application records and notes
must not become public recognition evidence. Source adapters remain replaceable;
no provider, country, AI service or external registry defines the CRM domain.

## 12. Recognition and human decision safeguards

Employer-related conclusions have different scopes and must not be presented as
equivalent:

* **Displayed company:** a source observation may contain a company name. It is
  evidence, not proof that the company is recognized or is the employer.
* **Automatically recognized employer:** recognition may associate evidence with
  an employer identity or cluster. This is not a human decision for the vacancy.
* **Recognized from prior employer knowledge:** exact-name or conservative prior
  knowledge may reuse an identity or cluster association. That reuse does not
  create a new human organization-role decision.
* **Organization identity / alias linkage:** a reviewer may decide that an
  observed name refers to a known organization. This is an identity decision; it
  does not decide which organization role applies to the vacancy.
* **Employer-cluster membership:** grouping observations as the same underlying
  employer identity is not a vacancy-specific role decision. Shared names,
  Workday tenants, or cluster membership do not transfer a decision between
  vacancies.
* **Vacancy-specific human organization-role decision:** only an explicit human
  decision that an organization plays the employer role confirms that role for
  that particular vacancy. The decision is independent of identity linkage and
  cluster membership. Confirmation of one vacancy does not confirm another,
  even when the name, cluster, source tenant, prior knowledge, or alias matches.
* **Ambiguous employer:** when several candidates remain plausible, preserve the
  ambiguity and request review. The highest-ranked candidate must not silently
  become the employer.
* **No employer evidence:** this is a neutral state, not a failed confirmation.
  The employer is not identified from the available evidence.
* **Reassignment:** changing a vacancy that already has a human-confirmed
  employer role is an explicit reassignment/change, distinct from first
  confirmation.

Inbox and Review may expose the same presentation state, derived from evidence
and human decisions. It is read-only: presenting a state must not create or
mutate an identity, assignment, or organization-role decision.

## 13. Local desktop installation and independent users

The target is an installable desktop application for ordinary users. Installation
must bundle/install necessary runtime components. Users must not need to install
Node.js or Python, install development dependencies, clone the repository, run npm,
configure a development database or understand internal architecture.

M23.1 established an Electron runtime in which one desktop process owns the
backend, serves the built UI on a dynamically assigned loopback port, and stores
its profile/data under the per-user application-data root. M23.2 adds a Windows
x64 per-user NSIS installer with an unpacked package, ASAR resources, and an
Electron-rebuilt SQLite native module. Uninstall preserves user data by default.
The browser extension remains optional and separately installed. Other platforms,
code signing, auto-update, and public release distribution are not included.
Many independent users means one local application and private data store per
user/machine/profile initially, not a shared server, central database or
multi-tenant SaaS.

## 14. Local data, privacy and portability

The current application uses local SQLite. CRM data must remain usable locally;
application history must not require a central Job Nearby cloud service. CVs,
letters, contacts, notes and interactions are personal data. Public GitHub source
and open-source distribution do not make that data public. Captured source material
can also contain sensitive or licensed content; it is not automatically shareable.
Optional future sync is not required for the initial desktop product.

Users need backup, verified restore, export and migration to another computer.
Portability must include the database and any managed application documents,
relationships and version history. The final export format is undecided. Open
source alone is not sufficient portability. Backups remain private user data.

M22.1 implements manual whole-application **Backup & Restore** (distinct from
user-data export):
- Backup produces a portable ZIP archive with `manifest.json` (`format: "job-nearby-backup"`,
  `formatVersion: 1`, `schemaVersion`, SHA-256 checksums), an online SQLite snapshot
  (`database.sqlite`), and all DB-referenced managed document files (`documents/...`).
- Restore validates the archive, manifest, SQLite integrity, and document SHA-256
  hashes before mutating any live state, creates an automatic pre-restore safety
  backup, replaces local user state (never merges), preserves all IDs and history,
  and runs forward migrations for older supported schemas (rejecting future schemas).
- Cloud backup, sync, scheduled/periodic backup, and user-data export are not part
  of M22.1.

M22.2 implements manual **User-Data Export** (distinct from Backup & Restore):
- Exports readable, interoperable CRM data in **JSON** (`format: "job-nearby-export"`,
  `formatVersion: 1`) and **CSV** (UTF-8 with BOM, multi-file `.zip` package with
  relational IDs).
- Includes archived vacancies, contacts, and documents by default; excludes managed
  document binary files in v1, internal retry/cleanup/migration metadata, and derived
  operational views (Today queue, duplicated timeline).
- Separates `source` provenance, `canonical` facts, `employer` presentation, and private
  `crm` state so future **manual vacancies** (`USER_CREATED`) and **field-level user
  overrides** remain compatible without conflating captured and user-entered values.
- Export has **no restore semantics** and cannot be used as a Job Nearby backup.

## 15. Current delivery and remaining scope

Audited from code at the baseline above, without opening the live database:

| Capability | Delivery state |
| --- | --- |
| Capture, canonical facts/source identity, bounded provider extraction | Implemented for supported paths; not every provider/layout |
| Recognition, employer memory, explicit identity and vacancy-role decisions | Implemented, with uncertainty and separate scopes |
| Inbox/Review, source/history context, archive/restore, guarded deletion | Implemented |
| Interaction history and application state | Partial: append-only vacancy events and latest-event state, not a full pipeline |
| Contacts and interviews | Partial evidence/event metadata only; no contact library or interview schedule |
| Notes and priority | Implemented in Review (M18.2): private priority and append-only chronological notes, preserved across recapture and archive/restore |
| Application preparation and richer activity timeline | Future workflows; notes remain distinct from interaction events |
| CV/letter library, versioning and usage associations | M19.1: managed immutable versions and Review selection/history; actual sending/submission tracking deferred |
| Next actions/reminders | Implemented in Review (M18.4): multiple actions, due times, completion/cancellation and reminder history; due signals calculated on read, no background notifications |
| Daily work queue | Implemented: the Today page derives overdue actions, due reminders, today/upcoming work and opportunities needing an action; no background notification service |
| CRM search/filtering | Partial: inbox filtering; no full CRM query/search beyond the derived work queue |
| Backup/restore/export and desktop runtime | Backup/restore/export implemented; M23.1 desktop runtime and M23.2 Windows x64 installer/unpacked package implemented; public release distribution remains separate |
| Public open-source release readiness | MIT license selected (M24.1); M24.2 minimized fixtures and removed captured contact data; M24.3 removed sensitive content from published history; M25.1 adds privacy/data-handling, security-policy and threat-model documentation; M25.2 hardens loopback API authorization (per-session credentials, Host/Origin validation, JSON enforcement, capture rate limiting); M25.3 adds contributor guidance, issue/PR templates and contributor checks; M26.1 adds Windows CI quality/security/test gates and a manual Windows installer artifact workflow. Remaining: automated release publication, signing, and installer/download/upgrade guidance |

See [DATA_MODEL.md section 78](DATA_MODEL.md#78-crm-core-gap-analysis-m181) for
model boundaries and implementation evidence. The Electron runtime does not change
CRM/domain semantics.

## 16. Roadmap and release gates

The governing implementation order is maintained in
[ARCHITECTURE.md section 91](ARCHITECTURE.md#91-crm-implementation-roadmap):
A opportunity/application core; B documents; C contacts/activity; D follow-ups and
reminders; E CRM usability; F portability; G desktop distribution; H public release.
Licensing/dependency and packaging feasibility investigations start early; their
release gates cannot wait until public distribution. Storage and portability
requirements must shape document design before files are accumulated. Public release
also requires automated release publication, signing, and installer/download and
upgrade guidance; loopback API authorization is hardened and documented in
[SECURITY_MODEL.md](SECURITY_MODEL.md). Contribution guidance and issue/PR templates are
tracked in [CONTRIBUTING.md](../CONTRIBUTING.md) and `.github/`, and the M26.1 CI plus
manual Windows packaging foundation is under `.github/workflows/`.

## 17. Out of scope and foundational invariants

No cloud sync, authentication service, SaaS, automatic application sending, mobile
app, comprehensive labor-market collection or AI-generated letters is required for
the initial desktop CRM. Future enrichment and analytics must not block core tracking.

Preserve evidence/provenance, stable opportunity identity and uncertainty. Keep
recognition, identity, vacancy-specific human roles and private application history
separate. Recapture must not overwrite private decisions, documents or history.
A central opportunity view composes normalized records rather than turning the
canonical market vacancy into one giant mutable CRM entity.

## M20.1 — Reusable private contacts

Contacts is a manual local CRM library: create/edit people, maintain multiple contact methods, search by name or method value, archive and restore. Review can create/link a contact, assign a vacancy-specific role and end the relationship while retaining history. Existing links to archived contacts remain visible; new links require restoration. No permanent deletion, automatic deduplication, synchronization or enrichment is provided. Organization affiliation remains future work; explicit interaction/task references are implemented in M20.2 below. These private records neither confirm employer roles nor change process state. Public GitHub source does not make personal contacts public.

## M20.2 — Who an interaction or action concerns

Review supports an optional linked contact when recording applicable interactions or creating next actions. Only active contacts with active vacancy relationships appear in normal selection. History still displays contacts whose relationship ended or whose contact record was archived. Activity displays the contact's current name. Contact detail lists its recorded interactions and active/completed/cancelled actions with links to their vacancies. There is no automatic contact selection, message sending, email synchronization or external integration.

## M20.3 — Vacancy activity overview

Review provides a read-only, newest-first Activity timeline across interactions, process transitions, notes, action/reminder history, document selections and contact relationships. Existing specialized sections retain their management controls. Documents remain selected, not necessarily sent; contact/document names are current display metadata while exact identities and version numbers remain historical. Contact renames do not create vacancy activity. Archive/restore events are unavailable because only current archive state is stored. No global timeline, synchronization or advanced filtering is introduced.


### M21.1 — Daily work queue

Today is a non-persisted operational view across unarchived opportunities. It is not a scheduler or a second task/reminder system; most edits remain in Review. Browser timezone defines calendar days; stored instants remain UTC. Refresh recomputes against server time, without background jobs or notifications.

Action precedence is overdue, reminder due, due today, then upcoming through the next seven local calendar days (including that day's end). Existing action/reminder derivation remains authoritative. Distinct actions stay distinct. Missing-action precedence is HIGH priority, stale awaiting response, then general active opportunity. REJECTED, WITHDRAWN and NO_LONGER_RELEVANT suppress missing-action prompts; OFFER remains active. Explicit active actions still surface even in terminal process states.

Awaiting response is stale after seven local calendar-day boundaries without private activity, and only without an active action. This configurable review heuristic is not a universal follow-up deadline and creates no task. Activity uses interaction occurredAt, transition/note/action/change/document-selection createdAt and contact relationship creation/end timestamps, matching the activity timeline sources. Canonical createdAt is the fallback. Public recapture, priority edits, recognition churn, contact renames and document-library lifecycle edits do not reset this clock.

Category ordering: overdue, reminder due, today, HIGH without action, stale awaiting response, upcoming, general without action. Within categories: earliest relevant instant, HIGH/NORMAL/LOW/NONE priority, stable ID. Equal-time ordering is deterministic. The SQLite adapter batch-loads a consistent snapshot without loading Review per vacancy, source payloads or document bytes. No queue records, migrations or cleanup-token inputs are introduced. Archive excludes; restore reuses preserved CRM state. Company labels use existing canonical employer/displayed-company projections and imply no new confirmation.


### M21.2 — Existing commands from Today

Today remains a derived queue and now offers Complete action, Cancel action and Dismiss reminder through the same application commands and HTTP endpoints as Review. An action-backed item represents an active action; an optional exact current due reminder ID enables dismissal independently of queue category. Vacancy-level attention items remain navigation-only. No dashboard mutation model, schema or scheduler is added.

Each command attempt is followed by a full queue read, including failures whose response may have been lost. Summary counts, category changes and ordering come only from that read. Per-action pending guards prevent duplicate clicks; uncertain retries retain the request ID, including when the command succeeded but refresh failed. Conflicts remain visible and trigger refresh. Cancellation uses no modal, consistent with Review; history is retained. Dismissal never completes an action. Existing action-change history naturally updates private staleness. Archive races obey existing commands without unarchiving. Contact-detail deep links remain deferred because Contacts has no detail route.
