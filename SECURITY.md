# Security policy

Job Nearby is a local-first desktop application for Windows. This policy covers the
application, its local storage, the packaged desktop runtime and the optional browser
extension in this repository.

The project is pre-release. Security reports are welcome and will be handled on a
best-effort basis; no response-time guarantee is offered.

## Supported versions

- The latest commit on `main` and the latest published installer are the supported
  code lines.
- Older development snapshots and historical builds are not supported.
- There are no maintained release branches yet.

## Reporting a vulnerability

**Preferred route:** GitHub private vulnerability reporting — open the repository's
**Security** tab and choose **Report a vulnerability**. This keeps the report private
until a fix is available. The maintainer must enable private vulnerability reporting
in the repository settings for this button to work; if it is not available, use the
fallback below.

**Fallback:** open a minimal GitHub issue that asks for a private reporting channel.
Do not include exploit details, proof-of-concept code, credentials or personal data in
that issue.

Do not open a public issue with an exploitable vulnerability, and do not publish it
elsewhere before a fix has been prepared and coordinated.

## What to include

- Affected version, commit or installer filename.
- Windows version and, where relevant, browser/extension version.
- A concise reproduction using synthetic data.
- The impact you observed or expect (confidentiality, integrity, availability).
- Whether the attack requires local access, a malicious web page, a malicious
  backup/document, or interaction by the user.
- Whether private data might be exposed, without including the data itself.

## What qualifies as a security issue

Examples:

- arbitrary code execution, command execution or unsafe file opening;
- path traversal, archive escape ("ZIP slip"), or writing outside intended storage;
- unauthorized access to the local API that leads to meaningful impact (private data
  disclosure, destructive restore/deletion, or CRM mutation);
- unsafe handling of restore archives or imported documents;
- extension privilege misuse or capture of content outside the active tab;
- exposure of local private data through the application or its packaging;
- a shipped dependency vulnerability with realistic impact on the packaged app.

## Not security reports

Functional bugs, extraction/recognition mistakes, UI defects and feature requests
belong in ordinary GitHub issues. Do not use the private channel for those.

## Privacy in reports

Never attach your `job-nearby.sqlite`, backups, exports, managed document files, CVs,
motivation letters or real vacancy/contact data to a public issue, and avoid them in
private reports unless strictly necessary. Reproduce with synthetic or minimized data.
Redact local usernames, paths, employer/recruiter details and personal contact data from
logs and screenshots.

## Known limitations

The application is pre-release. Current privacy and security limitations — including
plaintext local storage and the lack of caller authentication on loopback HTTP
interfaces — are documented in [Privacy and data handling](docs/PRIVACY.md) and the
[Security model](docs/SECURITY_MODEL.md). The loopback authorization gap is tracked as
a release-blocking hardening item.

The Windows installer is currently unsigned. A SmartScreen warning on installation is
expected and is not a product vulnerability; do not report it as one.

## Dependency status

Release checks run `npm audit --omit=dev` against the locked production dependency set.
A clean result at a point in time is not a permanent guarantee; dependency advisories
change over time.

## Disclosure

Please give maintainers a reasonable opportunity to investigate and fix the issue
before public disclosure. The project will credit reporters when they wish to be
credited, but does not operate a paid bug-bounty program.
