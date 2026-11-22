# Windows desktop distribution

M23.2 packages Job Nearby for Windows x64. This is a local distribution milestone,
not a public release, signed installer, or auto-update implementation.

## Build

On a Windows x64 development machine, install the repository's pinned npm
dependencies and the native build prerequisites required by `better-sqlite3` and
`@electron/rebuild` (Node.js/npm and a supported Windows C++ build toolchain).
Then run:

```text
npm run desktop:package
```

The command removes stale generated build/package outputs, builds the backend and
React UI, rebuilds `better-sqlite3` for the Electron version, creates an NSIS
installer and unpacked app, and writes a SHA-256 checksum beside the installer.
Root `package.json` is authoritative for the app version and packaging metadata.

Expected outputs:

- `release/win-unpacked/Job Nearby.exe` — unpacked Windows x64 app.
- `release/Job-Nearby-Setup-<version>.exe` — per-user NSIS installer.
- `release/Job-Nearby-Setup-<version>.exe.sha256` — SHA-256 checksum.

`release/` is generated output and is ignored by Git. The package uses ASAR for
application resources and unpacks native `.node` binaries. It includes the Electron
runtime, desktop main process, compiled backend, production dependencies, and built
UI; tests, fixtures, maps, databases, and environment files are excluded. The build
does not bundle the browser extension.

## Packaging dependencies

The locked package metadata reports these licenses:

| Dependency | Locked version | License |
| --- | --- | --- |
| Electron | 42.11.18 | MIT |
| electron-builder | 26.18.1 | MIT |
| app-builder-lib | 26.18.1 | MIT |
| builder-util | 26.18.1 | MIT |
| builder-util-runtime | 9.7.1 | MIT |
| @electron/rebuild | 4.2.1 | MIT |
| better-sqlite3 | 13.0.3 | MIT |

electron-builder downloads NSIS and 7-Zip build tools during packaging; their
redistribution notices remain part of the future full dependency/license audit.
The project itself still has no selected license, so this table is not a
redistribution approval.

At this milestone `npm audit --omit=dev` reports zero vulnerabilities. The full
development dependency audit still reports six moderate findings through
electron-builder's transitive `minimatch` chain; no high or critical findings
remain. This build-tool finding is recorded for follow-up, not force-fixed by
downgrading the packager.

## Installation and data

The NSIS installer is per-user and does not request elevation. It creates a Start
Menu shortcut; it does not create a Desktop shortcut. The install location can be
selected in the installer. Installing or uninstalling only handles application
files and shortcuts; installer scripts do not open or modify the database.

The app stores its database, managed documents, and Electron profile in
`%LOCALAPPDATA%\\JobNearby`; default backups are kept in the sibling
`%LOCALAPPDATA%\\JobNearby-Backups`. Uninstall preserves both directories, and a
reinstall or install over an existing version uses the same app-data root. The app
does not migrate repository/cwd development databases automatically. Existing data
can be moved or restored using the application's supported backup/restore workflow.
The `JOB_NEARBY_APP_DATA_DIR`, `JOB_NEARBY_DATABASE_PATH`,
`JOB_NEARBY_DOCUMENT_DATA_DIR`, and `JOB_NEARBY_BACKUP_DIR` overrides remain
available for controlled testing and explicit configuration.

## Current limitations

- Only Windows x64 is packaged; macOS, Linux, and Windows ARM64 are not qualified.
- The installer is unsigned and may trigger a Windows SmartScreen warning.
- Browser capture remains optional. Install the browser extension separately; it
  connects to `127.0.0.1:4317` and is not automatically installed or bundled.
- There is no auto-update service or public release distribution.
- No project license has been selected; no license-agreement page is presented.
- No final Job Nearby icon is tracked; the package uses the packager's default icon.
- Validation is performed on the available Windows host; a separate clean VM is
  needed to prove behavior without any development toolchain.

These packages should not be described as signed, universally supported, or
public-release ready.
