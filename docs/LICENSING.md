# Licensing policy

M24.1 establishes the project license and the dependency/redistribution rules used
before Job Nearby is published. This is release engineering, not legal advice.

## Project license

Job Nearby is licensed under the **MIT License** (see [LICENSE](../LICENSE)):
`Copyright (c) 2026 Alexey Antonenko`. MIT was selected because it is simple,
permissive, compatible with commercial and non-commercial reuse, and appropriate for
a free desktop utility; no distributed component requires a different project
license.

Contributors keep copyright in their own contributions and submit them under the
project license. M24.1 introduces no CLA or DCO. M25.3 adds `CONTRIBUTING.md`, which
documents the contribution process and states that submitted contributions are
licensed under the project's MIT license.

## What is distributed

| Artifact | Contains |
| --- | --- |
| `release/win-unpacked/` and the NSIS installer | Electron 42.11.18 runtime, `app.asar` (compiled backend, built UI, `better-sqlite3`, `node-addon-api`, `zod`), `app.asar.unpacked` native SQLite binary, legal resources |
| `ui/dist` (inside `app.asar`) | Minified React, React DOM and scheduler code |
| NSIS installer stub | NSIS runtime plus its LZMA module and the nsis7z (7-Zip) extraction plugin |

Not distributed: TypeScript, Vite, Vitest, jsdom, electron-builder and its
transitives, `7za.exe`, and `makensis`. The browser extension is not bundled and
contains no third-party code.

## Dependency audit

Run:

```text
npm run audit:licenses        # check; exits 1 when shipped code has an unreviewed license
npm run audit:licenses:write  # regenerate docs/THIRD_PARTY_LICENSES.json
npm run check:repo            # generated artifacts, local data, high-confidence secrets
```

`tools/licenseAudit.cjs` reads resolved versions from `package-lock.json` (not
`package.json` ranges) and falls back to installed package metadata and license
files. `docs/THIRD_PARTY_LICENSES.json` is deterministic: it has no timestamp and its
package list is sorted, so regeneration should produce no diff unless dependencies
changed.

### Acceptance policy

- Accepted without further review: `MIT`, `ISC`, `BSD-2-Clause`, `BSD-3-Clause`,
  `Apache-2.0`, `0BSD`, `CC0-1.0`, `Unlicense`, `MIT-0`, `BlueOak-1.0.0`.
- Review tier (flagged, not auto-rejected): `GPL*`, `AGPL*`, `LGPL*`, `MPL*`, `EPL*`,
  `CDDL*`, `CPL*`, `SSPL*`, `BUSL*`, Elastic, Commons Clause, `CC-BY*`, `OSL`,
  `Artistic`, `JSON`, `Python-2.0`, `WTFPL`.
- Everything else, missing license metadata, and unresolved `SEE LICENSE IN` files
  are `UNKNOWN`.

A review or unknown license in **distributed** code fails the audit. The same
license in a **dev-only** package is a warning: it does not ship, but it must be
acceptable for source-repository use. SPDX expressions are parsed: `OR` allows the
permissive branch, `AND` accumulates obligations, `WITH` requires review.

Current audit result (511 locked packages): 508 accepted, 3 dev-only warnings
(`argparse` Python-2.0, `caniuse-lite` CC-BY-4.0, `truncate-utf8-bytes` WTFPL), zero
blockers.

## Binary legal-resource strategy

`electron-builder` installs `LICENSE.txt` and `THIRD_PARTY_NOTICES.md` through
`build.extraResources`, so they live beside `app.asar` instead of being buried in it.
It also copies the Electron distribution's own license files automatically, but it
does not generate notices for npm dependencies or for the NSIS/7-Zip tooling it
embeds; Job Nearby supplies those in `THIRD_PARTY_NOTICES.md`. Electron's
`LICENSE.electron.txt` and `LICENSES.chromium.html` stay at the install root
untouched; `LICENSES.chromium.html` already covers Chromium, Node.js, V8 and SQLite
and is not duplicated. npm runtime packages keep their own `LICENSE` files inside
`app.asar`.

`npm run desktop:package` ends with `tools/verifyPackagedLegal.cjs`, which fails the
build if `LICENSE`, the notices, the Electron notice files, or the bundled package
license files are missing. No installer license-acceptance page is added: an
open-source license is not an EULA.

## Release-readiness invariant

Before any public release, all of the following must hold:

1. Root `package.json` declares the project license and `LICENSE` exists.
2. `npm run audit:licenses` reports zero blockers.
3. `npm run check:repo` reports no generated artifacts, local data or secrets.
4. `npm run check:fixtures` reports no fixture content blockers.
5. `npm run desktop:package` completes and its legal-resource verification passes.
6. `docs/THIRD_PARTY_LICENSES.json` is regenerated in the same change as any
   dependency change.
7. A Git-history publication decision is made (the current tree is content-safe, but
   historical captures remain in commits).

## Known warnings (documented, not blocking the MIT choice)

- **NSIS LZMA module (CPL-1.0).** The installer stub contains the NSIS LZMA
  decompression module. NSIS publishes an explicit linking exception
  (reproduced in `THIRD_PARTY_NOTICES.md`) that keeps Job Nearby's code outside the
  CPL. The installer distributes unmodified NSIS code; the notice and exception are
  included, and the full CPL text remains available from the NSIS project.
- **nsis7z / 7-Zip (LGPL-2.1-or-later).** The installer extracts its app archive with
  the `Nsis7z` plugin. The plugin is unmodified and is identified in the notices with
  its license and upstream source. LGPL-2.1 expects a source offer for the library;
  the notices point at the upstream source and state it can be provided on request.
  Before a public release, confirm this "offer + source location" wording is enough
  for the chosen distribution channel.
- **`caniuse-lite` (CC-BY-4.0).** Build-time browser data only (browserslist), not
  distributed. Attribution is satisfied by the locked package and this record.
- **`argparse` (Python-2.0) and `truncate-utf8-bytes` (WTFPL).** Dev-only transitive
  tooling dependencies; permissive but on the review list.

## Repository content hygiene (privacy/copyright, separate from licensing)

M24.2 resolved the tracked-content blockers recorded by the M24.1 audit:

- `linkedin-diagnostic.txt` (345 KB of captured-observation diagnostics) was deleted;
  nothing referenced it.
- `tests/fixtures/` was reduced from 56 files / 8.2 MB to 56 files / ~1.6 MB. The two
  ~2.9 MB LinkedIn captures became 12 KB and 5 KB fixtures containing only the
  selected-vacancy structure; Indeed, France Travail, Randstad, Michael Page,
  Synergie and the other large captures were minimized in place and unneeded
  scripts/styles/chrome/prose removed.
- Real personal contact data was replaced with synthetic values: the account-holder
  address and account id in the Indeed capture, two named Manpower recruiters with
  direct addresses, and company mailboxes/switchboard numbers from Airbus, Actual and
  Synergie. Emails now use `example.test`; phone numbers use `01 00 00 00 00`.
- Tracking/session parameters were removed from fixture URLs and from the `.meta.json`
  sidecars, which now store a canonical provider URL with identity parameters only.
- `npm run check:fixtures` enforces the policy: size budget, reserved-domain emails,
  synthetic phones, tracking/session material, diagnostic dumps, tracked databases and
  high-confidence secrets. `tests/fixtures/README.md` documents the rules.

M24.3 rewrote the published history: the runtime databases, the diagnostic dump and
the unsanitized captures are no longer reachable from `main`, and the sanitized tree is
preserved. `npm run check:history` guards against reintroducing private database or
diagnostic paths, or oversized blobs, into reachable history. Old local clones, backup
bundles and forge caches may still contain the removed objects, so they must not be
pushed or published; GitHub caches/forks remain a separate residual consideration.

## Security audit

`npm audit --omit=dev` reports zero vulnerabilities. The full audit reports six
moderate `minimatch` findings through electron-builder's build-time chain with no
available fix; this is a build-tool finding, not a distributed-runtime finding, and
is recorded for follow-up rather than force-fixed.
