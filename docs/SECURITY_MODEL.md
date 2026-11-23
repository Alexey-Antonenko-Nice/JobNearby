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

Every request to a loopback listener is evaluated before any route, body parsing or
domain work:

1. **Host** must equal `127.0.0.1:<the port this listener bound>`. `localhost`, other
   ports and foreign names are rejected; `X-Forwarded-*` headers are not trusted.
2. **Origin**, when present, must be the exact same desktop origin, a configured
   development origin (development mode only), or an extension origin class for the
   capture listener. `null` and foreign origins are rejected. Origin validation is
   defense in depth, not a substitute for the credential.
3. **Session credential.** A 256-bit per-process secret is generated at startup and
   required in `X-Job-Nearby-Session` (desktop) or `X-Job-Nearby-Extension` (capture).
   Comparison uses `crypto.timingSafeEqual`; missing/wrong/stale values return 401.
   Desktop and extension credentials are separate and scoped: the extension credential
   authorizes only `POST /acquisition/browser` on the capture listener.
4. **Content type.** `POST`/`PUT`/`PATCH` must use `application/json`; `text/plain`,
   form and multipart requests receive 415 before body parsing. HTML-form and simple
   cross-origin requests therefore cannot reach a mutation handler.
5. **Capture rate limit.** Authenticated capture requests pass through an in-memory
   token bucket (burst 30, refill 0.5/s, i.e. 30 per minute sustained). Excess requests
   receive 429. The limiter resets with the process.

Status model: 401 for a missing/invalid/stale credential; 403 for a disallowed
Host/Origin (including disallowed preflight); 415 for a non-JSON mutation body; 429
for capture rate limiting; 404 for an unknown route or method. Authentication failures
are generic and never echo the supplied or expected credential.

The desktop renderer learns its credential from a `<meta name="job-nearby-session">`
tag injected into the HTML shell served only by the desktop listener. That response is
Host-checked, `Cache-Control: no-store`, and carries a Content-Security-Policy; the
credential is never placed in a URL, cookie, local storage or the database. The renderer
keeps it in memory and attaches it through one shared request helper.

The extension cannot read the desktop credential. The desktop UI displays a separate
extension pairing code through an authenticated `GET /extension/pairing` request; the
user pastes it into the extension popup, which stores it in `chrome.storage.session`
(falling back to `storage.local` only where session storage is unavailable) and sends it
on capture requests. A missing/revoked credential produces a clear reconnect message,
never an unauthenticated fallback. Credentials rotate when the desktop process restarts;
the extension must then be re-paired. Browser restart also clears session-scoped pairing
storage.

A development-only bootstrap (`GET /dev/session`) exists only when the server is started
with an explicit dev origin (`http://127.0.0.1:5173` by the CLI development server). The
packaged desktop application never configures it, and requests from that origin are
rejected in production mode.

### API surface

Mutation-capable groups include: browser capture, inbox/review decisions, priority,
notes, process state, next actions and reminders, contacts and contact methods,
document import/rename/archive/restore/association, employer identity and
organization-role decisions, vacancy archive/permanent deletion, backup
create/validate/restore, and JSON/CSV export. Read groups include inbox, review,
contacts, documents, work queue and employer-identity search.

Backup and export accept a user-supplied destination path; restore and validate accept
a user-supplied archive path or base64 archive. Authorization happens before any path is
read or written, and every one of these routes requires the desktop credential; the
extension credential is rejected. Read routes, including document downloads, are
protected too because they expose private CRM data.

## Browser extension boundary

The extension (Manifest V3) has:

- permissions: `activeTab`, `scripting`, `storage`;
- host permission: `http://127.0.0.1:4317/*`;
- no background service worker, content scripts, analytics, remote endpoints or store
  packaging metadata.

When the user presses **Capture**, it injects a self-contained snapshot function into
the active tab (granted by `activeTab`), reads the page URL/title/visible text/HTML,
and POSTs JSON plus `X-Job-Nearby-Extension` to the fixed capture endpoint. It does not
read other tabs, and it does not run continuously. The extension is installed manually
as an unpacked extension and has no store-provided updates.

The pairing credential is stored in extension storage, not page DOM or page scripts.
Normal web pages cannot read extension storage. The extension must be paired once per
desktop session (and again after a browser restart when session storage is used).

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

The production HTML shell sets `Content-Security-Policy: default-src 'self';
script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src
'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none';
frame-ancestors 'none'` (`unsafe-inline` is limited to styles because React uses inline
style attributes). It is served with `Cache-Control: no-store`, `nosniff` and
`Referrer-Policy: no-referrer`, and only from the Host-checked desktop listener. The
document-download endpoint also sets `Content-Security-Policy: sandbox` together with
`Content-Disposition: attachment` and `X-Content-Type-Options: nosniff`.

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
| F1 | Loopback HTTP authorization | **A — resolved in M25.2** | Every request requires an exact Host, an allowed Origin when present, and a per-process 256-bit session credential (separate desktop/extension secrets); mutations require `application/json`; capture is rate-limited. Covered by `tests/security/loopbackAuthorization.test.ts`. Residual: a process already running as the same Windows user is out of scope. |
| F2 | Content-Security-Policy on the application HTML response | **A — resolved in M25.2** | Production HTML sets a restrictive CSP; document downloads additionally use `CSP: sandbox`. |
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
