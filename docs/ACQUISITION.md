# Acquisition Boundary

## Purpose

M5.1 introduces the provider- and transport-neutral boundary through which future
browser captures, provider adapters, APIs, email imports, manual input, and file
imports hand obtained vacancy material to Job Nearby.

```text
external source
  → AcquisitionPackage
  → SourceObservation
  → extracted evidence
  → recognition
  → CanonicalVacancy
```

These are distinct concepts. An `AcquisitionPackage` is transient material obtained
by an external mechanism. A `SourceObservation` is Job Nearby's immutable capture
record. Extracted evidence and later recognition are interpretations. Acquisition
does not resolve employers, infer workplaces, identify duplicate vacancies, attach
canonical vacancies, or apply user-specific decisions.

## Package contract

An acquisition package contains a separate acquisition-event ID, acquisition time,
generic source type and name, optional observed URL/external ID/page title, content,
optional directly obtained structured fields, and extensible metadata.

Supported source types are `BROWSER`, `JOB_BOARD`, `EMPLOYER_WEBSITE`, `PUBLIC_API`,
`EMAIL`, `MANUAL`, `IMPORT`, and `OTHER`. Provider names such as Hellowork or Indeed
remain data in `sourceName`, not enum members.

Content can contain text, HTML, a structured payload, or a combination. At least one
usable representation is required. Structured fields are limited to directly
displayed title, company, location, salary, contract, contact, and publication time.
They carry no employer or workplace interpretation.

## Mapping to SourceObservation

`DeterministicAcquisitionCaptureMapper` applies this mapping:

| Acquisition | SourceObservation |
| --- | --- |
| caller-supplied observation ID | `id` |
| `acquiredAt` | `observedAt` |
| structured `publishedAt` | `publishedAt` |
| generic source type | closest existing `SourceType` |
| `sourceName`, URL, external ID | corresponding `SourceReference` values |
| directly obtained structured fields | corresponding displayed/raw fields |
| text, otherwise HTML, otherwise serialized payload | `rawContent` |

The acquisition ID, page title, and the complete acquisition metadata object are
retained under `metadata.acquisition`. HTML and structured payload are also retained
there when supplied, so choosing one `rawContent` representation does not silently
discard the others or overwrite an arbitrary provider metadata key. This mapping
does not duplicate those values into `SourceReference.providerMetadata`.

Validation rejects blank acquisition IDs and source names, unsupported generic
source types, invalid dates, blank-only content, and packages with no content
representation. Provider payload and metadata shapes remain intentionally open.
Dates, metadata, payloads, and output values are copied so later caller mutation
cannot alter the observation.

## Lifecycle and non-goals

Acquisition packages are transient in M5.1; only observations use the existing
durable capture boundary. Capturing the same provider vacancy repeatedly is valid
and produces separate observations when the caller supplies separate observation
IDs. Deduplication and vacancy identity remain downstream.

M5.1 adds no scraper, HTTP client, browser automation, provider selector, scheduler,
queue, acquisition persistence, evidence rule, recognition behavior, canonicalizer,
CRM behavior, or UI. Future acquisition mechanisms plug into this contract without
moving their provider logic into the capture or recognition domains.

## Generic Browser Capture

M5.2 provides one browser integration: a small unpacked Chrome/Chromium extension
in `browser-extension/` backed by a narrow local HTTP service. This is the smallest
maintainable option for a one-click active-page capture in the current repository;
it adds no provider selectors or general web API framework.

```text
browser extension
  → BrowserCapturePayload
  → POST http://127.0.0.1:4317/acquisition/browser
  → BrowserCaptureAcquisitionAdapter
  → AcquisitionPackage
  → DeterministicAcquisitionCaptureMapper
  → existing SqliteSourceObservationRepository
```

The extension reads `window.location.href`, `document.title`, and generic visible
text from `document.body.innerText`. It optionally includes the current
`document.documentElement.outerHTML`. Visible text receives only line-ending
normalization and surrounding-whitespace trimming. Page title remains acquisition
metadata; no title, employer, company, location, publication time, contract, or
external vacancy ID is inferred.

The adapter derives a conservative source name from the lower-case hostname,
removing a leading `www.` or generic two-letter locale subdomain. A URL without a
hostname uses `browser`. It always
uses acquisition source type `BROWSER`; it does not guess whether the site is a job
board or employer website.

Visible text is limited to 2 MiB and optional HTML to 5 MiB. The complete JSON
request is limited to 8 MiB. Oversized content is rejected with an error and is
never silently truncated. Text remains the M5.1 `rawContent`; optional HTML remains
preserved in acquisition metadata.

The service binds only to `127.0.0.1:4317`, accepts the single browser-capture path,
and grants CORS only to requesting Chrome/Firefox extension origins. It assumes a
local user and has no accounts or remote exposure. The extension requests only
`activeTab`, `scripting`, and access to that localhost endpoint—no history, cookies,
downloads, or browsing-data permissions.

Each request generates independent random acquisition and observation IDs. The URL,
text, or timestamp never becomes identity, and repeated captures of an unchanged
page are stored as separate immutable observations. A successful endpoint response
contains only success, acquisition ID, source-observation ID, and observation time.
The popup shows `Captured: <observation-id>` only after repository persistence;
otherwise it displays a failure message. No downstream pipeline is invoked.

### Installation and use

1. Run `npm install` if dependencies are not installed.
2. Start the local service with `npm run capture:server`. It creates or opens
   `job-nearby.sqlite` in the repository directory.
3. Open `chrome://extensions`, enable Developer mode, choose **Load unpacked**, and
   select the repository's `browser-extension` directory.
4. Open an ordinary vacancy page, select the Job Nearby extension, and click
   **Capture this page**.
5. Confirm that the popup displays `Captured` and the new observation ID.

For a manual verification, capture any normal public vacancy page, note the returned
ID, and inspect the matching `source_observations` row in `job-nearby.sqlite`. Its
source URL must equal the open page and `raw_content` must contain the visible
vacancy text. Capturing the page again should return another observation ID and add
another row.

Known limitations: restricted browser pages cannot be scripted, very large pages
are rejected, browser-rendered text may include navigation or cookie notices, and
the local service must already be running. These are deliberate generic-capture
tradeoffs; provider-specific refinement belongs in later adapters.

## Schema.org JobPosting acquisition

M5.3 enriches future browser captures from standards-based JSON-LD already present
in captured HTML. The application first locates literal
`<script type="application/ld+json">` elements, parses each independently, and then
detects `JobPosting` objects in direct documents, array roots, `@graph` roots, and
`@type` arrays. It never executes scripts, resolves remote contexts, or fetches
linked data. Malformed JSON-LD is skipped, so absence or failure cannot prevent the
ordinary visible-text and HTML capture path.

All detected JobPosting objects are retained unchanged under the acquisition
content's structured payload with format `SCHEMA_ORG_JOB_POSTING_JSON_LD`. M5.1 then
preserves that payload under `SourceObservation.metadata.acquisition`. If a page
contains multiple postings, all are retained and no winner is projected.

When exactly one posting exists, directly represented values may populate existing
acquisition structured fields:

- `title` becomes the displayed vacancy title;
- `hiringOrganization.name` becomes `displayedCompanyName` only;
- one simple `jobLocation` becomes readable location text without geocoding;
- a valid `datePosted` becomes `publishedAt`;
- string `employmentType` remains raw contract text;
- deterministic `baseSalary` values retain explicit amount/range, currency, and
  unit without conversion.

The browser's visible text remains primary `rawContent`; JSON-LD `description` does
not overwrite it. Unsupported, malformed, ambiguous, and multi-valued properties
remain only in the raw structured object.

`hiringOrganization` is source-published display data and is not a resolved
employer or recruiter classification. In real pages it often names an intermediary.
Likewise, `JobPosting.identifier` remains structured source data and never becomes
`SourceReference.externalId`; provider listing identity and recruiter references
can use different namespaces. No provider-specific hostname rule, DOM selector,
recognition behavior, or historical backfill is part of this enrichment.
