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
