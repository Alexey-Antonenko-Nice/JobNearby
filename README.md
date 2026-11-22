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
The Documents page adds reusable-library management: active/archived/all views,
rename, archive/restore, version history and reference counts. Archived documents
remain available to existing history; permanent deletion is intentionally deferred.
M22.1 adds manual whole-application Backup & Restore (`/backup`): a single portable
ZIP archive containing a versioned `manifest.json` with SHA-256 checksums, a
consistent SQLite online backup snapshot (`database.sqlite`), and all DB-referenced
managed document files (`documents/...`). Backup is machine-restorable state recovery,
distinct from user-data export; restore validates first, creates an automatic
pre-restore safety backup, replaces local state (never merging), preserves IDs and
history, and migrates older schemas forward. No cloud backup or scheduler is included.

M22.2 adds manual user-data **Data Export** (`/backup` or `/export`) in human-readable
**JSON** (`job-nearby-export` v1) and spreadsheet-friendly **CSV** (UTF-8 with BOM,
packaged as a `.zip` of relational CSV tables). Export includes archived user data by
default, excludes internal persistence/cleanup/retry metadata and document binaries in v1,
and is strictly for inspection/portability—JSON/CSV exports cannot be used as backups
or for restore.

Planned: richer activity/submission tracking, broader search, manual vacancies, field
overrides, and ordinary-user desktop installation.
See [the implementation roadmap](docs/ARCHITECTURE.md#91-crm-implementation-roadmap).

## Desktop runtime

M23.1 adds an Electron desktop runtime foundation. After installing development
dependencies, `npm run desktop` builds the backend and UI, rebuilds native SQLite
for Electron, starts the local server, and opens the desktop window. The desktop
server binds to loopback on a dynamically assigned port and serves the production
UI from the same origin. The browser extension retains its stable capture endpoint
at `127.0.0.1:4317`; it is unavailable in the desktop app only if another process
already owns that port, in which case desktop startup reports an error rather than
silently routing extension captures to another runtime. This is not yet a packaged
installer or ordinary-user release; it requires Node/npm and a native build toolchain.

On Windows, the desktop database, managed documents and Electron profile are stored
under `%LOCALAPPDATA%/JobNearby`; backups remain in the existing sibling backup
directory by default. `JOB_NEARBY_APP_DATA_DIR`, `JOB_NEARBY_DATABASE_PATH`,
`JOB_NEARBY_DOCUMENT_DATA_DIR` and `JOB_NEARBY_BACKUP_DIR` remain available for
explicit configuration. Existing developer data is not relocated automatically.

Many independent installations do not imply multi-tenant SaaS or a shared database.

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

For the desktop runtime, run `npm run desktop` from an installed checkout.
For browser-based development, start the API server in one terminal:

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

## GitHub Copilot integration (VS Code)

`.vscode/mcp.json` registers a local Model Context Protocol server
(`src/infrastructure/mcp/runCopilotMcpServer.ts`) that GitHub Copilot Chat can start
over stdio. It exposes three **read-only** repository tools — `search_workspace`,
`read_workspace_file` and `list_workspace_files` — so Copilot inspects this checkout the
way the repository agent does instead of guessing at file contents. No edit, delete,
command-execution or database tool is exposed, and all paths are confined to the
workspace root.

Enable it once in VS Code: Command Palette → **MCP: List Servers** →
`job-nearby-repository` → **Start**, then use Copilot Chat agent mode. The server is
launched with Node's type stripping (`node --experimental-strip-types`, Node 22.6+), so
no build step is required; `npm run copilot:mcp` starts the same server in a terminal and
`node dist/infrastructure/mcp/runCopilotMcpServer.js` runs the compiled build instead.
Repository-wide Copilot conventions live in `.github/copilot-instructions.md`.
`.vscode/` stays local (it holds machine-specific editor state), so `.gitignore` re-includes
only `.vscode/mcp.json`; put the same `servers.job-nearby-repository` block in your user-level
`mcp.json` instead if you prefer not to share it.

This bridge gives Copilot repository context tools. It does not move the repository
agent, its model or its reasoning into Copilot, and it does not send workspace content
anywhere itself: the local server only answers the tools Copilot Chat asks for.

## License and public release

**Open-source license selection required before public release.** No LICENSE file
is currently tracked. Public GitHub source alone is not sufficient for legally clear
open-source reuse or redistribution. A separate license/dependency audit is required;
this document does not select a license or assert dependency compatibility.

Release readiness also requires contribution guidance, installer/download and upgrade
instructions, supported platforms, reproducible build/release procedures and a privacy
review of source history, fixtures and release artifacts. See architecture sections
68, 90 and 91. No release automation or installer is implemented by this documentation.

The **Today** page (`/today`) provides a derived daily CRM work queue: overdue actions, due reminders, today/upcoming work and opportunities needing a next action. It uses the browser timezone and refreshes on demand. Complete/cancel actions or dismiss due reminders directly in Today using the existing CRM commands; the entire queue refreshes afterward. Open Review for other changes. This is not a background scheduler or notification service.
