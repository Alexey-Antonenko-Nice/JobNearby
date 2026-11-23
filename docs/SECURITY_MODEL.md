# Security model

This document describes the security-relevant architecture of the pre-release Job
Nearby desktop application. It is aimed at technical contributors and reviewers. It
describes what the implementation actually does; it is not a penetration-test report
and does not certify the application as secure.

Companion documents: [Privacy and data handling](PRIVACY.md),
[Windows desktop distribution](DESKTOP_DISTRIBUTION.md), and the repository
[security policy](../SECURITY.md).

## Scope

In scope: the Electron desktop shell, the local HTTP API/UI server, the fixed capture
listener, local SQLite and managed-document storage, backup/restore, export, the
browser extension, and the packaged Windows application.

Out of scope: the security of third-party job websites, the user's browser outside the
extension, Windows itself, and an attacker who already controls the user's Windows
account.

## Assets

- CRM database: vacancies, captured evidence, employer-recognition state and human
  employer-role/identity decisions.
- Private CRM data: priority, notes, process history, actions/reminders, contacts and
  contact methods, interactions, archive state.
- Imported CV/motivation-letter files and document metadata/hashes.
- Backups and exports (they contain the data above; backups also contain document
  bytes).
- Integrity of canonical vacancy data, employer decisions and history.
- Availability of the local database and storage.

## Architecture and trust boundaries

```text
External job website
  -> user's browser page
  -> Job Nearby Capture extension (user presses Capture)
  -> loopback capture listener 127.0.0.1:4317
  -> acquisition / evidence processing (bounded parsing)
  -> SQLite + managed document storage

Desktop renderer (Electron BrowserWindow)
  -> same-origin loopback UI/API listener 127.0.0.1:<OS-assigned port>
  -> CRM commands / backup / restore / export
  -> SQLite + managed document storage

User-selected backup archive
  -> archive parser + validator
  -> staged restore + safety backup
  -> live SQLite + documents

User-selected document
  -> 5 MiB bounded import
  -> immutable managed document version
```

The application process runs in the Electron main process; the renderer is a separate
sandboxed web context. SQLite and file storage are accessed only by the main-process
backend, not by the renderer directly.

## Local interfaces

- **UI/API listener:** `127.0.0.1` with an OS-assigned port; serves the built UI and
  the JSON API from one same-origin server.
- **Capture listener:** `127.0.0.1`, fixed port `4317`, exposes only
  `POST /acquisition/browser`.
- Binding is enforced in `startJobNearbyServer`: any host other than `127.0.0.1` is
  rejected. Development tooling may use `127.0.0.1:5173` (Vite) and the CLI server, but
  that is not the packaged production path.

### Authentication and authorization

The loopback interfaces **do not authenticate callers**. There is no login, session,
shared secret, CSRF token or per-request authorization check.

CORS does not change this: the server reflects `Access-Control-Allow-Origin` only for
`chrome-extension://` / `moz-extension://` origins and the dev origin
`http://127.0.0.1:5173`, so ordinary web origins cannot read responses. But request
handling itself is not origin-gated, and simple cross-origin requests can still reach
the endpoint when the browser allows a request to loopback. The ephemeral UI/API port
raises the effort required to find the API, but it is not an authorization boundary.

This is a **known release-blocking gap** — see [Known findings](#known-findings).

### API surface

Mutation-capable groups include: browser capture, inbox/review decisions, priority,
notes, process state, next actions and reminders, contacts and contact methods,
document import/rename/archive/restore/association, employer identity and
organization-role decisions, vacancy archive/permanent deletion, backup
create/validate/restore, and JSON/CSV export. Read groups include inbox, review,
contacts, documents, work queue and employer-identity search.

Backup and export accept a user-supplied destination path; restore and validate accept
a user-supplied archive path or base64 archive. These are local-user features and are
also reachable through the unauthenticated local API.

## Browser extension boundary

The extension (Manifest V3) has:

- permissions: `activeTab`, `scripting`;
- host permission: `http://127.0.0.1:4317/*`;
- no background service worker, content scripts, analytics, remote endpoints or store
  packaging metadata.

When the user presses **Capture**, it injects a self-contained snapshot function into
the active tab (granted by `activeTab`), reads the page URL/title/visible text/HTML,
and POSTs JSON to the fixed capture endpoint. It does not read other tabs, and it does
not run continuously. The extension is installed manually as an unpacked extension and
has no store-provided updates.

Captured page content is untrusted input. Extraction is regex/DOM-based and bounded by
request limits: 8 MiB request, 5 MiB HTML, 2 MiB visible text. Captured HTML is stored
as evidence in SQLite metadata; it is parsed as text, never executed as a script.
Captured pages can contain third-party personal data; that is a data-handling issue
described in [PRIVACY.md](PRIVACY.md).

## Desktop renderer security

`desktop/main.cjs` creates one `BrowserWindow` with:

- `contextIsolation: true`
- `nodeIntegration: false`
- `sandbox: true`
- no preload script, no IPC bridge, and no `ipcMain`/`ipcRenderer` surface
- default `webSecurity` (no override), no remote content loaded as the app

The renderer displays structured fields; production UI code contains no
`dangerouslySetInnerHTML`, `innerHTML` or `document.write` usage. React escaping
therefore applies to rendered text.

Provider links in the UI use `target="_blank"` with `rel="noreferrer"`. The shell does
not install a navigation or window-open handler, so Electron's default behavior applies
when opening such links. There is no `shell.openExternal`, `shell.openPath` or shell
command execution in the application code.

**Gap:** the application HTML response does not set a Content-Security-Policy. The
document-download endpoint does set `Content-Security-Policy: sandbox` together with
`Content-Disposition: attachment` and `X-Content-Type-Options: nosniff`. Missing CSP on
the app UI is a hardening gap, mitigated by the absence of raw-HTML rendering.

## File and path handling

- Managed documents are stored under UUID-based keys
  (`documents/<document-id>/<version-id>/content`); user filenames are metadata only,
  never path components.
- Document imports are capped at 5 MiB, written through a staged file with read-back
  verification, and limited to the configured kinds (CV, motivation letter).
- Managed reads and imports reject symlinked path components and unexpected sizes.
- Backups and exports are written atomically with restrictive permissions where the
  platform supports them; backup destinations inside the managed document tree are
  rejected.
- Static UI serving restricts asset paths to the built `ui/dist` root and known SPA
  routes.
- Download responses use `Content-Disposition: attachment`, `nosniff`, `no-store` and a
  sandboxing CSP. Imported files are never parsed, executed or opened by the backend.

## Backup and restore as untrusted input

Restore treats an archive as untrusted:

- ZIP parser rejects absolute/drive-letter paths, `..`/`.` segments, symlink entries,
  duplicate entries, unsupported/encrypted entries, and out-of-bounds metadata.
- Limits: 10,000 entries, 256 MiB per entry, 1 GiB total extracted; manifest capped at
  2 MiB.
- CRC is checked for every entry; duplicate names are rejected.
- Manifest format/version, file and document counts, application/schema version,
  per-file SHA-256 checksums, SQLite integrity, and document size/hash agreement are
  validated before any live state is touched.
- Newer schema versions are rejected; older ones are migrated in staging and
  integrity-checked.
- Restore writes to a staging directory, creates a pre-restore safety backup, swaps
  live state, and rolls back on a failed swap; live database sidecars are handled.

A valid backup is still application state and can contain malicious or unwanted
records. Restore only backups you created or trust. The same caution applies to
archives supplied to the validate endpoint.

## Logging and diagnostics

Application code logs only to the process output (`console.error` in the desktop shell
and server startup/processing paths); it does not create its own log files. Error text
and stack traces can include local paths, canonical IDs or provider names. Electron/
Chromium may create profile, cache or crash-related files under the application-data
root as part of normal runtime behavior.

No automatic crash or diagnostic upload exists. Reports must be redacted; never attach
the database, backups, exports or managed documents.

## Local attacker and OS protections

Job Nearby does not claim to defend data against an attacker who already controls the
user's Windows account. The database, managed documents, backups and exports are
plaintext, and the application implements no encryption at rest (no SQLCipher, DPAPI
wrapping or archive encryption). Protection depends on the Windows account, filesystem
ACLs and any disk encryption the user enables.

## Supply chain and updates

- Dependencies are locked in `package-lock.json`; `npm audit --omit=dev` is part of
  release verification.
- The Windows installer is currently unsigned and may trigger SmartScreen.
- The application has no auto-update mechanism and no remote configuration.
- The browser extension is manually installed and has no store update channel.

## Known findings

| ID | Finding | Classification | Status |
| --- | --- | --- | --- |
| F1 | Loopback HTTP interfaces do not authenticate callers and do not validate `Origin`/`Host`; CORS only restricts response readability. Capture is on a fixed port; the UI/API port is OS-assigned but discoverable. Audit probes showed capture, backup creation, restore and export accept requests carrying an arbitrary `Origin` with a simple content type. Browser local-network policy may block some web-page requests, but is not a server-side control. | **C — release blocker** | Open; requires a hardening milestone (Origin/Host allowlist, per-session token or required custom header, JSON/preflight enforcement, capture rate limits) |
| F2 | No Content-Security-Policy on the application UI HTML response | B — warning | Open; low risk while no raw HTML is rendered |
| F3 | Unsigned installer / SmartScreen reputation | A — documented limitation | Open; signing is a separate milestone |
| F4 | Plaintext database, document store, backups and exports | A — documented limitation | By design for now; relies on OS protections |
| F5 | Provider links open via Electron's default window-open behavior; no explicit external-link policy | B — warning | Open; no node integration in child windows by default |

## Out of scope

- An attacker with the user's Windows account or administrator rights.
- Malicious modifications to the installed application binaries.
- Third-party job sites, provider terms and data accuracy.
- Network interception of the user's general browsing.
- Physical access to an unlocked device.

## Change management

Any change that adds cloud sync, telemetry, remote APIs, auto-update, accounts, shared
workspaces, new file formats or new loopback endpoints must update this document,
[PRIVACY.md](PRIVACY.md), and `SECURITY.md` before release.
