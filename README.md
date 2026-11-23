# Job Nearby

Job Nearby is intended to be a completely free, open-source desktop CRM for job
seekers, with employer-recognition capabilities. It is licensed under the
[MIT License](LICENSE), and its source is intended to become public on GitHub for
community inspection and contribution. A local Windows package exists, but public
release distribution is not complete.

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

Planned: richer activity/submission tracking, broader search, manual vacancies, and
field overrides.
See [the implementation roadmap](docs/ARCHITECTURE.md#91-crm-implementation-roadmap).

## Windows desktop package

M23.2 provides a Windows x64 per-user NSIS installer and an unpacked application.
Developers with Node/npm and the native build prerequisites can run
`npm run desktop:package`; it cleans old build outputs, builds the backend and UI,
rebuilds SQLite for Electron, creates both package artifacts, and writes the
installer's SHA-256 file under `release/`. The package does not require Node/npm,
Vite, Git, Python, or build tools on the installed user's machine.

The installer creates a Start Menu shortcut (no Desktop shortcut by default), is
unsigned, and may trigger a SmartScreen warning. Uninstall removes installed
application files and shortcuts but preserves `%LOCALAPPDATA%\\JobNearby` and
`%LOCALAPPDATA%\\JobNearby-Backups`; reinstalling uses the same app data. Existing
developer data is not relocated automatically. The browser extension remains
optional and must be installed separately; it uses `127.0.0.1:4317`.
Auto-update, code signing, and public release distribution are not included.

See [Windows desktop distribution](docs/DESKTOP_DISTRIBUTION.md) for build
prerequisites, exact outputs, install/data behavior, and current limitations.

## Privacy and security

Job Nearby is local-first. The CRM database, managed documents and default backups are
stored on your computer (`%LOCALAPPDATA%\JobNearby` and the sibling
`%LOCALAPPDATA%\JobNearby-Backups`). There is no Job Nearby account, cloud backend or
application telemetry, and the desktop application does not upload CRM data to a Job
Nearby service. The optional browser extension captures the active page only when you
invoke it and sends the capture to the local `127.0.0.1:4317` listener. The extension
must be paired with the running desktop session; the pairing code is shown in
**Backup & restore → Browser extension** and stored only in the extension's browser
session.

Backups and exports contain private CRM data, and backups also contain imported
documents. They are not encrypted by Job Nearby, so treat them as sensitive files.
Uninstalling preserves the data directories; deleting local data is a manual step.

Read [Privacy and data handling](docs/PRIVACY.md) for what is stored and how deletion
works, the [security model](docs/SECURITY_MODEL.md) for trust boundaries and known
limitations, and [SECURITY.md](SECURITY.md) for vulnerability reporting. The loopback
HTTP interfaces require a per-session credential and validate the request Host and
Origin; the browser extension must be paired with the running desktop app before it can
capture.

Many independent installations do not imply multi-tenant SaaS or a shared database.

Current data is stored in local SQLite; there is no central Job Nearby service. Public
source does not make your CVs, letters, contacts, notes, application history or captured
personal material public. Do not contribute personal databases, backups or application
documents. Backup/restore and portable export are implemented; no cloud sync is
included. See [privacy and data handling](docs/PRIVACY.md).

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
- [Windows desktop distribution](docs/DESKTOP_DISTRIBUTION.md)
- [Contributing](CONTRIBUTING.md)
- [Privacy and data handling](docs/PRIVACY.md)
- [Security model](docs/SECURITY_MODEL.md)
- [Security policy](SECURITY.md)
- [Licensing policy and dependency audit](docs/LICENSING.md)
- [Recognition model](docs/RECOGNITION_MODEL.md)

## Current development technology

TypeScript, Node.js, React/Vite, SQLite via native better-sqlite3,
Zod validation, and Vitest/jsdom for testing. Browser capture uses the repository's Manifest V3 extension
as a client of the local API. No Python service is part of the application runtime.

The commands below describe developer operation of an existing checkout with Node/npm
and dependencies installed. They are not an ordinary-user installation guide. See
[CONTRIBUTING.md](CONTRIBUTING.md) for the tested fresh-clone setup, development data
safety, extension pairing, test commands, and required checks. Starting the API applies
migrations to its configured local database; use a disposable working directory/data
store for development checks.

Repository text files are stored and checked out with LF line endings. The root
`.gitattributes` (`* text=auto eol=lf`) enforces this, so a normal Windows clone works
with the default `core.autocrlf=true` and does not need special Git configuration.

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

The repository includes a local Model Context Protocol server
(`src/infrastructure/mcp/runCopilotMcpServer.ts`) that GitHub Copilot Chat can start
over stdio. It exposes three **read-only** repository tools — `search_workspace`,
`read_workspace_file` and `list_workspace_files` — so Copilot inspects this checkout the
way the repository agent does instead of guessing at file contents. No edit, delete,
command-execution or database tool is exposed, and all paths are confined to the
workspace root.

Register it in your VS Code MCP configuration (`servers.job-nearby-repository`) if you
want to use it. The server is launched with Node's type stripping
(`node --experimental-strip-types`, Node 22.6+), so no build step is required;
`npm run copilot:mcp` starts the same server in a terminal and
`node dist/infrastructure/mcp/runCopilotMcpServer.js` runs the compiled build instead.
`.vscode/` stays local (it holds machine-specific editor state); do not commit your
editor configuration.

This bridge gives Copilot repository context tools. It does not move the repository
agent, its model or its reasoning into Copilot, and it does not send workspace content
anywhere itself: the local server only answers the tools Copilot Chat asks for.

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md) for prerequisites, fresh-clone setup, backend/UI
and desktop/extension workflows, test commands, fixture and privacy rules, and pull
request expectations. Normal bugs are reported through GitHub issues. Do not report a
vulnerability publicly; follow [SECURITY.md](SECURITY.md).

## License and public release

Job Nearby is licensed under the [MIT License](LICENSE), Copyright (c) 2026
Alexey Antonenko. Third-party components remain under their own licenses: the
Windows package installs [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) beside the
application and keeps Electron's canonical `LICENSES.chromium.html` at the install
root. See the [licensing policy](docs/LICENSING.md) and the generated
[dependency license inventory](docs/THIRD_PARTY_LICENSES.json).

`npm run audit:licenses` audits resolved dependency licenses and fails when shipped
code has an unreviewed license; `npm run check:repo` rejects generated artifacts,
local data and high-confidence secrets in tracked files; `npm run check:history`
rejects private database or diagnostic paths and oversized blobs in reachable
history.

Public release still requires installer/download and upgrade instructions, supported
platform documentation, and reproducible build/release procedures. Contribution
guidance is now tracked in [CONTRIBUTING.md](CONTRIBUTING.md), issue and pull-request
templates are under `.github/`, and the contributor checks compose the existing
repository guards. M24.2 reduced the tracked provider fixtures to minimal regression
evidence and removed the diagnostic dump; M24.3 rewrote the published history so the
former databases, diagnostic dump and unsanitized captures are no longer reachable;
M24.4 adds a canonical LF line-ending policy and `npm run check:history` to keep it
that way. See architecture sections 68, 90 and 91, and the known warnings in the
licensing policy.

The **Today** page (`/today`) provides a derived daily CRM work queue: overdue actions, due reminders, today/upcoming work and opportunities needing a next action. It uses the browser timezone and refreshes on demand. Complete/cancel actions or dismiss due reminders directly in Today using the existing CRM commands; the entire queue refreshes afterward. Open Review for other changes. This is not a background scheduler or notification service.
