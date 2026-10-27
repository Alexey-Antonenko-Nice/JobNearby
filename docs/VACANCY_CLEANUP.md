# Vacancy archive and cleanup

Open a vacancy review and choose **Load cleanup options** under **Manage vacancy**.

- **Archive vacancy** hides it from the active inbox and default candidate enumeration (`CanonicalVacancyRepository.findAll()`), including future fit review consumers. It does not record an application event or delete evidence. An identical recapture stays archived. There is no fit scoring engine in the current application; any future candidate selector must use this active enumeration.
- **Show archived vacancies** in the inbox opens the recoverable archive. Open a review and choose **Restore vacancy** to return it to the active list with the same canonical ID, facts, decisions and history.
- Permanent deletion is available only while archived. Choose the entire vacancy or, when several captures exist, one capture. The last capture must be deleted through the whole-vacancy option.
- Review the affected capture URLs, dates and record counts. Type **DELETE** to confirm. If any APPLIED or INTERVIEW event exists (even if the current state later changed), also acknowledge that history. Nothing is deleted by opening the preview.

Deleting one capture removes its occurrences, source membership, publication/campaign memberships and non-shared employer assignments. The remaining source evidence is extracted and canonical facts rebuilt under the original canonical ID. Vacancy-level human decisions and application history remain; source references inside historical event metadata remain historical identifiers. The vacancy stays archived until restored.

Deleting the whole vacancy removes its projection, source and exact-identity claims, vacancy-specific role decision chain, application/interaction history, occurrences, memberships and non-shared assignments. Shared employer identities, aliases, global confirmed agency memory, and shared publication families/campaigns remain. An immutable source snapshot and any alias assignment needed to substantiate shared employer memory are retained; the preview explicitly counts those exceptions. Such a snapshot is retired, excluded from recapture matching and forbidden from rejoining a canonical vacancy. Shared agency evidence-reference mappings are preserved separately. Global agency memory keeps the deleted vacancy ID as historical provenance, not a live vacancy link.

A later intentional capture may create a new vacancy/source record after deletion. Deletion is not a permanent block on a source URL. Minimal canonical ID tombstones prevent an in-flight stale projection from resurrecting the old vacancy. Restore is available only for archives, not permanent deletions.

## Integrity and API

Migration 011 adds archive state, revision and deletion guards, canonical tombstones, shared evidence provenance and source retirement. It adjusts the snapshot uniqueness index for retired sources and removes only the live canonical-vacancy foreign key from immutable shared agency memory. The source foreign key and shared-memory update/delete protection remain. Existing source payloads, decisions and history are preserved by migration. Append-only delete guards on vacancy-owned history admit only the cleanup transaction's explicitly scoped archived vacancy/source IDs; update protections remain unchanged.

Deletion prepares a replacement projection before the transaction, then revalidates a content token under `BEGIN IMMEDIATE`. The token covers ownership, captures, occurrences, assignments, decisions, interactions, archive revision and relevant shared memory. A changed capture/history/archive state invalidates the preview. All removal and reprojection work commits together or rolls back together; no asynchronous operation crosses the transaction. The interface clears failed/stale previews and requires loading fresh options. Deleted reviews return not-found, and stale projections cannot recreate deleted records.

Endpoints:

- `GET /vacancies` — active only; `?archived=true` — archived only.
- `GET /vacancies/:id/cleanup` — current state and token.
- `POST /vacancies/:id/archive` — `{ archived, token }`.
- `GET /vacancies/:id/deletion-preview?observationId=...` — omit observationId for the entire vacancy.
- `POST /vacancies/:id/deletion` — `{ token, confirmation: "DELETE", acknowledgeApplicationHistory, observationId? }` using the preview token.

Invalid input returns 400; changed state or a non-archived deletion returns 409; a deleted/missing vacancy returns 404. Tokens bind a preview to its chosen target. Restoring then re-archiving also invalidates earlier previews.

## Verification

`tests/infrastructure/SqliteVacancyCleanup.test.ts` exercises archive/restore, recapture, guards, application/interview acknowledgement, single-source reprojection, preserved decisions, whole deletion, shared employer/alias evidence, publication/campaign isolation, rollback, stale concurrent changes, populated version-10 migration, and HTTP behavior. UI regressions cover archive access from an empty inbox, preview/confirmation/acknowledgement and stale errors. All cleanup database tests run in memory. Opt-in saved-page replay tests migrate only their serialized in-memory copy.

No live database migration or cleanup was executed during implementation. The server was not started. Migration 011 will be needed when this version is deployed.

### Archived inbox query regression

The archived inbox sends `GET /vacancies?archived=true`. The inbox query allowlist must accept both `limit` and `archived`; otherwise it returns HTTP 400 (`Unsupported query parameter "archived".`) before the route can apply its archive filter. Only `true` and `false` are valid archive values. Unknown parameters and invalid limits remain rejected.

`tests/infrastructure/archivedInboxHttp.test.ts` exercises the actual HTTP route, review workflow and SQLite repositories using an in-memory database: populated archive, empty archive, active-list exclusion, combined limit/filter, restore into the active list, and deletion protection after restore. The UI also covers the empty-archive state. This repair requires no migration; an already-running API must reload the rebuilt server code.
