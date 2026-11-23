# Job Nearby — Architecture

**Version:** 0.2 (M18.1 CRM alignment)
**Status:** Working Draft
**Project:** Job Nearby
**Related documents:** `PRODUCT_SPECIFICATION.md`, `RECOGNITION_MODEL.md`, `DATA_MODEL.md`

## 1. Purpose

This document defines the modular architecture for the local desktop CRM. Earlier
recognition-design sections remain conceptual guidance; sections 67-68, 90-91 and
104 describe the current runtime, delivery gaps and governing CRM roadmap.

The architecture must support the product principles already established:

* opportunity-centered private CRM with reusable employer context;
* multi-source vacancy ingestion;
* immutable source observations;
* revisable recognition inference;
* unresolved employer clusters;
* probabilistic employer identification;
* provenance and explanation;
* separation of labor-market evidence from private user history;
* open-source extensibility.

The first implementation should be deliberately simple enough for rapid development while preserving the boundaries needed for future growth.

The architecture should avoid both extremes:

* a monolithic application where source capture, recognition, storage, UI, and external research are tightly coupled;
* premature microservices or distributed infrastructure that add complexity before the product has proven its core recognition loop.

The recommended initial architecture is therefore a **modular TypeScript monolith with explicit domain boundaries**.

The public-market `vacancies` domain contains the provider-independent,
evidence-backed `CanonicalVacancy` interpretation. Its pure application boundary
sits after publication/employer recognition and before optional labor-market
enrichment and private user-history/CRM concerns. It does not own capture,
recognition, persistence, or user action state. See `CANONICAL_VACANCY.md`.

---

# 2. Primary Architectural Goal

The existing capture/recognition slice supports this workflow; the CRM roadmap in section 91 builds private opportunity management on top:

```text
User encounters vacancy
        ↓
Capture/import publication
        ↓
Store immutable observation
        ↓
Preserve displayed company and other source evidence
        ↓
Run publication and employer recognition
        ↓
Find/create employer-cluster membership and assess identity
        ↓
Assess organization roles from vacancy evidence
        ↓
Build a shared, read-only Inbox/Review presentation
        ↓
Reviewer may make a separate identity-linkage or vacancy-role decision
        ↓
Persist only the explicit decision at its own scope
```

This supported capture/recognition loop is a foundation for the broader CRM lifecycle, not the whole product. Application tracking must work even when employer identity remains unresolved.

Recognition, identity linkage, cluster membership, and a vacancy-specific
organization-role decision are separate operations. Recognition or prior employer
knowledge must not silently write a role decision, and a role decision for one
vacancy must not transfer to another.

---

# 3. Architectural Style

The initial architecture should use:

> **Modular monolith + ports/adapters + domain-oriented modules**

Conceptually:

```text
                USER INTERFACES
                      │
        ┌─────────────┴─────────────┐
        │                           │
     Web App                  Browser Capture
        │                           │
        └─────────────┬─────────────┘
                      ↓
               Application Layer
                      ↓
     ┌───────────────────────────────────┐
     │            Domain Core            │
     │                                   │
     │ Capture                           │
     │ Recognition                       │
     │ Vacancies                         │
     │ Employers                         │
     │ Recruitment                       │
     │ User History                      │
     └───────────────────────────────────┘
                      ↓
              Ports / Interfaces
                      ↓
     ┌───────────────────────────────────┐
     │            Adapters               │
     │                                   │
     │ Database                          │
     │ Source adapters                   │
     │ Geocoding                         │
     │ Company registers                 │
     │ Search / research                 │
     │ Future AI providers               │
     └───────────────────────────────────┘
```

The core domain must not depend directly on particular job boards, databases, AI providers, or external APIs.

---

# 4. Why a Modular Monolith

A modular monolith is preferred initially because Job Nearby does not yet require:

* independent deployment of services;
* very high transaction volume;
* complex distributed processing;
* multiple engineering teams;
* service-level scaling;
* event streaming infrastructure.

A single deployable application makes it easier to:

* understand the code;
* refactor rapidly;
* run locally;
* test end-to-end;
* contribute as an open-source developer;
* avoid network boundaries between immature modules.

However, modules should communicate through explicit interfaces so that components can later be separated if necessary.

---

# 5. Initial Technology Direction

The recommended initial stack is:

```text
Language:
TypeScript

Frontend:
React

Application tooling:
Vite

Backend:
Node.js + TypeScript

Database:
SQLite initially

ORM/query layer:
lightweight, migration-capable library

Testing:
Vitest

Validation:
runtime schema validation

Repository:
GitHub
```

React + TypeScript is a practical choice because it is already suitable for the intended web interface and supports sharing TypeScript domain types where appropriate.

The architecture should not assume that the frontend and backend remain one process forever.

---

# 6. Why SQLite Initially

SQLite is recommended for the first version because Job Nearby initially behaves strongly like a personal knowledge tool.

Advantages:

* no database server required;
* easy local development;
* portable database file;
* simple backup;
* excellent relational capabilities;
* transactional;
* capable of handling far more observations than an individual job seeker initially requires;
* repository boundaries that leave alternative storage possible, without requiring a server database.

The data model is relational enough that a relational database is preferable to a document database.

Examples include:

```text
observations
assignments
clusters
candidates
resolutions
publication-family membership
user interactions
```

These relationships benefit from relational integrity.

---

# 7. Future PostgreSQL Compatibility

The architecture should avoid SQLite-specific assumptions that would make migration difficult.

The persistence boundary should therefore use repositories or query services rather than spreading SQL throughout domain logic.

Conceptually:

```ts
interface EmployerClusterRepository {
  findById(id: EmployerClusterId): Promise<EmployerCluster | null>;
  save(cluster: EmployerCluster): Promise<void>;
}
```

The implementation may initially be:

```text
SQLiteEmployerClusterRepository
```

and later:

```text
PostgresEmployerClusterRepository
```

without changing recognition logic.

---

# 8. Local desktop product and local backend

The intended distribution is an installable, free desktop CRM for many independent
users, with a private local data store per user/machine/profile. The current developer
runtime is React in a browser, a local Node HTTP API, and SQLite. No central Job Nearby
service is required for private CRM use. Provider capture requires access to the
source website, but viewing local history must not depend on that website.

A desktop shell/runtime strategy has not been selected. The installer must bundle
or install all needed components; ordinary users must not clone Git, install Node
or Python, run npm, or configure a development database. Hosted deployment or
optional synchronization remains a separate future decision, not an initial SaaS
assumption. See section 68 for packaging gaps.

---

# 9. Privacy Boundary

Job Nearby contains two different data domains:

```text
MARKET EVIDENCE (NOT AUTOMATICALLY SHAREABLE)
vacancy observations
company information
recognition evidence
public recruitment history

PRIVATE USER DATA
applications
notes
contact history
interviews
personal decisions
```

The architecture must keep them logically separate.

The first local implementation may store both in the same SQLite database, but separate tables/modules should preserve the boundary.

Future synchronization must not assume that private user history can be uploaded with shared labor-market evidence.

---

# 10. Main Modules

The initial domain/application modules should be:

```text
acquisition
capture
recognition
employers
publications
recruitment
user-history
sources
research
shared
```

Not all modules require full implementation immediately.

---

# 11. Capture Module

Responsibility:

> Convert incoming vacancy material into preserved source observations.

The upstream acquisition module defines the transient, transport-neutral
`AcquisitionPackage`. A pure mapper converts that package into the capture domain's
immutable `SourceObservation`; evidence extraction and interpretation remain
downstream. See `ACQUISITION.md`.

Inputs may eventually include:

```text
manual paste
URL submission
browser extension
email import
API response
structured file
```

The capture module should not perform employer resolution itself.

Conceptually:

```text
External mechanism
      ↓
AcquisitionPackage
      ↓
Acquisition boundary
      ↓
SourceObservation
      ↓
Persistence
      ↓
Recognition trigger
```

---

# 12. Capture Command

A useful application command may be conceptually:

```ts
captureObservation(input)
```

It should:

1. validate incoming source information;
2. determine source type;
3. preserve capture timestamp;
4. persist the immutable observation;
5. enqueue or invoke recognition;
6. return the stored observation ID.

It must not require successful recognition before the observation is saved.

---

# 13. Source Adapter Architecture

Each external source should use an adapter.

Conceptually:

```ts
interface SourceAdapter {
  canHandle(input: CaptureInput): boolean;

  extract(input: CaptureInput): Promise<SourceObservationDraft>;
}
```

Examples:

```text
MeteojobAdapter
IndeedAdapter
JoobleAdapter
FranceTravailAdapter
GenericWebPageAdapter
ManualTextAdapter
```

Provider-specific parsing stays inside adapters.

---

# 14. Generic Capture Must Always Exist

Job Nearby must not become unusable when a dedicated adapter is unavailable.

Therefore a generic manual capture path is mandatory.

Example:

```text
Paste vacancy text
+
optional URL
+
optional company
+
optional location
```

This allows the recognition engine to operate before source-specific automation exists.

---

# 15. Browser Extension Architecture

A browser extension is a likely high-value capture interface, but it should remain a separate client of the Job Nearby API.

Conceptually:

```text
Job board page
      ↓
Browser Extension
      ↓
Job Nearby Local API
      ↓
Capture Module
```

The extension should not contain recognition logic.

Its responsibilities are limited to:

* capture visible page information;
* identify source URL;
* possibly run source-specific extraction;
* submit observation data.

Recognition belongs in the main application.

---

# 16. Browser Extension MVP

The extension itself should not be required for the first recognition prototype.

Initial development can use:

```text
manual paste
or
simple web form
```

Once the recognition loop works, the browser extension can substantially improve workflow efficiency.

---

# 17. Publications Module

The publications module handles relationships between source observations.

Responsibilities include:

```text
publication identity
publication-family matching
cross-source duplicate analysis
publication history
```

It must not determine employer identity directly.

---

# 18. Recognition Module

The recognition module is a supporting and differentiating capability of the CRM.

Responsibilities:

```text
extract recognition features
build fingerprints
compare employer clusters
rank employer candidates
generate identity resolutions
produce explanations
trigger re-evaluation
```

It should be divided internally into smaller services.

This module may produce recognition and identity-linkage evidence. The
human-authored organization-role decision for one vacancy belongs to the user
application boundary and is not a recognition result.

---

# 19. Recognition Services

Recommended initial service decomposition:

```text
EvidenceExtractionService
NormalizationService
PublicationMatchingService
EmployerFingerprintService
EmployerClusterMatchingService
EmployerIdentityResolutionService
RecognitionExplanationService
RecognitionOrchestrator
```

Later:

```text
RecruitmentCampaignMatchingService
ExternalResearchService
AIRecognitionService
```

---

# 20. Recognition Orchestrator

The orchestrator coordinates recognition without containing the detailed algorithms itself.

Conceptually:

```text
RecognitionOrchestrator
        │
        ├── publication matcher
        ├── fingerprint builder
        ├── cluster matcher
        ├── identity resolver
        └── explanation builder
```

A useful conceptual API:

```ts
recognizeObservation(
  observationId: SourceObservationId
): Promise<RecognitionResult>
```

---

# 21. Recognition Algorithm Interfaces

Recognition algorithms should be replaceable.

For example:

```ts
interface EmployerClusterMatcher {
  match(
    observation: SourceObservation,
    candidates: EmployerCluster[]
  ): Promise<ClusterMatchResult[]>;
}
```

A first implementation may be:

```text
DeterministicEmployerClusterMatcher
```

Later:

```text
WeightedFingerprintMatcher
SemanticEmployerClusterMatcher
HybridEmployerClusterMatcher
```

The orchestrator should not care which implementation is active.

---

# 22. Recognition Configuration

Thresholds and feature weights should not be scattered as magic numbers.

Use configuration such as:

```text
recognition/
  recognitionConfig.ts
```

Conceptually:

```ts
{
  automaticClusterAssignmentThreshold: 0.9,
  candidateDisplayThreshold: 0.5,
  automaticIdentityResolutionThreshold: 0.95,
  automaticMergeThreshold: 0.98
}
```

These values are illustrative, not final.

They should be adjusted using test corpus results.

---

# 23. Recognition Explanations

Every important recognition service should return structured reasoning evidence alongside scores.

Avoid:

```ts
return 0.91;
```

Prefer conceptually:

```ts
return {
  confidence: 0.91,
  supportingEvidence: [...],
  contradictoryEvidence: [...],
  algorithm: "...",
  algorithmVersion: "..."
};
```

This enables:

* debugging;
* user explanation;
* tests;
* comparison of algorithm versions.

---

# 24. Employers Module

Responsibilities:

```text
Employer
EmployerLocation
EmployerAliasEvidence
EmployerIdentifier
Recruiter
RecruitmentContact
ContactPoint
```

This module represents real-world organizational identities once known.

It should not own raw source observations.

Alias evidence belongs to organization identity/recognition. It may help associate
an observed name with a cluster or identity, but it does not decide the
organization's role for a vacancy.

---

# 25. Employer Registry

The employers module acts as Job Nearby's accumulated known-employer registry.

Recognition can query it for:

```text
aliases
known locations
official identifiers
domains
websites
```

User corrections can enrich this registry over time.

Only identity-level corrections belong here. A vacancy's organization role is
decided separately and must not be inferred from registry membership.

---

# 26. Recruitment Module

This module represents inferred hiring activity.

Responsibilities eventually include:

```text
RecruitmentCampaign
campaign membership
position count
campaign status
recurring demand
hiring history
```

For MVP v1, this module can remain minimal.

The architecture should nonetheless keep campaign inference separate from publication matching.

---

# 27. User History Module

Responsibilities:

```text
user/employer interactions
application history
notes
follow-up events
current interaction projection
```

It must not participate in employer recognition scoring.

For example:

> "I applied to this company before"

does not constitute evidence that two publications belong to the same employer.

It is user history, not recognition evidence.

The user application boundary also owns vacancy-specific human
`VacancyOrganizationRoleDecision` records. These are separate from private
application/interview history and from organization identity/alias decisions.

---

# 28. Research Module

Some employer identities require external investigation.

The research module provides ports such as:

```ts
interface CompanyRegistryProvider
interface SearchProvider
interface GeocodingProvider
interface CompanyWebsiteProvider
interface OccupationProvider
```

Concrete adapters may include:

```text
SireneProvider
GeocodingProvider
FranceTravailProvider
WebSearchProvider
```

The recognition module consumes normalized evidence from these providers.

---

# 29. Research Must Not Mutate Domain Directly

An external provider should not do this:

```text
cluster.resolvedEmployer = result.company;
```

Instead:

```text
Research Provider
      ↓
Research Evidence
      ↓
Recognition
      ↓
IdentityResolution
```

This keeps source retrieval separate from inference.

---

# 30. AI Provider Boundary

If AI is added later, it should be behind a port.

Conceptually:

```ts
interface SemanticEvidenceProvider {
  extractFeatures(text: string): Promise<ExtractedFeature[]>;
}
```

or:

```ts
interface EmployerResearchAssistant {
  proposeCandidates(input): Promise<EmployerCandidateProposal[]>;
}
```

The domain must not depend on a particular model vendor.

---

# 31. No AI Requirement for Core Functionality

The application must remain useful without AI services.

Initial recognition should rely on:

```text
exact identifiers
normalized names
aliases
locations
recruiter references
structured features
text similarity
deterministic scoring
human confirmation
```

AI can later improve extraction and investigation, but it is not the architecture foundation.

---

# 32. Application Layer

The application layer coordinates use cases.

Potential use cases:

```text
CaptureVacancy
RecognizeObservation
ReviewRecognition
DecideEmployerIdentityLink
DecideVacancyOrganizationRole
RejectEmployerCandidate
RecordEmployerInteraction
SearchKnownEmployers
ViewEmployerProfile
```

Use cases should orchestrate domain services and repositories.

They should not contain provider-specific parsing.

---

# 33. API Boundary

Even if frontend and backend initially live in one repository, the web UI should interact through a clear API boundary.

Possible initial API style:

```text
REST/JSON
```

This is simpler than GraphQL for the initial product.

Potential endpoints:

```text
POST   /api/observations
GET    /api/observations/:id

POST   /api/observations/:id/recognize

GET    /api/employer-clusters
GET    /api/employer-clusters/:id

POST   /api/vacancies/:id/employer-identity-decisions
POST   /api/vacancies/:id/organization-role-decisions

GET    /api/employer-clusters/:id/interactions
POST   /api/employer-clusters/:id/interactions
```

Identity-linkage and organization-role routes have different decision semantics.
Neither route may be replaced by a presentation update; organization-role
decisions are scoped to one vacancy.

---

# 34. Frontend Architecture

The frontend should remain domain-oriented.

Potential feature areas:

```text
capture
recognition-review
employer-list
employer-profile
user-history
settings
```

Avoid a component tree organized solely around generic UI components.

Shared generic components can live separately.

---

# 35. Current UI and CRM direction

The implemented React UI has Inbox and Review, explicit interaction actions,
organization-role and identity review, employer/vacancy history context and guarded
archive/restore/deletion. It is not a completed CRM dashboard or document/contact
manager. Future opportunity views compose canonical facts with private application,
document, contact, task and activity records. Employer views remain useful across
opportunities. Opening a view stays read-only. See the product specification for
daily work-queue and combined search requirements; no final layout is decided here.

---

# 36. Data Access Layer

Persistence should be encapsulated behind repositories.

Potential repositories:

```text
SourceObservationRepository
EmployerClusterRepository
EmployerRepository
EmployerCandidateRepository
IdentityResolutionRepository
PublicationFamilyRepository
UserInteractionRepository
```

Repositories should expose domain-relevant operations rather than generic database access where practical.

---

# 37. Transaction Boundaries

Operations affecting several related records should use transactions.

Identity-linkage changes and vacancy-role decisions have separate transaction
boundaries. For example, an identity-linkage decision may update the
observation-to-cluster assignment and alias evidence; it does not create a
vacancy-role decision. A role decision records the organization and role for one
canonical vacancy and updates only the related vacancy assignments.

Neither transaction may convert a read-model/presentation state into a decision.

---

### Identity-linkage transaction

Example:

```text
reviewer links an observed organization to a known identity
        ↓
record identity assignment/history
possibly add identity alias evidence
do not create a vacancy-role decision
```

### Vacancy-role decision transaction

```text
reviewer selects an organization role for one vacancy
        ↓
append VacancyOrganizationRoleDecision
record prior-decision relationship and evidence basis
update related assignment projection transactionally
do not change decisions for other vacancies
```

These should succeed or fail atomically.

---

# 38. Database Migrations

Schema changes must use versioned migrations from the beginning.

Never rely on developers manually modifying their local SQLite databases.

The repository should support:

```text
create database
apply migrations
reset development database
```

A migration strategy becomes especially important once contributors begin working with different branches.

---

# 39. Event-Like History Without Event Sourcing

Job Nearby benefits from historical records, but full event sourcing is unnecessary initially.

Use ordinary relational tables for immutable historical facts such as:

```text
observations
confirmations
identity resolutions
user interactions
```

Current projections may be derived or cached.

This provides most of the benefits without the complexity of full event-sourced architecture.

---

# 40. Reprocessing Architecture

Recognition algorithms will improve.

The system must therefore support:

```text
existing observation
        ↓
run newer recognition algorithm
        ↓
new recognition evaluation
        ↓
preserve previous evaluation
```

Do not permanently embed recognition results into immutable observations.

---

# 41. Reprocessing Scope

Potential reprocessing operations:

```text
re-recognize one observation
re-recognize one employer cluster
rebuild fingerprint
recompute publication families
recompute all unresolved clusters
```

For early development these operations can be synchronous commands.

Background jobs are not required initially.

---

# 42. Background Processing

Later, larger datasets may require asynchronous processing for:

```text
external company research
large-scale reprocessing
full-text similarity
geocoding
historical import
```

The architecture should allow this later, but an initial job queue is unnecessary.

A future abstraction may be:

```ts
interface TaskQueue {
  enqueue(task: RecognitionTask): Promise<void>;
}
```

For MVP:

```text
InlineTaskQueue
```

Later:

```text
PersistentTaskQueue
```

---

# 43. Search Architecture

Employer search should initially use relational queries plus normalized fields.

Examples:

```text
normalized employer name
alias
city
postal code
recruiter
occupation
```

Full-text search may be added once descriptions and evidence volumes justify it.

SQLite FTS can be considered before introducing a separate search engine.

---

# 44. Text Similarity

Initial publication matching should avoid unnecessary infrastructure.

Possible progression:

```text
v0
exact normalized text/hash comparisons

v1
token similarity / n-grams

v2
TF-IDF or other local semantic similarity

v3
embeddings if justified
```

The architecture should expose text similarity through an interface rather than binding recognition directly to one technique.

---

# 45. Text Similarity Port

Conceptually:

```ts
interface TextSimilarityService {
  compare(a: string, b: string): Promise<number>;
}
```

Initial implementation:

```text
LocalTextSimilarityService
```

Future implementation:

```text
EmbeddingTextSimilarityService
```

---

# 46. Source-Specific Legal Boundaries

Source adapters must be isolated partly because data acquisition rules differ by provider.

The architecture must distinguish:

```text
capture for personal use
API reuse
automated retrieval
redistribution
historical storage
```

These are legal/product-policy concerns rather than recognition concerns.

Each source adapter should eventually document its permitted acquisition mode.

---

# 47. Source Capability Metadata

A source configuration may eventually include:

```text
supportsApi
supportsManualCapture
supportsBrowserCapture
allowsHistoricalStorage
allowsRedistribution
requiresAuthentication
```

This helps keep source-specific constraints outside the domain core.

---

# 48. Open-Source Extension Points

The project should make it easy for contributors to add:

```text
new source adapters
new company registry providers
new occupation providers
new recognition algorithms
new text similarity implementations
new geocoding providers
```

Each should implement documented interfaces and provide tests.

---

# 49. Plugin Architecture — Not Yet

A runtime plugin system is not required initially.

Open-source extensibility can be achieved simply through TypeScript interfaces and separate modules.

Do not introduce:

```text
dynamic plugin loading
plugin marketplaces
runtime package discovery
```

until actual contributor needs justify them.

---

# 50. Suggested Repository Structure

A practical initial repository could look like:

```text
JobNearby/
│
├── docs/
│   ├── PRODUCT_SPECIFICATION.md
│   ├── RECOGNITION_MODEL.md
│   ├── DATA_MODEL.md
│   └── ARCHITECTURE.md
│
├── src/
│   ├── domain/
│   │   ├── capture/
│   │   ├── recognition/
│   │   ├── employers/
│   │   ├── publications/
│   │   ├── recruitment/
│   │   └── user-history/
│   │
│   ├── application/
│   │
│   ├── infrastructure/
│   │   ├── database/
│   │   ├── sources/
│   │   ├── research/
│   │   └── similarity/
│   │
│   ├── api/
│   │
│   └── ui/
│
├── tests/
│   ├── fixtures/
│   ├── recognition/
│   └── integration/
│
├── package.json
├── tsconfig.json
└── README.md
```

This is a starting point, not an immutable rule.

---

# 51. Alternative Frontend Separation

If Vite/React structure becomes cleaner with a conventional frontend directory, the repository may instead use:

```text
src/
  client/
  server/
  domain/
  application/
  infrastructure/
```

The important boundary is architectural, not the exact folder names.

---

# 52. Single Repository

Job Nearby should initially use one GitHub repository.

A monorepo framework is unnecessary.

If the browser extension becomes substantial later, the repository may evolve toward:

```text
apps/
  web/
  browser-extension/

packages/
  domain/
  recognition/
  shared/
```

But this should happen only when there is a concrete need.

---

# 53. Dependency Direction

The most important code rule is dependency direction.

Conceptually:

```text
UI
 ↓
Application
 ↓
Domain

Infrastructure
 ↓
Domain interfaces
```

The domain must not import:

```text
React
database client
Indeed parser
OpenAI SDK
France Travail SDK
browser APIs
```

Infrastructure depends on domain abstractions, not the reverse.

---

# 54. Domain Purity

Domain entities and core recognition logic should preferably be ordinary TypeScript.

Example:

```text
no React hooks
no HTTP request objects
no database row types
no environment variables
```

This makes domain tests fast and recognition algorithms portable.

---

# 55. Runtime Validation

TypeScript types do not validate external data at runtime.

All data crossing external boundaries should be validated.

Examples:

```text
browser capture payload
source API response
REST request
database migration import
external research response
```

Use runtime schemas at those boundaries.

---

# 56. Error Model

Errors should distinguish:

```text
validation failure
source unavailable
source parsing failure
recognition unresolved
external research failure
database failure
```

An unresolved employer is **not an error**.

This distinction is important.

For example:

```text
identityStatus = UNRESOLVED
```

is a valid domain outcome.

---

# 57. Logging

Structured logs should eventually capture:

```text
capture event
adapter used
recognition algorithm
recognition outcome
external provider failure
manual correction
```

Logs must not unnecessarily expose private user notes or sensitive contact information.

---

# 58. Testing Strategy

Testing should be built from the start around the recognition corpus.

Three layers are recommended.

### Unit Tests

Pure domain/algorithm tests.

Examples:

```text
name normalization
location comparison
confidence aggregation
candidate ranking
```

### Recognition Scenario Tests

End-to-end domain tests using fixture observations.

Examples:

```text
Blue Paper-like fingerprint
anonymous Brumath employer
recruiter versus employer
cross-source duplicate
```

### Integration Tests

Database and adapter boundaries.

Examples:

```text
observation persistence
cluster assignment persistence
confirmation history
migration correctness
```

---

# 59. Test Corpus

The recognition test corpus should contain structured/synthetic scenarios based on real situations.

Example fixture:

```text
anonymous-paper-company-strasbourg.json
```

rather than copying complete protected vacancy pages.

Fixtures should contain only the information necessary to exercise recognition behavior.

---

# 60. Golden Recognition Tests

Some scenarios should have expected outputs.

Example:

```text
Input:
three observations

Expected:
same employer cluster = true
employer identity = unresolved
publication family A/B = same
publication C = different family
```

These tests will protect the project from algorithm regressions.

---

# 61. Recognition Metrics in Tests

Tests should not only check exact scores.

Prefer behavior-based assertions:

```text
candidate A ranks above candidate B
confidence exceeds assignment threshold
conflicting evidence prevents automatic resolution
```

Exact floating-point confidence values may change as algorithms improve.

---

# 62. Development Seed Data

A small development database should be reproducible from fixtures.

Example command eventually:

```text
npm run db:seed
```

This lets contributors immediately explore:

```text
resolved employer
anonymous known employer
recruitment agency
duplicate publication family
user interaction history
```

without manually creating data.

---

# 63. API Tests

Application/API tests should verify use cases such as:

```text
capture vacancy
recognize it
confirm identity
retrieve employer profile
record application
```

These tests should use temporary databases.

---

# 64. Security

The local CRM holds sensitive career data. Local-only deployment still requires explicit security and privacy safeguards.

At minimum:

```text
validate all external input
sanitize rendered text
never execute captured HTML/scripts
protect local API from arbitrary remote access
avoid storing credentials in repository
use environment variables for API secrets
```

Captured HTML must be treated as untrusted input.

---

# 65. Authentication

Authentication is unnecessary for a purely local single-user MVP.

Do not build account infrastructure prematurely.

If Job Nearby later becomes hosted/multi-user, authentication can be introduced at the application boundary.

The domain should nonetheless use conceptual `userId` references where private history requires ownership.

For a local MVP, a fixed local user identity can satisfy this abstraction; no shared-user access-control model is implied.

---

# 66. Configuration

Configuration should separate:

```text
application settings
recognition thresholds
source credentials
provider endpoints
feature flags
```

Secrets must not be committed to Git.

A `.env.example` can document required environment variables.

---

# 67. Current runtime and distribution audit

M23.1 audit baseline: `d5732bea57f594c094dac32418c251a172f5c5ce`.

| Component | Observed implementation | Distribution consequence |
| --- | --- | --- |
| Desktop | Electron main process (`desktop/main.cjs`) owns the backend lifecycle and one window; the single-instance lock focuses the existing window | Windows x64 per-user NSIS installer and unpacked package are built by `npm run desktop:package` |
| API/UI | `startJobNearbyServer.ts` starts the API and serves `ui/dist` from one same-origin loopback server on an OS-assigned port | Vite is development-only; API and SPA routes are hosted together without a permanent UI/API port |
| Data | Desktop defaults to `%LOCALAPPDATA%/JobNearby/job-nearby.sqlite`; managed documents and Electron profile share the persistent app-data root | No cwd/install-resource writes and no automatic relocation of existing developer data; environment overrides remain available |
| Capture | The UI/API use the assigned port; a separate capture-only server reserves `127.0.0.1:4317` for the existing extension | Capture behavior and manifest permissions remain unchanged; a port conflict fails startup instead of misrouting extension writes |
| Native dependency | `better-sqlite3` is loaded in the Electron main process and rebuilt for Electron with `@electron/rebuild`; packaging keeps ASAR enabled and unpacks native `.node` files | Build machines require the native build prerequisites; the installed app carries its Electron-compatible SQLite binary |
| Shutdown | `JobNearbyServerRuntime.close()` closes HTTP listeners and SQLite; Electron awaits it before exiting | Backend runs in-process, so no child server can be orphaned |
| Development | Vite remains on `127.0.0.1:5173` and proxies API requests to the CLI server at `127.0.0.1:4317` | Existing browser development and extension flow remain available |

Provider-specific extraction runs in repository adapters against captured browser
material. The shipped browser path does not require a Python service, external
browser-automation service or central recognition API. Source access/authentication
still belongs to the user's browser, with provider restrictions and privacy guards.

The desktop shell derives built-artifact paths from its own file location rather
than cwd. The CLI's default database remains cwd-relative for development.
M23.2 qualifies Windows x64 packaging only; no other operating system or
architecture is claimed. Installer details and validation limits are recorded in
`docs/DESKTOP_DISTRIBUTION.md`.

---

# 68. Remaining desktop distribution and release gaps

M23.2 produces a Windows x64 distributable, but does not constitute a public release.
Remaining work includes:

1. Provide an in-app installation/configuration path for the optional browser extension.
2. Expand clean-machine and upgrade validation on disposable Windows environments.
3. Add a final application icon/branding and code signing; unsigned installers may trigger SmartScreen warnings.
4. ~~Select the project license and complete dependency/license and redistribution review.~~ Completed by M24.1: MIT project license, audited dependency inventory, third-party notices and verified packaged legal resources (see `docs/LICENSING.md`).
5. Add auto-update strategy, release automation, end-user install/upgrade documentation, and public release policy.

Backup/restore, schema migrations and managed document storage remain independent
application services and are not moved into packaged resources by this runtime.

---

# 69. Mobile Application — Deferred

Mobile support is not an initial architecture requirement.

A responsive web UI is sufficient.

Later, a mobile share target could become a valuable capture interface.

---

# 70. Email Integration — Deferred but Supported

Email alerts are an important real-world source.

Potential later flow:

```text
vacancy alert email
      ↓
email adapter
      ↓
extract multiple vacancy links/items
      ↓
SourceObservations
```

The architecture should allow this through the same capture interface.

No email-specific logic should enter recognition itself.

---

# 71. Geographic Services

Geocoding should be provided through a port.

Conceptually:

```ts
interface GeocodingProvider {
  geocode(query: AddressQuery): Promise<GeocodingCandidate[]>;
}
```

The domain stores resulting location evidence/provenance.

Recognition should not depend directly on one national geocoding API.

---

# 72. Company Registry Services

Likewise:

```ts
interface CompanyRegistryProvider {
  search(query: CompanySearchQuery): Promise<CompanyRegistryCandidate[]>;
}
```

France may initially use SIRENE.

Other countries can later provide different adapters.

---

# 73. Occupation Classification Services

Occupation normalization should use an interface.

Conceptually:

```ts
interface OccupationClassificationProvider {
  classify(input: OccupationInput): Promise<OccupationCandidate[]>;
}
```

ROME may be one implementation.

ESCO or other systems may be added later.

---

# 74. Search/Research Provider

Employer identification may require public web research.

Use a provider abstraction:

```ts
interface EmployerResearchProvider {
  research(
    fingerprint: EmployerFingerprint
  ): Promise<ResearchEvidence[]>;
}
```

This provider returns evidence, not final identity.

---

# 75. Current Projection Services

For UI performance, application services may produce read models such as:

```text
EmployerSummary
EmployerProfile
RecognitionReview
PublicationSummary
```

These are presentation-oriented projections.

They must not become authoritative domain entities.

Inbox and Review derive the same employer presentation from the same underlying
source evidence, recognition and identity relationships, prior employer knowledge,
and vacancy-specific role decisions. The presentation is read-only and creates or
mutates none of those records. It is not a persisted domain entity.

---

# 76. EmployerSummary Projection

Example:

```text
EmployerSummary

clusterId
displayName
identityStatus
primaryLocation
lastObservedAt
publicationCount
userStatus
```

This is ideal for lists and map views.

`identityStatus` must not stand in for the vacancy-specific organization role.

---

# 77. RecognitionReview Projection

Example:

```text
RecognitionReview

observation
displayedCompanyEvidence
clusterMatch
candidateEmployers
identityStatus
priorEmployerKnowledge
vacancyOrganizationRoleDecision?
supportingEvidence
contradictions
previousUserActions
```

This may become the central MVP screen.

It is a read projection: an automatically recognized identity or reused memory
does not become human-confirmed merely because it appears in the review.

---

# 78. Performance

Performance is not a major initial risk.

Likely early dataset:

```text
hundreds or thousands of observations
hundreds of employer clusters
```

SQLite and in-process recognition are sufficient.

The architecture should optimize first for correctness, auditability, and maintainability.

---

# 79. Avoid Premature Caching

Do not introduce Redis or distributed caches initially.

Simple in-memory caching may be added for repeated lookups if demonstrated necessary.

Persistent recognition results already provide a natural cache.

---

# 80. Versioning Recognition Logic

Every significant recognition algorithm should expose a stable identifier and version.

Example:

```text
employer-cluster-matcher
0.1.0
```

This enables:

```text
Which algorithm produced this resolution?
Should this cluster be recalculated?
Did a newer algorithm improve recognition?
```

---

# 81. Algorithm Versioning Is Not Application Versioning

The application may be:

```text
Job Nearby 0.4
```

while recognition algorithms have independent versions:

```text
cluster matcher 0.3
publication matcher 0.2
identity resolver 0.1
```

Keeping these distinct improves reproducibility.

---

# 82. Schema Versioning

Database migrations define schema version.

Recognition algorithm version and database schema version are separate concerns.

Do not conflate them.

---

# 83. Future Shared Labor-Market Database

A possible long-term architecture may separate:

```text
shared public market evidence
             +
private local job-seeker history
```

For example:

```text
                  Shared Server
                  public employer
                  observations
                       │
                       ▼
Local Job Nearby ← synchronization
                       │
                       ▼
                 private history
```

This is explicitly **not** required for MVP.

The current boundaries should merely avoid making it impossible.

---

# 84. Future Collaboration

Open-source contributors may eventually share:

```text
source adapters
employer aliases
recognition rules
public company data
test scenarios
```

But individual users should not automatically share:

```text
applications
notes
personal contacts
interviews
```

The public/private boundary established now supports this future.

---

# 85. Backup, restore, export and portability

A local SQLite file is not by itself a complete backup product. Users need a
consistent backup of CRM records plus managed document versions, verified restore,
export and transfer to another computer. Decide snapshot/transaction handling,
active WAL/journal handling, attachment consistency, schema/version manifests,
external-reference resolution and restore verification. Select the export format
later; preserve identity links, event chronology and historical document usage.

The one-time `tools/remediate-proman.cjs` backup procedure is not a general user backup
or restore API. Backups and exports are private data and must not enter source or
release artifacts. Optional cloud synchronization is not part of this requirement.

M22.1 implements the whole-application backup/restore foundation (`LocalBackupService`
in `src/infrastructure/backup/`):
- **SQLite snapshot**: uses `better-sqlite3`'s `db.backup()` (SQLite Online Backup API)
  to capture a transactionally consistent snapshot of the live database (including active
  WAL state) without modifying the production DB or requiring shutdown.
- **Document consistency**: derives the managed document inventory directly from
  `application_document_versions` in the snapshot DB, verifies size and SHA-256 against
  the database metadata, and excludes unreferenced orphan files.
- **ZIP archive & security**: pure-Node ZIP reader/writer (`zipArchive.ts`) with
  Zip Slip path-traversal rejection, absolute/drive/UNC/symlink rejection, and bounded
  entry count, manifest size, and extracted size.
- **Restore pipeline (`VALIDATE -> STAGE -> VERIFY -> SWAP`)**: validates archive,
  manifest, SQLite `PRAGMA integrity_check`, and per-document SHA-256 before mutation;
  migrates older schemas forward (`migrateDatabase`); creates an automatic pre-restore
  safety backup; closes/reopens the live DB cleanly around an atomic swap with
  deterministic rollback on failure. Does not merge installations or include a scheduler.

M22.2 implements the user-data export foundation (`LocalUserDataExportService` in
`src/infrastructure/export/`):
- **Coherent read snapshot**: reads all user-visible CRM, contact, action/reminder,
  interaction, and document metadata within a single SQLite `DEFERRED` read transaction
  without mutating state.
- **Explicit DTO separation**: projects `canonical`, `source`, `employer`, and `crm`
  sections independently (future-compatible with `USER_CREATED` vacancies and
  field-level `userOverrides`), excluding internal `request_id`, `storage_key`,
  `schema_migrations`, cleanup tokens, and document binary bytes in v1.
- **Formats & atomicity**: outputs pretty-printed UTF-8 JSON (`job-nearby-export` v1)
  or a ZIP of UTF-8 BOM RFC-4180 CSV tables (`vacancies.csv`, `notes.csv`,
  `process_transitions.csv`, `interactions.csv`, `actions.csv`, `reminders.csv`,
  `contacts.csv`, `contact_methods.csv`, `vacancy_contacts.csv`, `documents.csv`,
  `document_versions.csv`, `document_associations.csv`), written atomically via
  staging when targeting a filesystem path.

---

# 86. Observability of Recognition

The application should make recognition debugging easy.

For development, a recognition result should expose:

```text
candidate clusters
feature matches
weights
confidence
threshold decisions
candidate identities
contradictions
algorithm versions
```

A developer/debug view may show more detail than the ordinary user interface.

This will be invaluable while tuning the engine.

---

# 87. Architecture Decision Records

Significant architectural changes should eventually use ADRs.

Recommended directory:

```text
docs/adr/
```

Examples:

```text
0001-use-modular-monolith.md
0002-use-sqlite-for-mvp.md
0003-preserve-source-observations.md
```

We do not need to create every ADR immediately.

Once implementation begins, decisions that are likely to be questioned later should be recorded.

---

# 88. README Role

The repository `README.md` should remain concise.

It should explain:

```text
what Job Nearby is
why it exists
current development status
how to run it
where architecture documents are located
how to contribute
```

The detailed product/architecture reasoning belongs in `docs/`.

---

# 89. CONTRIBUTING.md

Before actively inviting external contributors, create:

```text
CONTRIBUTING.md
```

It should explain:

```text
development setup
tests
coding conventions
architecture boundaries
how to add source adapters
how to add recognition algorithms
how to submit fixture scenarios
```

This remains a public-release prerequisite; the implementation baseline already exists.

---

# 90. Free/open-source license and release readiness

The product is intended to remain free to use, with public GitHub source and
community inspection/contribution.

M24.1 establishes the licensing position: Job Nearby is MIT-licensed (`LICENSE` and
`package.json`), third-party obligations for the Windows application and installer are
recorded in `THIRD_PARTY_NOTICES.md`, the dependency inventory is generated by
`npm run audit:licenses` into `docs/THIRD_PARTY_LICENSES.json`, and packaging installs
and verifies the legal resources. `docs/LICENSING.md` is authoritative for the
acceptance policy, known warnings (the NSIS LZMA/CPL exception, the nsis7z LGPL
component, and dev-only CC-BY/Python-2.0/WTFPL packages) and the release-readiness
invariant.

No `CONTRIBUTING.md` is tracked, and there are still no ordinary-user
installer/download or upgrade instructions or a tracked `.github` release workflow.
Release readiness also requires contribution guidance, reproducible build
instructions and supported-platform documentation. M24.2 completed the tracked-content
review: provider fixtures were reduced to minimal regression evidence, the diagnostic
database dump was removed, and `npm run check:fixtures` plus `npm run check:repo`
enforce the content policy. M24.3 rewrote the published history so the former
databases, diagnostic dump and unsanitized captures are unreachable; M24.4 adds
`npm run check:history` and a root `.gitattributes` LF policy so fresh Windows clones
stay deterministic. Public source alone is not a substitute for user-data portability.

M25.1 adds the public privacy and security documentation: `docs/PRIVACY.md`,
`docs/SECURITY_MODEL.md` and `SECURITY.md`, summarized in the README. The packaged
runtime's HTTP interfaces bind only to `127.0.0.1`, but the local API currently has no
caller authentication and does not validate `Origin`/`Host`; the security model records
this as an open release-blocking hardening item, so documentation must not be read as a
claim that the loopback API is authorized.

---

# 91. CRM implementation roadmap

This is the established roadmap location. It replaces the obsolete M0-M9 startup
sequence. Phases express dependency order, not one milestone per bullet.

| Phase | Scope and exit condition | Dependencies |
| --- | --- | --- |
| A - Opportunity/application core | Private pipeline semantics, priority, basic notes/history and an explicit next-action concept beside canonical facts; status changes preserve history and unresolved employers remain usable | Existing canonical IDs, interaction repositories and read-only projections; decide pipeline versus activity semantics first |
| B - Documents | CV/letter library, versions and planned/used associations; later edits cannot change what was submitted | A; storage/backup/portability decision before file ingestion |
| C - Contacts and activities | Reusable contacts, many-opportunity links, communication notes and a chronological activity timeline including document use | A; integrate B version references without owning file storage |
| D - Follow-ups/reminders | Durable tasks, due dates, completion and optional contact links; separate notification delivery; upcoming/overdue queue survives restart | A next-action boundary, C contact links; reminder/time-zone/lifecycle decision |
| E - CRM usability | Combined search/filtering, daily work queue, stalled/advanced opportunities, history and archive/reopen behavior | A-D; reuse existing archive/restore rather than replace it |
| F - Portability | Consistent private backup, tested restore, export and transfer to a new computer | A-D data ownership and B document-storage contract; define requirements early |
| G - Desktop distribution | Installer, bundled runtime, production UI, first run, extension integration, upgrades and clean-machine validation | Packaging feasibility investigated early; F recovery plus license/dependency findings before shipment |
| H - Public release readiness | Selected LICENSE, contribution/install/release docs, public GitHub source, reproducible build/release process and privacy review | G distributable artifacts and F portability; license audit/selection begins early, not only at this final gate |

The next narrow implementation milestone should establish the private opportunity
tracking boundary: priority and notes with auditable changes linked to canonical
vacancy IDs, while preserving existing interaction-derived state and employer-role
semantics. Its design must first specify how a later process state differs from an
activity event. Do not bundle document storage, contacts, reminders or packaging
into that first increment. Full pipeline implementation follows within Phase A.

M18.1 itself implements none of these phases. No schema or runtime change is implied.

---

# 92. First Recognition Algorithm Scope

Recognition v0 should intentionally be small.

Recommended features:

```text
normalized displayed company name
known aliases
city/location
recruiter identity
recruiter reference
job title
normalized description
text similarity
source external ID
```

Output:

```text
candidate existing clusters
confidence
new/existing recommendation
supporting evidence
```

Complex industrial fingerprint extraction can be added after the baseline works.

---

# 93. First Employer Resolution Scope

Identity resolution v0 should support:

```text
explicit company name
manual employer creation
aliases
location validation
user confirmation
user rejection
```

External SIRENE/web research can follow.

This keeps the first implementation testable without network dependency.

---

# 94. Manual Review Is a Feature

The MVP should include an explicit human-review workflow.

Example:

```text
Job Nearby:
"This observation may belong to Employer Cluster #14."

User:
"Link this name to the known organization identity."

or:

"Keep the organization identities separate."
```

This is not a temporary embarrassment to hide.

Identity linkage is distinct from choosing the employer role. A human employer-role
decision must explicitly name the organization and vacancy; ambiguous candidates
are not auto-selected, and changing a confirmed role is an explicit reassignment.

---

# 95. Architecture Non-Goals for MVP

Do not implement initially:

```text
microservices
Kafka/event streaming
Kubernetes
Redis
Elasticsearch
vector database
LLM agents
complex authentication
multi-tenant SaaS
mobile native app
automatic application sending
full labor-market crawling
```

Any of these may become appropriate later.

None is required to validate Job Nearby's core value.

---

# 96. Architectural Risk: Overgeneralization

Because Job Nearby may eventually support many countries and sources, there is a temptation to generalize everything immediately.

Avoid abstractions that have no concrete second implementation yet.

For example:

```text
ProviderFactoryFactory
UniversalGlobalEmploymentOntology
GenericEverythingRepository
```

Prefer small interfaces derived from actual needs.

International extensibility should come primarily from clean boundaries, not speculative abstractions.

---

# 97. Architectural risk: collapsing opportunity and evidence

The opportunity is central to the CRM experience, but a single mutable object
containing captured content, recognition, application state, contacts and documents
would mix ownership. Keep `CanonicalVacancy` as evidence-backed market interpretation;
compose private opportunity tracking through stable canonical references. Contacts
and documents have independent lifecycles; usage, activities and task relationships
belong to private CRM boundaries. Source recapture/reprojection must not erase private
records, and uncertain duplicate publications must not silently merge applications.

---

# 98. Architectural Risk: Recognition as One AI Call

A future contributor may propose:

```text
send vacancy text to LLM
return company name
```

This may be useful as one research technique but cannot replace the recognition architecture.

It would lose:

```text
provenance
candidate alternatives
reprocessing
human correction
cluster history
cross-source relationships
explainability
deterministic tests
```

Any AI feature should fit inside the existing evidence/inference model.

---

# 99. Architectural Risk: Destructive Deduplication

Never implement deduplication as:

```text
if duplicate:
    delete new publication
```

Instead:

```text
preserve observation
create relationship
```

Multiplicity itself may contain useful labor-market information.

---

# 100. Architectural Risk: False Employer Merge

Automatic employer merging must use a higher confidence threshold than merely suggesting a candidate.

Incorrect merges contaminate historical data.

The architecture must favor reversibility.

---

# 101. Architectural Risk: Private/Public Mixing

Do not place fields such as:

```text
applicationSent
personalNotes
interviewResult
```

inside public `Employer` entities.

These belong to the user-history domain.

This becomes critical if shared labor-market data is introduced later.

---

# 102. Architecture Validation Scenarios

The architecture should support the following without redesign:

### Scenario 1

Anonymous vacancy arrives.

Result:

```text
new unresolved employer cluster
```

### Scenario 2

Second vacancy strongly resembles first.

Result:

```text
same cluster
identity still unresolved
```

### Scenario 3

Third source reveals employer.

Result:

```text
existing cluster resolves to employer
all old history retained
```

### Scenario 4

User previously applied before resolution.

Result:

```text
application history remains attached
```

### Scenario 5

Algorithm later discovers cluster was wrong.

Result:

```text
split/reassignment possible
raw observations unchanged
```

### Scenario 6

New job board added.

Result:

```text
new adapter only
core domain unchanged
```

If any of these requires major restructuring, the architecture has failed its primary design goal.

---

# 103. Foundational Architecture Rules

The following rules are established by Architecture v0.1.

**A1 — Use a modular TypeScript monolith for the initial implementation.**

**A2 — Domain logic must remain independent of React, HTTP, database technology, and individual vacancy providers.**

**A3 — Local SQLite is the current persistence layer; alternative databases remain optional behind repositories, not a desktop prerequisite.**

**A4 — Source acquisition is handled through adapters.**

**A5 — Generic/manual capture must work even without a dedicated source adapter.**

**A6 — Browser extension is a capture client, not part of the recognition engine.**

**A7 — Recognition is decomposed into replaceable services rather than one monolithic function.**

**A8 — Recognition algorithms return evidence and explanations, not only scores.**

**A9 — External research returns evidence; it does not directly mutate employer identity.**

**A10 — AI is optional infrastructure behind interfaces, not a core dependency.**

**A11 — Historical recognition results must support reprocessing as algorithms evolve.**

**A12 — Ordinary relational historical records are preferred over full event sourcing.**

**A13 — Private user history must remain structurally separate from public labor-market evidence.**

**A14 — REST/JSON is sufficient for the initial UI/API boundary.**

**A15 — Runtime validation is mandatory at external data boundaries.**

**A16 — Database schema changes must use migrations from the first implementation.**

**A17 — Recognition test scenarios are first-class project assets.**

**A18 — Human review and correction are intentional product features.**

**A19 — Deduplication must create relationships, never destroy source observations.**

**A20 — Avoid premature infrastructure, generalization, and distributed architecture.**

**A21 — Canonical vacancy persistence is accessed through a domain repository port. The SQLite adapter stores a replaceable current projection with explicit evidence links; source observations remain immutable, and projection history is deferred.**

**A22 — Displayed company evidence, organization identity, cluster membership, and vacancy organization roles are separate concerns.**

**A23 — Recognition and prior employer knowledge do not create human vacancy-role decisions.**

**A24 — Identity-linkage/alias decisions and vacancy-specific role decisions use separate application commands and persistence semantics.**

**A25 — `VacancyOrganizationRoleDecision` is human-authored and scoped to one canonical vacancy; recapture alone does not replace it.**

**A26 — Inbox and Review share a derived, read-only employer presentation; it is not persisted and performs no writes.**

**A27 — Private CRM records compose the central opportunity view without changing recognition ownership.**

**A28 — Ordinary-user installation must supply runtime components and preserve local private data; development setup is not product installation.**

---

# 104. Current baseline and next work

The repository, TypeScript implementation, migrations, tests, supported provider
capture, canonical vacancy identity and React review workflow already exist. Earlier
conceptual sections describe design intent, not proof every named service/entity is
implemented. The M18.1 code audit and DATA_MODEL section 78 distinguish actual delivery
from planned CRM concepts. Follow section 91 for new work rather than recreating the
recognition prototype. No central service, SaaS authentication or schema change is
introduced by this documentation alignment.

---


## M19.1 managed application-document storage

`ManagedApplicationDocumentLibrary` coordinates an application repository port and
`ManagedDocumentStorage`; SQLite owns metadata and `LocalManagedDocumentStorage`
owns immutable copies. Explicit workflow commands import versions and associate
versions with vacancies. The Review read model exposes metadata, selection history
and integrity status, never physical storage paths. Captures and recognition do not
read document bytes or metadata.

`documentDataDirectory` resolves a per-user root independently of the working directory:

- Windows: `%LOCALAPPDATA%/JobNearby` (user-home fallback).
- macOS: `~/Library/Application Support/JobNearby`.
- Linux: `$XDG_DATA_HOME/JobNearby` or `~/.local/share/JobNearby`.
- Optional `JOB_NEARBY_DOCUMENT_DATA_DIR`: absolute persistent directory outside
  the repository and system temporary tree. This is deployment configuration, not
  a browser-supplied path.

Files use `documents/<document UUID>/<version UUID>/content` beneath that root.
Only the relative storage key is persisted. Filenames are metadata and cannot
choose a path; traversal/control characters are rejected. Storage validates its
keys and rejects existing symlink/reparse-link components. POSIX files/directories
request private permissions; Windows access follows the user's local-data ACL.
The local OS account and filesystem remain trusted; this is not encrypted storage.

The existing bounded JSON HTTP transport carries base64 uploads (5 MiB decoded
maximum within the 8 MiB request limit); multipart infrastructure is not introduced.
Document writes require JSON. Client media types are stored only as metadata;
downloads are attachments with octet-stream, no-sniff, no-store and sandbox headers.
No HTML/PDF preview or execution occurs. SHA-256 and size are verified before
selection/download, and reads expose missing/corrupt integrity states.

Import sequence: begin IMMEDIATE metadata transaction; check idempotency; stage a
new file under its logical document directory, write/flush/verify, atomically rename
to a new UUID directory; insert metadata; commit. Normal write/metadata failures
roll back metadata and remove only that import's created files. A committed version
therefore has already stored bytes. As with any SQLite-plus-files design, a hard
process/machine crash between file rename and metadata commit can leave an
unreferenced file; automatic orphan deletion/reconciliation is deferred. No claim
of cross-resource or power-loss atomicity is made. Keep such files for storage
review, not automatic adoption; disk failure/tampering is surfaced by integrity
checks. A failed cleanup reports that storage review is needed.

This milestone does not relocate the existing SQLite database or implement desktop
packaging. A complete future backup/restore must consistently include **both** the
SQLite database and the managed document subtree, with the application stopped or
an equivalent consistency mechanism. Restoring to another computer can use a new
configured root because metadata keys are relative. Original external files are
not needed. Copying only the SQLite file is no longer a complete personal-data
backup. No cloud, synchronization, scheduler or document deletion UI is introduced.


## M19.2 document library management

The Documents page (`/documents`) manages reusable library identity; Review continues
to manage exact vacancy selections. Both use `DocumentImportForm`, the same bounded
HTTP import decoder, application library and managed storage service. No duplicate
file-import implementation, OS open command, editor or preview engine is introduced.

Logical rename/archive/restore commands append to a SQLite lifecycle ledger. They
perform no filesystem mutations and therefore introduce no additional orphan-file
window. Version metadata/base document identity guards remain in place. No permanent
delete endpoint exists: safe reference-aware deletion and scan/reconcile maintenance
remain future work. Normal handled import failures still clean their staged files;
the documented hard-crash orphan limitation from M19.1 is unchanged.

The repository counts all retained associations, including superseded selections and
archived vacancies, and rejects new selection/import against an archived document
inside the same IMMEDIATE transaction that validates its request. Existing archived
selections continue to resolve and download through SHA-256 verification. The full
library read contains archived items so history remains resolvable; UI selection
lists default to active items. Backend guards reject stale picker submissions.

Lifecycle metadata uses no new physical path. Restoring the database and managed
file subtree under another configured root preserves identity, lifecycle and verified
downloads. Complete backup still means SQLite **plus** managed files; backup/restore
implementation and filesystem reconciliation are not part of this milestone.

## M20.1 — Private contact boundary

ContactLibrary validates explicit commands; ContactRepository persists independent private CRM people, methods and vacancy relationships. SqliteContactRepository uses transactional command receipts for retry safety. HTTP accepts bounded JSON commands, never arbitrary field PATCH or permanent delete. Contacts and Review use this application path; neither captured evidence nor employer inference reads contacts. Organization linkage awaits stable reusable organization identity rather than conflating recognition clusters with CRM organizations.

All data remains in local SQLite. No external service, logging of method values, enrichment or synchronization is introduced. Existing interactions and next actions are not rewritten or linked automatically; M20.2 adds explicit references for new activity.

Guarded whole-vacancy cleanup counts/removes vacancy_contacts only, including ended links. Link/end mutations invalidate cleanup approval snapshots. Shared contact metadata edits do not change deletion scope because contacts/methods are retained. Single-capture deletion, recapture and vacancy archive/restore preserve contacts and links. Contact archive is independent of vacancy archive. Permanent contact/method deletion is unavailable. Command receipts retain only fingerprints/result IDs, not historical personal field contents.

## M20.2 — Immutable activity references

Contact references are stored separately from existing immutable event/action rows. References and interaction request receipts are inserted atomically with activity in an IMMEDIATE transaction. Eligibility is checked within that transaction after retry lookup: an identical retry succeeds even if a contact was subsequently archived or unlinked; a different contact with the same request ID conflicts. Legacy interaction callers without a request ID retain their prior append behavior; Review now supplies retry IDs. Existing duplicate-event-ID protection is unchanged.

The SQLite read path resolves current contact identity centrally; Review and contact-detail summaries do not fetch names individually or copy contact-method values into activities. Contact detail reuses action history interpretation. No employer recognition, process-state or source-identity semantics change.

Cleanup snapshots include activity references/receipts. New events/actions invalidate stale approvals; contact renames alone do not. Guarded whole-vacancy deletion removes its activity references/receipts while retaining shared contacts. Single-capture deletion and recapture preserve the references. Organization linkage remains deferred.

## M20.3 — Vacancy activity read path

Review loads each existing private CRM view once and passes those records to the pure buildVacancyActivityTimeline projection. Contact/document display lookup uses in-memory maps, without a query per timeline item. No clock, random identity, mutation, new persistence, generic event table or cleanup token is introduced. Underlying record cleanup removes history naturally.

The projection includes interaction metadata, explicit process transitions, notes, action lifecycle/reminder changes, all document selections and contact link/end records. It uses original action-creation due time rather than the current rescheduled value. Reminder replacement remains one event per persisted SET_REMINDER change. Invalid event timestamps are omitted rather than invented. Recognition churn and human organization-role decisions remain outside this milestone. Contact detail's existing reverse view is unchanged. Contact linking/ending refreshes Review so the server projection is immediately current.


### M21.1 — Daily work queue

Today is a non-persisted operational view across unarchived opportunities. It is not a scheduler or a second task/reminder system; most edits remain in Review. Browser timezone defines calendar days; stored instants remain UTC. Refresh recomputes against server time, without background jobs or notifications.

Action precedence is overdue, reminder due, due today, then upcoming through the next seven local calendar days (including that day's end). Existing action/reminder derivation remains authoritative. Distinct actions stay distinct. Missing-action precedence is HIGH priority, stale awaiting response, then general active opportunity. REJECTED, WITHDRAWN and NO_LONGER_RELEVANT suppress missing-action prompts; OFFER remains active. Explicit active actions still surface even in terminal process states.

Awaiting response is stale after seven local calendar-day boundaries without private activity, and only without an active action. This configurable review heuristic is not a universal follow-up deadline and creates no task. Activity uses interaction occurredAt, transition/note/action/change/document-selection createdAt and contact relationship creation/end timestamps, matching the activity timeline sources. Canonical createdAt is the fallback. Public recapture, priority edits, recognition churn, contact renames and document-library lifecycle edits do not reset this clock.

Category ordering: overdue, reminder due, today, HIGH without action, stale awaiting response, upcoming, general without action. Within categories: earliest relevant instant, HIGH/NORMAL/LOW/NONE priority, stable ID. Equal-time ordering is deterministic. The SQLite adapter batch-loads a consistent snapshot without loading Review per vacancy, source payloads or document bytes. No queue records, migrations or cleanup-token inputs are introduced. Archive excludes; restore reuses preserved CRM state. Company labels use existing canonical employer/displayed-company projections and imply no new confirmation.


### M21.2 — Existing commands from Today

Today remains a derived queue and now offers Complete action, Cancel action and Dismiss reminder through the same application commands and HTTP endpoints as Review. An action-backed item represents an active action; an optional exact current due reminder ID enables dismissal independently of queue category. Vacancy-level attention items remain navigation-only. No dashboard mutation model, schema or scheduler is added.

Each command attempt is followed by a full queue read, including failures whose response may have been lost. Summary counts, category changes and ordering come only from that read. Per-action pending guards prevent duplicate clicks; uncertain retries retain the request ID, including when the command succeeded but refresh failed. Conflicts remain visible and trigger refresh. Cancellation uses no modal, consistent with Review; history is retained. Dismissal never completes an action. Existing action-change history naturally updates private staleness. Archive races obey existing commands without unarchiving. Contact-detail deep links remain deferred because Contacts has no detail route.
