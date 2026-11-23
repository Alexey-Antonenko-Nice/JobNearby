# Privacy and data handling

This page describes how the Job Nearby desktop application handles data. It is a
technical data-handling statement for an open-source local application, not a legal
privacy policy and not legal advice. It describes the current pre-release
implementation; future features that change data handling must update it.

## Overview

Job Nearby is a local-first desktop CRM for job seekers. The application stores its
data on the computer where it runs. It has no Job Nearby account system, no Job
Nearby cloud backend and no application analytics or telemetry. The desktop
application does not upload CRM data to a Job Nearby service.

The only network interfaces created by Job Nearby itself are HTTP listeners on the
loopback interface (`127.0.0.1`), used by the desktop window and by the optional
browser extension. They require a per-session credential generated when Job Nearby
starts and validate the request Host and Origin; they are not open to arbitrary local
web pages. See [Security model](SECURITY_MODEL.md) for the trust boundaries.

## What Job Nearby stores

Data falls into three layers:

1. **Captured source evidence** — what a supported job page showed when you
   captured it: source URL, page title, visible page text, provider metadata, and the
   raw page HTML (bounded by the capture limits), plus capture timestamps. Captured
   pages may contain employer names, recruiter names, business contact details, job
   descriptions and other information published on that page. Job Nearby does not
   create that information; it records what the page contained when you captured it.
2. **Canonical vacancy and employer state** — normalized vacancy fields and
   evidence, employer-recognition state, employer clusters/aliases, and the
   vacancy-specific employer-role and identity decisions you make. These are derived
   records stored alongside the source evidence.
3. **Private CRM data** — priority, append-only notes, process-state history, next
   actions and reminders (with their change history), contacts and contact methods,
   vacancy-contact relationships, interaction events, imported document metadata and
   immutable document versions, vacancy-document associations, archive/delete state,
   and the cleanup history needed to keep those operations auditable.

The application also keeps the Electron/Chromium profile (cache, local storage and
similar runtime files) under the same application-data root. Derived views such as the
inbox, review timeline and daily work queue are computed from stored records.

## Where data is stored

On Windows the packaged application uses:

- **Application data root:** `%LOCALAPPDATA%\JobNearby`
- **CRM database:** `%LOCALAPPDATA%\JobNearby\job-nearby.sqlite`
- **Managed imported documents:**
  `%LOCALAPPDATA%\JobNearby\documents\<document-id>\<version-id>\content`
- **Default backups:** `%LOCALAPPDATA%\JobNearby-Backups`

The same root also holds the Electron profile. Technical documentation describes the
supported environment-variable overrides (`JOB_NEARBY_APP_DATA_DIR`,
`JOB_NEARBY_DOCUMENT_DATA_DIR`, `JOB_NEARBY_DATABASE_PATH`, `JOB_NEARBY_BACKUP_DIR`);
they are configuration controls, not privacy features.

Nothing is stored inside the installation directory; the application does not use it
for its own data stores. Uninstalling the application does not delete the
application-data root or the default backup directory.

## Browser extension

The optional Job Nearby Capture extension runs in your browser. It captures the page
only when you open the extension and press **Capture**. Before the first capture, pair
it with the running desktop app: open **Backup &amp; restore → Browser extension** in Job
Nearby, choose **Show pairing code**, and paste that code into the extension popup. The
extension stores the code in browser session storage (not in the page) and sends it on
capture requests. The code is valid for the current desktop session; after Job Nearby
restarts (and after a browser restart where session storage is used), pair again.

When you press **Capture**, the extension:

1. reads the active tab's URL, title, visible text and page HTML (including open shadow
   roots where readable),
2. sends that payload with its pairing credential to the fixed local endpoint
   `http://127.0.0.1:4317/acquisition/browser`,
3. shows the processing result in the popup.

The extension has the `activeTab`, `scripting` and `storage` permissions and a host
permission limited to `http://127.0.0.1:4317/*`. It has no access to other sites unless
you invoke it on the active page, and it has no background worker, analytics or remote
endpoints. It is currently installed manually as an unpacked extension; it is not
distributed through a browser add-on store and therefore has no store-provided automatic
updates.

Captured page content becomes part of your local database. Treat any page you capture
as potentially containing third-party personal data, and use it accordingly.

## Network communication

- The **desktop application's own code** makes no outbound requests to Job Nearby
  servers or third-party services. The UI talks to the local API on the same loopback
  origin, and the backend stores data locally.
- The **browser extension** only talks to `127.0.0.1:4317`.
- **Links to job sources** in the UI open the provider page through the desktop
  runtime; the provider site then applies its own policies and network behavior.
- The **Electron/Chromium runtime** may perform platform-level network activity that is
  not initiated by Job Nearby application code (for example certificate or DNS
  behavior). Job Nearby does not configure analytics, crash-reporting uploads, remote
  configuration, or a remote recognition service.
- There is **no auto-update mechanism**: the installed application does not download
  or install updates by itself.

## Telemetry and analytics

Job Nearby does not implement application analytics or telemetry, and does not include
an analytics, crash-reporting or product-metrics SDK. Errors are shown or written to
the local process output; they are not automatically transmitted to the maintainers.
If you choose to report a bug, do not include your database, backups, exports,
imported documents or real CRM data.

## Imported documents

When you import a CV or motivation letter, Job Nearby copies the file bytes into its
managed application-document store and records metadata (name, kind, original file
name, media type, size, SHA-256 content hash, version, timestamps). Import is limited
to 5 MiB per file and to the configured document kinds. The original file is not needed
after import, and deleting the original file does not delete Job Nearby's copy.

Imported files are stored as-is: Job Nearby does not parse, render, execute or
otherwise interpret document contents. They are not encrypted. When you download a
version, it is served as an attachment; opening it afterwards is handled by your
operating system and its associated applications. Treat documents from untrusted
sources with the same caution as any downloaded file.

## Backups

A whole-application backup is a single ZIP file containing:

- `manifest.json` with format/schema versions and SHA-256 checksums,
- `database.sqlite` — a consistent snapshot of the CRM database,
- `documents/...` — every managed document version referenced by that database.

Backups contain the same private information as the application: vacancy history,
contacts, notes, interactions, actions/reminders, imported CVs and letters, and
employer decisions. **Job Nearby does not encrypt backups.** Store and share backup
files as sensitive data.

The default destination is `%LOCALAPPDATA%\JobNearby-Backups`; you can enter a
different path in the backup form. Restore validates the archive (format and schema
version, manifest bounds, checksums, database integrity, document hashes and sizes,
path traversal and ZIP limits), creates a pre-restore safety backup, then swaps state
in a staged operation with rollback on failure. Restore replaces local state rather
than merging it. Restore only backups you created or otherwise trust: a backup is
application state, not merely data.

## Exports

Data export is separate from backup. Job Nearby can produce:

- a human-readable JSON export, or
- a ZIP of UTF-8 CSV tables (with a small manifest).

Exports include vacancies, canonical fields, source metadata, employer display state,
CRM priority/process state, notes, process history, interactions, actions/reminders,
contacts and contact methods, and document metadata/version hashes and associations.
**Document bytes are not included in exports.** Exports currently include archived
records; the local API can exclude them, but the desktop UI does not expose that
option. Exports are not encrypted and cannot be used to restore the application.

Export destinations: if you enter a path, the local backend writes the file there; if
you leave it blank, the export is returned to the desktop UI and handled by the
runtime's normal download flow.

## Deleting local data

There is currently no "delete all my data" control.

- Vacancies can be archived or, after a preview and explicit confirmation, permanently
  deleted subject to the application's history safeguards. Archived records remain in
  local storage.
- Contacts and application documents support archive/restore; permanent document
  deletion is intentionally deferred. Historical versions and references may remain
  even when current state changes.
- Notes, process transitions, interaction events, action/reminder changes and document
  versions are append-only or immutable by design; they are part of the CRM history.
- Uninstalling Job Nearby does **not** remove `%LOCALAPPDATA%\JobNearby` or
  `%LOCALAPPDATA%\JobNearby-Backups`. To remove all local Job Nearby data you must
  delete those directories yourself. Backups and exports stored elsewhere must be
  removed separately. Deletion is not reversible.

## Security limitations

- Job Nearby does not encrypt its SQLite database, managed document files, backups or
  exports. Protection therefore depends on your Windows account, filesystem ACLs and
  any disk encryption you choose to enable.
- The local HTTP interfaces require a per-session credential and validate the request
  Host and Origin, but they do not defend against malicious software already running
  under your Windows account. See [Security model](SECURITY_MODEL.md) for the trust
  boundaries and residual limitations.
- A local attacker who already controls your Windows account can generally read your
  application data; this is outside the threat model.
- The current Windows installer is unsigned and may trigger a SmartScreen warning.

## Third-party websites

Job Nearby works with content you capture from external job websites. Those websites
have their own terms and privacy policies, which govern their data. Job Nearby is not
affiliated with, endorsed by, or acting on behalf of those providers, and this document
does not govern their sites.

## Changes to this document

This document describes the current pre-release implementation. Changes that add
cloud sync, telemetry, remote APIs, auto-update, accounts or shared workspaces must
update this document and the security model before release.
