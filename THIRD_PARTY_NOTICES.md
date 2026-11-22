# Third-Party Notices

Job Nearby itself is licensed under the MIT License; the license text is installed as
`resources\LICENSE.txt` and is also in the source repository as `LICENSE`.
This file records the third-party software that Job Nearby distributes in its
Windows application and installer, and where each component's canonical license or
notice text is installed.

The inventory is generated from the audited dependency data in the source repository
(`docs/THIRD_PARTY_LICENSES.json`) and the curated component list in
`tools/licenseAudit.cjs`. Re-run `npm run audit:licenses:write` after changing
dependencies. Audit rules, acceptance policy and known residual obligations are
documented in the source repository at `docs/LICENSING.md`.

## Where these notices are installed

Windows builds (`Job-Nearby-Setup-<version>.exe` and `release/win-unpacked/`):

| Path (install directory) | Content |
| --- | --- |
| `resources\LICENSE.txt` | Job Nearby MIT license |
| `resources\THIRD_PARTY_NOTICES.md` | This file |
| `LICENSE.electron.txt` | Electron MIT license |
| `LICENSES.chromium.html` | Chromium third-party credits, including the Electron, Node.js, V8 and SQLite entries |
| `resources\app.asar` | Bundled npm runtime packages, each shipped with its own `LICENSE` file |

No installer license-acceptance page is shown. License text is installed as a
resource, not presented as an end-user agreement.

## Distributed components

| Component | Version | License | Notes |
| --- | --- | --- | --- |
| Electron | 42.11.18 | MIT | Application runtime; own notice file |
| Chromium | as bundled with Electron 42.11.18 | BSD-3-Clause and other third-party licenses | `LICENSES.chromium.html` |
| Node.js | as bundled with Electron 42.11.18 | MIT | Covered by `LICENSES.chromium.html` |
| SQLite | as bundled in better-sqlite3 | Public domain | Blessing text below |
| better-sqlite3 | 13.0.3 | MIT | Native SQLite binding |
| node-addon-api | 8.9.2 | MIT | better-sqlite3 build/runtime dependency shipped in the app |
| zod | 4.6.7 | MIT | Runtime validation |
| React | 19.2.8 | MIT | Bundled (minified) into the UI build |
| React DOM | 19.2.8 | MIT | Bundled (minified) into the UI build |
| scheduler | 0.27.0 | MIT | Bundled into the UI build through React DOM |
| NSIS | 3.0.4.1 | Zlib/libpng; LZMA module under CPL-1.0 with a linking exception | Installer runtime stub |
| nsis7z / 7-Zip extraction plugin | as bundled by electron-builder | LGPL-2.1-or-later | Embedded in the NSIS installer only |

## Electron — MIT

Copyright (c) Electron contributors<br>
Copyright (c) 2013-2020 GitHub Inc.

Electron is distributed under the MIT License. The complete license text is
installed as `LICENSE.electron.txt` in the installation directory and is not
reproduced here.

## Chromium, Node.js, V8 and the Chromium third-party set

Electron embeds Chromium and Node.js. Electron's distribution includes
`LICENSES.chromium.html`, the generated credits file for Chromium and its bundled
third-party projects. It contains the Node.js and SQLite license entries and the
hundreds of third-party licenses that apply to the V8/Chromium runtime. Job Nearby
installs that file unmodified at the application root and does not duplicate it.

## SQLite — public domain

SQLite is in the public domain. Its source files carry this blessing:

```text
The author disclaims copyright to this source code.  In place of
a legal notice, here is a blessing:

   May you do good and not evil.
   May you find forgiveness for yourself and forgive others.
   May you share freely, never taking more than you give.
```

## better-sqlite3 13.0.3 — MIT

Copyright (c) 2017 Joshua Wise

The package's `LICENSE` file is shipped inside `resources\app.asar` at
`node_modules\better-sqlite3\LICENSE`.

## node-addon-api 8.9.2 — MIT

Copyright (c) 2017 Node.js API collaborators

The package's `LICENSE.md` file is shipped inside `resources\app.asar` at
`node_modules\node-addon-api\LICENSE.md`.

## zod 4.6.7 — MIT

Copyright (c) 2025 Colin McDonnell

The package's `LICENSE` file is shipped inside `resources\app.asar` at
`node_modules\zod\LICENSE`.

## React 19.2.8, React DOM 19.2.8 and scheduler 0.27.0 — MIT

Copyright (c) Meta Platforms, Inc. and affiliates.

These packages are bundled, minified, into the UI build (`ui\dist`). The minifier
does not preserve their license headers, so their copyright and permission notice
is reproduced in the MIT appendix below.

## NSIS 3.0.4.1 — Zlib/libpng license (installer runtime)

Copyright (C) 1999-2018 Contributors

The NSIS installer stub is compiled into `Job-Nearby-Setup-<version>.exe`. Its
zlib/libpng license requires that the notice not be removed from source
distributions and that the origin of the software not be misrepresented; it does
not require an end-user acknowledgment.

```text
This software is provided 'as-is', without any express or implied warranty.
In no event will the authors be held liable for any damages arising from the
use of this software.

Permission is granted to anyone to use this software for any purpose,
including commercial applications, and to alter it and redistribute it
freely, subject to the following restrictions:

1. The origin of this software must not be misrepresented; you must not claim
   that you wrote the original software. If you use this software in a product,
   an acknowledgment in the product documentation would be appreciated but is
   not required.
2. Altered source versions must be plainly marked as such, and must not be
   misrepresented as being the original software.
3. This notice may not be removed or altered from any source distribution.
```

### NSIS LZMA compression module — CPL-1.0 with linking exception

The installer stub contains the LZMA decompression module from NSIS, which NSIS
licenses under the Common Public License version 1.0. NSIS grants this exception,
which is reproduced verbatim:

```text
SPECIAL EXCEPTION FOR LZMA COMPRESSION MODULE
---------------------------------------------

Igor Pavlov and Amir Szekely, the authors of the LZMA compression module for NSIS,
expressly permit you to statically or dynamically link your code (or bind by name)
to the files from the LZMA compression module for NSIS without subjecting your
linked code to the terms of the Common Public license version 1.0. Any
modifications or additions to files from the LZMA compression module for NSIS,
however, are subject to the terms of the Common Public License version 1.0.
```

Job Nearby does not modify the module. The module is unmodified third-party code
contained in the NSIS-generated installer stub; the exception keeps Job Nearby's own
code outside the CPL. The complete CPL-1.0 text and the NSIS `COPYING` file are
available from <https://nsis.sourceforge.io/> and on request.

## nsis7z / 7-Zip extraction plugin — LGPL-2.1-or-later

The NSIS installer stores the application as a 7-Zip archive and extracts it with
the `Nsis7z` plugin, which contains 7-Zip code. Copyright (C) 1999-2024 Igor Pavlov.
The plugin is used unmodified, as distributed with electron-builder's
`nsis-resources` package.

It is distributed under the GNU Lesser General Public License, version 2.1 or later.
The complete license text is available at
<https://www.gnu.org/licenses/old-licenses/lgpl-2.1.html>; the corresponding
unmodified source is available from the electron-builder project and
<https://www.7-zip.org/>, and can be provided on request. This notice is included so
recipients can identify the component and its license.

## MIT License (applies to Electron, better-sqlite3, node-addon-api, zod, React, React DOM and scheduler)

Copyright notices for the MIT-licensed components:

- Electron: Copyright (c) Electron contributors; Copyright (c) 2013-2020 GitHub Inc.
- better-sqlite3: Copyright (c) 2017 Joshua Wise
- node-addon-api: Copyright (c) 2017 Node.js API collaborators
- zod: Copyright (c) 2025 Colin McDonnell
- React, React DOM, scheduler: Copyright (c) Meta Platforms, Inc. and affiliates.

```text
Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Build-time tools (not distributed)

These tools build or test Job Nearby and are not present in the installed
application or installer. They are listed for repository-level license awareness.

| Tool | Version | License |
| --- | --- | --- |
| electron-builder | 26.18.1 | MIT |
| app-builder-lib | 26.18.1 | MIT |
| builder-util | 26.18.1 | MIT |
| @electron/rebuild | 4.2.1 | MIT |
| TypeScript | 7.0.2 | Apache-2.0 |
| Vite | 7.3.8 | MIT |
| Vitest | 4.1.12 | MIT |
| jsdom | 28.1.0 | MIT |
| 7za.exe (7-Zip command line) | as downloaded by electron-builder | LGPL-2.1-or-later |
| makensis (NSIS compiler) | 3.0.4.1 | Zlib/libpng |

## Not bundled

- No third-party fonts: the UI uses system fonts only.
- No third-party images, icons or logos: the package uses the packager's default
  icon; no custom Job Nearby icon exists yet.
- The browser extension is pure project code (no bundled library, external script
  or third-party asset) and is not included in the installer.
- No Python service, cloud SDK or analytics SDK is bundled.
