# Contributing to Job Nearby

Job Nearby is a free, open-source, local-first desktop CRM for job seekers. It is a
Windows desktop application with local SQLite persistence, a React/Vite UI, and an
optional Manifest V3 browser extension for vacancy capture. The application does not
use a central Job Nearby service.

This guide is for technical contributors. It assumes you can work from a terminal and
run Node.js/npm commands. You do not need to know the project's history to make a
focused contribution.

## Before you start

- Read the [README](README.md), [architecture](docs/ARCHITECTURE.md), and
  [product specification](docs/PRODUCT_SPECIFICATION.md) before changing behavior.
- Search existing issues before opening a new one.
- For large features, architectural changes, database changes, or security-sensitive
  work, open an issue first so the approach can be discussed.
- Never use real job-search data for development or testing. See
  [Development data safety](#development-data-safety).
- For a vulnerability, follow [SECURITY.md](SECURITY.md), not the public issue tracker.

## Development prerequisites

Only these are needed for the normal source/test workflow:

- Git.
- Node.js and npm. The repository has no root `engines` range; the locked Electron
  package declares `node >= 22.12.0`, so use a current Node 22 or newer release.
- A terminal. The examples use PowerShell on Windows; equivalent shell commands work.
- A Chromium-based browser (for example Chrome or Edge) if you are working on the
  browser extension. The extension is not distributed through a browser store.

For desktop packaging or native rebuilds you also need:

- Windows x64.
- The native build prerequisites for `better-sqlite3` and `@electron/rebuild`
  (a supported Windows C++ build toolchain and the node-gyp/Python prerequisites).
  See [Windows desktop distribution](docs/DESKTOP_DISTRIBUTION.md).

The installed application does not require Node, npm, Vite, Git, Python, or build tools.
Those are development dependencies only.

## Fresh clone setup

```text
git clone https://github.com/Alexey-Antonenko-Nice/JobNearby.git
cd JobNearby
npm ci
npm run typecheck
npm run build
npm run ui:build
```

`npm ci` uses the committed `package-lock.json`. Do not replace it with `npm install`
when preparing a pull request; dependency changes must update the lockfile
intentionally. If your environment blocks package install scripts, Electron's binary
and native dependencies may need their normal install/rebuild step before desktop
development. That is an environment setup issue, not a reason to commit generated
binaries or change the lockfile.

### Line endings

`.gitattributes` sets `* text=auto eol=lf`. Repository text files are stored and
checked out with LF, including on Windows. A normal Windows Git configuration
(`core.autocrlf=true`) works; do not manually convert files to CRLF and do not add
CRLF-only files. Do not require contributors to set `core.autocrlf=false`.

## Development data safety

**Never run tests, experiments, or development servers against real user data.** In
particular, do not point them at `%LOCALAPPDATA%\JobNearby`,
`%LOCALAPPDATA%\JobNearby-Backups`, or any real database, managed-document store, or
backup directory.

Use a disposable development root and delete it when you are finished. Tests normally
create their own temporary roots; do not change them to use a real profile.

### Development data root

The desktop application reads `JOB_NEARBY_APP_DATA_DIR`. The CLI development server
does not use that variable; it uses the database/document/backup path variables below.
The managed document directory is rejected if it is inside the repository or inside
the operating-system temporary directory.

PowerShell example for a desktop development profile:

```powershell
$devRoot = Join-Path $env:LOCALAPPDATA "JobNearby-Dev"
$env:JOB_NEARBY_APP_DATA_DIR = $devRoot
$env:JOB_NEARBY_BACKUP_DIR = "$devRoot-Backups"
npm run desktop
```

PowerShell example for the CLI dev server used by the Vite UI:

```powershell
$devRoot = Join-Path $env:LOCALAPPDATA "JobNearby-Dev"
$env:JOB_NEARBY_DATABASE_PATH = Join-Path $devRoot "job-nearby.sqlite"
$env:JOB_NEARBY_DOCUMENT_DATA_DIR = $devRoot
$env:JOB_NEARBY_BACKUP_DIR = "$devRoot-Backups"
npm run capture:server
```

Do not commit these directories, their databases, or anything produced from them.
Unsetting the variables returns to the default locations.

## Backend and UI development

For browser-based UI development, run the API and Vite in two terminals.

Terminal 1, the local API:

```text
npm run capture:server
```

This builds the backend and starts it on `127.0.0.1:4317` with the documented Vite
development origin.

Terminal 2, the UI:

```text
npm run ui:dev
```

Open `http://127.0.0.1:5173/`. Vite proxies `/vacancies`, `/work-queue`, `/contacts`,
`/documents`, `/backup`, `/export`, `/extension`, and `/dev` to the API. The API must be
running for the UI to load data.

In development mode the UI obtains its desktop session credential from the
development-only `GET /dev/session` endpoint. The packaged desktop app does not expose
that endpoint; it injects the credential into the served HTML shell instead. Do not add
a production token endpoint or otherwise copy the development bootstrap into packaged
mode.

Backend build and focused checks:

```text
npm run build
npm run typecheck
npx vitest run tests/security
npx vitest run tests/acquisition
npx vitest run tests/path/to/file.test.ts
```

## Desktop development

```text
npm run desktop
```

This builds the backend and UI, rebuilds `better-sqlite3` for the installed Electron
version, and launches the desktop app. It requires the Electron binary installed by npm
and the native build prerequisites.

Desktop development differs from browser-only development:

- The desktop UI/API uses an OS-assigned `127.0.0.1` port.
- The extension capture listener uses the fixed port `127.0.0.1:4317`.
- A single-instance lock prevents two desktop instances from opening the same profile.
- The renderer receives its session credential from the served HTML, not from
  `/dev/session`.

Build the production desktop package with:

```text
npm run desktop:package
```

This is slower and is only required for changes affecting desktop startup, Electron,
packaging, native dependencies, security bootstrap, or installer contents. It writes to
`release/`, which must not be committed.

## Browser extension development

The extension source is `browser-extension/`. It is loaded manually as an unpacked
extension; it is not bundled into the desktop package and is not currently distributed
through a browser store.

1. Start the full desktop app with `npm run desktop`. The CLI-only `capture:server`
   does not start the separate extension capture listener.
2. Load `browser-extension/` as an unpacked extension in Chrome or Edge.
3. In Job Nearby open **Backup & restore -> Browser extension**, choose **Show pairing
   code**, and copy the code.
4. Open the extension popup, paste the code, and save it.
5. Open a vacancy page and press **Capture this page**.

The extension has `activeTab`, `scripting`, and `storage` permissions, and a host
permission limited to `http://127.0.0.1:4317/*`. It has no background worker, content
scripts, analytics, or remote endpoints. The pairing credential is stored in
`chrome.storage.session` (with a local-storage fallback only where session storage is
unavailable), sent only to the capture endpoint, and never placed in a URL or page.
The credential is scoped to capture only and cannot access the desktop API.

The desktop process generates fresh credentials on every start. Re-pair after a desktop
restart. A browser restart may also clear session-scoped pairing storage. A stale
credential produces a reconnect message; there is no unauthenticated fallback.

Do not paste pairing credentials into issues, screenshots, logs, or pull requests.

## Tests

Run the complete backend suite:

```text
npm run test
```

Run the complete UI suite:

```text
npm run test:ui
```

Focused suites:

```text
npx vitest run tests/security
npx vitest run tests/acquisition
npx vitest run tests/path/to/file.test.ts
npx vitest run --config ui/vitest.config.ts ui/src/path/to/file.test.tsx
```

`npm run test` runs backend tests only; UI tests are separate. Use the relevant focused
suite while iterating, then run the complete suites for broad changes.

### Known aggregate-test timing issue

Aggregate backend runs can occasionally hit Vitest's 5-second per-test timeout under
load. Historically this has affected:

- `tests/infrastructure/DailyWorkQueue.test.ts`
- `tests/infrastructure/SqliteUserVacancyInteractionRepository.test.ts`
- `tests/persistence/PromanHistoricalRemediation.test.ts`

If one of these times out in a full run, rerun that exact file independently and
investigate the failure if it reproduces. Do not raise timeouts or normalize the
failure away without causal evidence.

## Required pre-PR checks

Run the composed local check:

```text
npm run check:contributor
```

It runs `check:repo`, `check:fixtures`, `check:history`, `audit:licenses`, `typecheck`,
`build`, and `ui:build`. It is a fast guard, not a substitute for the tests relevant to
your change.

Also run the production dependency audit and the tests for the areas you changed:

```text
npm audit --omit=dev
```

For broad or shared changes, run both complete suites:

```text
npm run test
npm run test:ui
```

`check:repo` inspects paths tracked by Git; stage new files before relying on it to
check them. `check:fixtures` scans the fixture directory in the working tree.

## Packaging check

Run `npm run desktop:package` when your change affects any of:

- desktop startup or `desktop/main.cjs`;
- Electron or its native modules;
- packaging configuration or files included in the installer;
- security bootstrap or the served HTML shell;
- native dependencies such as `better-sqlite3`.

The generated `release/` directory is ignored by Git and must not be committed.
Packaging is not required for documentation-only changes.

## Fixtures and test data

Follow [tests/fixtures/README.md](tests/fixtures/README.md). In summary:

- Prefer a synthetic fixture; otherwise use a minimized, sanitized real-derived
  fragment.
- Keep only the evidence the assertions need: no page chrome, navigation, ads,
  unrelated vacancies, full prose, scripts, or styles. A JSON-LD block may remain where
  a structured-data test needs it.
- Use reserved domains for invented contacts (`example.test`) and obviously synthetic
  phone numbers.
- Remove tracking, session, referral, and authentication parameters; keep provider/job
  IDs only when they are the regression evidence.
- Use `.meta.json` sidecars for the canonical provider URL, not a captured tracking URL.
- Stay within the documented size budget (100 KB normal, 250 KB exceptional with a
  narrow allowlist reason). Multi-megabyte captures are rejected.
- Never include real personal contact data, private emails, phone numbers, CVs, or
  application documents.

Do **not** paste large copyrighted third-party pages into fixtures. A minimized
structural fragment or a synthetic reproduction is preferred. A real-derived fixture
should contain only what the regression needs; this project does not claim blanket
permission to redistribute provider content.

## Privacy rules

See [privacy and data handling](docs/PRIVACY.md) for the full data model. Do not commit
or attach any of the following to an issue, pull request, fixture, log, or screenshot:

- real CVs, resumes, or motivation letters;
- private email addresses, phone numbers, recruiter or hiring-manager details;
- `job-nearby.sqlite` or any application database;
- backups, exports, or managed document stores;
- browser cookies, authorization headers, session credentials, or pairing codes;
- personal diagnostic dumps, or logs containing private IDs, paths, or vacancy data.

Use synthetic or redacted reproductions. Redact local usernames, paths, employer and
recruiter details, and personal contact data from logs and screenshots. For behavior
that only appears with a private dataset, reduce it to the smallest synthetic case that
still demonstrates the problem.

## Dependencies, licensing, and native code

Job Nearby is [MIT-licensed](LICENSE). By submitting a contribution, you agree that
your contribution is licensed under the project's MIT license. This project does not
use a CLA or a DCO/sign-off requirement.

- Respect the MIT license and the licenses of third-party components.
- Do not copy incompatible code or assets. If you copy or adapt third-party code,
  identify its source, license, and required notices.
- Preserve required third-party notices and generated license inventory.
- Run `npm run audit:licenses` when you add or upgrade a dependency. The
  [licensing policy](docs/LICENSING.md) and
  [third-party notices](THIRD_PARTY_NOTICES.md) document the acceptance rules and
  current obligations.
- Run `npm audit --omit=dev` for the production dependency set.
- Do not add a dependency for a trivial helper that the standard library can provide.
- Dependency changes need a reason, a license review, a `package-lock.json` update, and
  the affected build/package tests.

Changes involving native Node modules must be verified against the Electron version and
Windows x64 packaging. `better-sqlite3` is the current native example; use
`npm run desktop:rebuild-native` and `npm run desktop:package` where relevant.

## Database and migration rules

Schema changes must use a new versioned migration under
`src/infrastructure/database/migrations/` and must be registered in
`migrateDatabase.ts`. Include migration tests and consider backward compatibility,
existing data, and backup/restore compatibility.

**Never edit an already-released or already-applied migration to change its meaning.**
Add a new migration instead. Do not rewrite migration history or ask users to edit
their local SQLite database manually.

## Domain and data invariants

Before changing CRM, recognition, capture, or persistence behavior, read
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md),
[docs/PRODUCT_SPECIFICATION.md](docs/PRODUCT_SPECIFICATION.md), and
[docs/SECURITY_MODEL.md](docs/SECURITY_MODEL.md). Do not reproduce the full domain
model here; these are examples of invariants to preserve:

- A displayed company is not the same thing as a recognized employer, and neither is a
  human vacancy-specific confirmation.
- Private CRM state must survive recapture; source observations and evidence must not be
  overwritten by later private state.
- Archive, process state, recognition, and next-action state are separate concepts.
- A provider extraction must preserve selected-vacancy isolation and provider identity;
  avoid broad catch-all routing and unbounded evidence.
- A complete backup is the SQLite database plus the managed document store. Export is
  not a backup, and export formats cannot be restored.
- Do not silently change backup/export formats or schemas; add versioning and a
  migration strategy, and review restore compatibility.

## Provider capture and recognition changes

Read [acquisition](docs/ACQUISITION.md), [canonical vacancy identity](docs/CANONICAL_VACANCY.md),
[recognition](docs/RECOGNITION_MODEL.md), and the relevant employer/organization review
documents before changing extraction or recognition. A provider change must:

- preserve selected-vacancy isolation and provider identity;
- avoid broad catch-all routing that captures unrelated page content;
- use bounded evidence and the existing canonical/observation boundaries;
- add a minimized regression fixture and tests for the provider behavior;
- keep private CRM state and later human decisions from overwriting source evidence.

Do not scrape new live pages into the repository just to create a fixture. Follow the
fixture rules above and `tests/fixtures/README.md`.

## Security invariants

Do not weaken the loopback authorization implemented in M25.2:

- loopback-only binding and exact Host validation;
- the Origin policy, including rejection of foreign and `null` origins;
- separate, scoped desktop and extension session credentials;
- default-deny APIs with authentication before routing;
- `application/json` enforcement for mutations;
- capture rate limiting;
- no token logging, persistence, query-string use, or renderer storage;
- the production HTML Content-Security-Policy;
- extension credentials cannot access desktop APIs.

Never remove authorization headers, add an unauthenticated token endpoint, put tokens
in query strings, persist the desktop token, or add a global authentication bypass.
Changes in this area must run the security suites:

```text
npx vitest run tests/security
npx vitest run tests/acquisition/popupPairing.test.js
```

## Pull request expectations

Keep a pull request focused. Explain:

- what changed and why;
- what you tested, with commands/results;
- compatibility or migration risk;
- security impact if the change touches loopback APIs, extension permissions or
  authentication, filesystem paths, backup/restore, document handling, or
  dependencies/native code;
- screenshots only for UI changes, with vacancy, contact, and private CRM details
  redacted.

Add or update tests and documentation where the behavior changed. Do not include
generated artifacts, local data, secrets, or unrelated cleanup. Follow the issue and PR
templates; they include the privacy and security questions.

Commit messages should describe the change. There is no enforced message convention;
avoid one giant commit that mixes unrelated cleanup with a behavioral change.

AI-assisted contributions are allowed. You remain responsible for correctness,
licensing/provenance, privacy, tests, and the final diff.

### What not to include

Do not commit:

- `release/`, `dist/`, `ui/dist/`, `node_modules/`;
- local databases (`.sqlite`, `.db`) or their `-wal`/`-shm` files;
- backups, exports, managed document stores, logs, or `.env` files;
- generated installer artifacts or test output.

See [.gitignore](.gitignore). Generated files and local data are also rejected by the
repository checks.

## Security vulnerabilities

Do not open a public issue with an exploitable vulnerability, proof-of-concept, secret,
or private data. Follow [SECURITY.md](SECURITY.md) for the private reporting route and
the fallback if private reporting is unavailable. Ordinary functional bugs belong in
the public issue tracker.

## Git history

`npm run check:history` protects publishable history from private database/diagnostic
paths and oversized blobs. If you accidentally commit sensitive data, stop and report
it rather than attempting your own history rewrite. Do not force-push or rewrite
`main` without maintainer coordination.

## Release-related changes

Release automation, signing, GitHub Actions publishing, installer branding, and release
templates are separate milestones. Do not add them as part of an ordinary contribution
unless the change has been explicitly coordinated with the maintainer.

## Getting help

Use GitHub issues for normal questions and reproducible functional problems. Keep
private data out of the issue. For vulnerabilities, follow
[SECURITY.md](SECURITY.md).

By contributing, you agree that your contribution is licensed under the project's MIT
license.
