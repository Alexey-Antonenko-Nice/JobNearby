# Canonical Vacancy

## Purpose and architectural position

`CanonicalVacancy` is Job Nearby's current, revisable, provider-independent,
evidence-backed interpretation of one recruitable role. It sits after acquisition,
evidence extraction, normalization, publication/vacancy identity, and employer
recognition, and before optional labor-market enrichment and private CRM behavior.

```text
External source → SourceObservation → evidence/recognition
                → CanonicalVacancy → optional enrichment → private CRM/read models
```

Observation, interpretation, and user action remain separate. A canonical vacancy
does not replace a source capture, an employer cluster, a publication or campaign,
a private job opportunity, or a UI card. Multiple immutable observations can support
one canonical vacancy, and the interpretation may be recalculated as evidence changes.

## Invariants

- **CV-INV-01:** canonicalization never replaces or mutates `SourceObservation`.
- **CV-INV-02:** every derived fact references supplied canonical evidence IDs.
- **CV-INV-03:** missing evidence produces `UNKNOWN`, never false-like defaults.
- **CV-INV-04:** incompatible evidence is retained as alternatives and conflicts.
- **CV-INV-05:** displayed companies and recruiters are not promoted to employer.
- **CV-INV-06:** publication language and working-language requirements are separate.
- **CV-INV-07:** work mode, work location, remote eligibility, and travel are separate.
- **CV-INV-08:** canonical vacancies contain no private CRM state.
- **CV-INV-09:** they contain no universal shortage-occupation Boolean.
- **CV-INV-10:** unresolved or absent employer identity is valid.
- **CV-INV-11:** optional enrichment is outside the boundary and cannot invalidate it.
- **CV-INV-12:** provider identifiers never become `CanonicalVacancyId`.

## Evidence references

M4.1 does not alter M3 evidence interfaces. Callers provide opaque
`CanonicalEvidenceReference` records with an application-generated ID, source
observation ID, and kind. Candidate fields and organization relationships store
those IDs. The canonicalizer validates that every used ID exists and traces to an
observation in the supplied observation set. IDs are not derived from array
positions or provider IDs; persistence is deliberately deferred.

## Canonical fields

Every canonical dimension uses `CanonicalField<T>`:

- `UNKNOWN`: no usable evidence, no value, and no alternatives.
- `RESOLVED`: all usable candidates represent one normalized value; supporting
  evidence is merged.
- `CONFLICTED`: incompatible values remain as evidence-backed alternatives; no
  source priority silently selects a winner.
- `AMBIGUOUS`: more than one interpretation is possible without direct conflict.
- `PARTIAL`: useful information exists but is incomplete.

The generic M4.1 resolver emits `UNKNOWN`, `RESOLVED`, or `CONFLICTED`.
`AMBIGUOUS` and `PARTIAL` remain valid for later specialized resolvers. Confidence,
when supplied, must remain in `[0,1]`; it is not employer-match confidence.

## Independent dimensions

Role, organization relationships, publication languages, work location, work mode,
remote-eligible countries, travel, engagement, compensation, experience, education,
skills, working-language requirements, functional context, industry context,
position count, and lifecycle remain independent. Unknown facts use field status
rather than invented values.

Organization roles are `DISPLAYED_COMPANY`, `EMPLOYER`, `RECRUITER`,
`STAFFING_AGENCY`, `CONSULTANCY`, `CLIENT`, `PROJECT_CUSTOMER`, and `UNKNOWN`.
Every relationship needs `organizationId`, `employerClusterId`, or `rawName`, plus
supporting evidence. An unresolved employer cluster is valid. These roles do not
rewrite M3 `OrganizationEvidenceRole` values.

## Canonicalization boundary

`CanonicalVacancyCanonicalizer.canonicalize()` is pure. The caller supplies the
Job Nearby vacancy ID, observations already believed to concern the role, evidence
references, normalized candidates, organization relationships, and derivation
metadata. The boundary does not fetch, scrape, group publications, run recognition,
enrich, inspect CRM, or persist.

Top-level status is `CONFLICTED` when any field conflicts, otherwise `USABLE` when
role is resolved, and otherwise `PARTIAL`. `USABLE` does not mean complete and does
not require resolved employer identity.

## Validation scenarios

- HEUFT: employer, CDI, base location, and extensive travel remain independent.
- Skayl and ADSEARCH: recruiters do not become employers; unresolved employer
  clusters remain valid.
- TE Connectivity: German publication language coexists with required English and
  preferred German working-language evidence.
- Oxigent: Spain and remote work do not invent remote-eligibility geography.
- Brightsmith: HYBRID/ON_SITE and CDD/freelance conflicts retain both alternatives.
- AbbVie: functional context remains separate from pharmaceutical industry context.
- Akkodis: consultancy and client relationships do not imply employer.
- Vulcain: on-site work and European travel coexist independently.

## Explicit separation and future work

Persistence, repositories, acquisition, adapters, richer resolvers, publication
grouping, enrichment, shortage analysis, CRM/application status, user notes, UI
cards, and AI-assisted processing are outside M4.1. Later adapters may translate
existing evidence and recognition results into normalized canonicalization input.

## Current Pipeline Adapter

M4.2 adds `ExistingPipelineCanonicalVacancyAdapter` in the application layer. The
caller supplies observations already believed to represent one vacancy, their
existing extracted-evidence aggregates, an optional employer cluster, a Job Nearby
canonical ID, and derivation metadata. The adapter builds M4.1 normalized candidates
and delegates resolution to the existing canonicalizer; it performs no grouping,
extraction, matching, persistence, enrichment, or CRM work.

Current mappings are deliberately narrow:

- source titles become role candidates;
- explicit employer, recruitment-agency, staffing-agency, publisher, and unknown
  organization evidence become conservative organization relationships;
- a supplied employer cluster adds a separate employer relationship, including
  when unresolved;
- workplace location is preferred, followed by employer location and then raw
  displayed location; recruiter locations and service territories are excluded;
- employer `INDUSTRY` characteristics become industry-context candidates;
- raw contract and salary fields are retained without term or numeric parsing.

Provider external IDs remain traceability evidence and never become canonical
vacancy identity. Publication language, work mode, remote eligibility, travel,
requirements, functional context, position count, and lifecycle remain `UNKNOWN`
because the current pipeline does not supply reliable normalized values for them.
Richer coverage requires future extraction/normalization work and must not be
invented inside this adapter.

Evidence-reference IDs are deterministic SHA-256 identifiers derived from source
observation ID, evidence kind, role/category qualifier, and normalized evidence
value. They are not array positions or persistent database IDs, and every reference
continues to trace to a supplied observation.

## Persistence and retrieval

M4.3 adds a domain-owned `CanonicalVacancyRepository` port with in-memory and
SQLite adapters. Saving replaces the current canonical projection atomically while
preserving the canonical vacancy ID. It never rewrites the immutable source
observations from which that projection was derived. Projection history and
algorithm-run history remain future work.

SQLite stores fields, alternatives, organization relationships, observation
membership, and evidence associations as structured rows. JSON is limited to the
polymorphic values of canonical fields and alternatives. Closed status, field-name,
and organization-role sets are enforced at the storage boundary, and retrieval
revalidates the complete aggregate before returning it.

The repository can also resolve or atomically claim a canonical vacancy from an
exact provider publication identity: the shared normalized provider namespace plus
the exact, case-sensitive external ID. Durable claims and membership constraints
make concurrent processors converge on one internal canonical ID. Publication/
vacancy identity remains distinct from employer identity.

## Observation processing orchestrator

M5.6.3b adds an application operation that begins with a persisted
`SourceObservationId`, claims canonical identity, reconstructs the complete
observation history, reruns evidence extraction for every member, processes
employer recognition for the requested observation, resolves at most one effective
employer cluster across the history, and replaces the complete canonical
projection. A review-required employer does not block canonicalization and its
candidate cluster is not promoted to effective membership.

Retries reuse durable identity and employer state. A claim may survive a failed
attempt before the first projection, so creation versus update is determined from
the stored projection rather than claim outcome. Extracted evidence is recomputed,
not persisted, and the derivation recipe version records the current processing
recipe rather than historical evidence versions. Selected Vacancy Context remains
preserved acquisition metadata and is not yet substituted for observation text.
Browser capture does not invoke this operation automatically yet.

Identity claims make concurrent attempts converge on one canonical ID, but they do
not serialize complete projection rebuilds. Two workers that both observe no first
projection can each rebuild from its own observation and the later replace-save can
overwrite the earlier membership. Capture-server wiring must therefore remain
disabled until processing is serialized per canonical ID or guarded by an
optimistic projection revision/retry mechanism.

Canonical vacancies remain public labor-market interpretations. CRM state, user
notes, applications, and universal shortage flags do not belong in this repository.
