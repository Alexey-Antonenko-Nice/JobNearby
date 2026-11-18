# Job Nearby

Job Nearby is intended to be a completely free, open-source desktop CRM for job
seekers, with employer-recognition capabilities. Its source is intended to be public
on GitHub for community inspection and contribution. License selection is pending;
this is a product direction, not a claim that a license or end-user release exists.

The opportunity is the central CRM record: discover and understand a vacancy,
prepare an application, track the CV and motivation-letter versions used, maintain
contacts and interaction history, follow up, progress through interviews, and keep
outcomes/history. Recognition of the likely original employer behind agency
publications supports that workflow while preserving uncertainty.

## Current status

Implemented: supported browser capture, canonical vacancies and source identity,
employer recognition and vacancy-specific role decisions, React Inbox/Review,
append-only interaction events and derived history, archive/restore and guarded
deletion. Private CRM includes priority, append-only notes, explicit process-state
history, next actions and derived in-app reminders. M19.1 adds a CV/motivation-letter
library with immutable managed versions and vacancy-specific selection history.
Selecting a version does not assert that it was sent.

Planned: richer activity/submission tracking, contacts, a daily work queue, broader
search, backup/restore/export, and ordinary-user desktop installation.
See [the implementation roadmap](docs/ARCHITECTURE.md#91-crm-implementation-roadmap).

## Desktop and privacy direction

The finished distribution must install/bundle necessary components. Ordinary users
must not need Git, Node.js/Python installation, development dependencies, npm commands
or manual database configuration. No installer/download release is currently provided,
and no desktop shell has been chosen. Many independent installations do not imply
multi-tenant SaaS or a shared database.

Current data is stored in local SQLite. Private CRM use must not require a central
Job Nearby cloud service. Public source does not make CVs, letters, contacts, notes,
application history or captured personal material public. Do not contribute personal
databases, backups or application documents. Backup/restore and portable export are
required future product workflows; no cloud sync is assumed.

Document imports are limited to 5 MiB. Managed files live under the per-user
application-data directory (`%LOCALAPPDATA%/JobNearby` on Windows), independently
of the current SQLite path. `JOB_NEARBY_DOCUMENT_DATA_DIR` can select another
absolute persistent root outside the checkout and temporary directories. Do not
change it without moving/restoring its document subtree. A complete backup needs
**both the SQLite database and managed document files**. File locations are relative
in metadata; the original imported source file is not required. See the architecture
for platform defaults, integrity checks and crash-recovery limitations.

## Documentation

- [Product specification](docs/PRODUCT_SPECIFICATION.md)
- [Data model and CRM gaps](docs/DATA_MODEL.md#78-crm-core-gap-analysis-m181)
- [Architecture, packaging gaps and roadmap](docs/ARCHITECTURE.md)
- [Recognition model](docs/RECOGNITION_MODEL.md)

## Current development technology

TypeScript, Node.js, React/Vite, SQLite via native better-sqlite3,
Zod validation, and Vitest/jsdom for testing. Browser capture uses the repository's Manifest V3 extension
as a client of the local API. No Python service is part of the application runtime.

The commands below describe developer operation of an existing checkout with Node/npm
and dependencies installed. They are not an ordinary-user installation guide. Supported
runtime/platform versions, native dependency setup and contribution instructions still
need a tested development guide. Starting the API applies migrations to its configured
local database; use a disposable working directory/data store for development checks.

## Developer-run local vacancy review UI

Start the API server in one terminal:

```text
npm run capture:server
```

Start the local UI in another:

```text
npm run ui:dev
```

Open `http://127.0.0.1:5173/` to browse the vacancy inbox, then choose a vacancy to
review. `http://127.0.0.1:5173/review/<canonicalVacancyId>` remains available for a
direct review URL. Browsing the inbox and opening a review are read-only; only an
explicit action button creates a private interaction event. The API allows this fixed
local UI origin in addition to supported browser-extension origins.

Vacancy reviews also offer reversible archive/restore and previewed permanent deletion.
See [Vacancy cleanup](docs/VACANCY_CLEANUP.md) for safeguards, shared evidence retention,
and migration 011. Starting the server applies pending migrations; implementation
verification used isolated databases and did not start it against the live database.

## License and public release

**Open-source license selection required before public release.** No LICENSE file
is currently tracked. Public GitHub source alone is not sufficient for legally clear
open-source reuse or redistribution. A separate license/dependency audit is required;
this document does not select a license or assert dependency compatibility.

Release readiness also requires contribution guidance, installer/download and upgrade
instructions, supported platforms, reproducible build/release procedures and a privacy
review of source history, fixtures and release artifacts. See architecture sections
68, 90 and 91. No release automation or installer is implemented by this documentation.
