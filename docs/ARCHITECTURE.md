# Job Nearby — Architecture

**Version:** 0.1
**Status:** Working Draft
**Project:** Job Nearby
**Related documents:** `PRODUCT_SPECIFICATION.md`, `RECOGNITION_MODEL.md`, `DATA_MODEL.md`

## 1. Purpose

This document defines the initial software architecture for Job Nearby.

The architecture must support the product principles already established:

* company-first user experience;
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

The first system must support this workflow reliably:

```text
User encounters vacancy
        ↓
Capture/import publication
        ↓
Store immutable observation
        ↓
Normalize source information
        ↓
Run recognition
        ↓
Find/create employer cluster
        ↓
Attempt employer identification
        ↓
Retrieve existing user history
        ↓
Present recognition result
        ↓
User confirms or corrects
        ↓
Persist new evidence/history
```

Everything else is secondary to making this loop understandable, testable, and extensible.

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
* straightforward migration to PostgreSQL later.

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

# 8. Local-First Versus Server-First

The recommended initial model is **local-first development with a local backend**.

Conceptually:

```text
Browser
   ↓
React UI
   ↓
Local Node API
   ↓
SQLite
```

This is attractive because private job-search history remains local by default and development is simple.

Later deployment options may include:

```text
self-hosted server
personal cloud deployment
shared public labor-market backend
hybrid local/private + shared/public data
```

The initial architecture should not require any of these.

---

# 9. Privacy Boundary

Job Nearby contains two different data domains:

```text
PUBLIC / MARKET EVIDENCE
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
Incoming Capture
      ↓
Source Adapter
      ↓
Capture Normalization
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

The recognition module is the architectural center of Job Nearby.

Responsibilities:

```text
extract recognition features
build fingerprints
compare employer clusters
rank employer candidates
generate identity resolutions
produce explanations
handle confirmations
trigger re-evaluation
```

It should be divided internally into smaller services.

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
EmployerAlias
EmployerIdentifier
Recruiter
RecruitmentContact
ContactPoint
```

This module represents real-world organizational identities once known.

It should not own raw source observations.

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
ConfirmEmployerIdentity
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

POST   /api/employer-clusters/:id/confirm-identity
POST   /api/employer-clusters/:id/reject-candidate

GET    /api/employer-clusters/:id/interactions
POST   /api/employer-clusters/:id/interactions
```

Exact routes should be designed during implementation.

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

# 35. Initial UI

The first useful UI may consist of only four screens.

### Capture

Paste/import vacancy.

### Recognition Result

Show:

```text
recognized employer
known/new status
identity confidence
cluster confidence
publication-family match
supporting evidence
```

### Employer List

Show known employer clusters.

### Employer Profile

Show:

```text
identity
location
observed publications
recognition history
user interaction history
```

This is enough to validate the product.

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

Example:

```text
user confirms employer identity
        ↓
create ConfirmationRecord
create IdentityResolution
update current cluster projection
possibly add EmployerAlias
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

The first local version has modest security requirements but should still avoid obvious problems.

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

For a local MVP, a fixed local user identity can satisfy this abstraction.

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

# 67. Deployment

Initial supported deployment:

```text
local developer/user machine
```

Potential later deployment:

```text
Docker
self-hosted server
cloud application
desktop wrapper
```

Deployment architecture should not dominate the initial code structure.

---

# 68. Desktop Application — Deferred

Electron/Tauri may eventually be useful for a local-first experience, but should not be introduced before the web application validates the workflow.

A browser-based local application is enough initially.

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

---

# 77. RecognitionReview Projection

Example:

```text
RecognitionReview

observation
clusterMatch
candidateEmployers
identityStatus
supportingEvidence
contradictions
previousUserActions
```

This may become the central MVP screen.

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

# 85. Import/Export

The application should eventually support export of user-owned data.

Possible future formats:

```text
JSON
CSV
database backup
```

The first MVP does not require polished export UI, but storage design should avoid unnecessary lock-in.

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

This can be postponed until the first implementation baseline exists.

---

# 90. License

Because the project is intended to be free and open source, a software license must be chosen before public release.

The architecture document does not choose the exact license.

Potential considerations include:

```text
permissive license
versus
copyleft license
```

This should be a deliberate project decision before publishing the repository publicly.

---

# 91. Initial Implementation Milestones

Recommended implementation sequence:

```text
M0 — Repository baseline
docs
package setup
TypeScript
tests
SQLite migration infrastructure

M1 — Observation capture
manual vacancy input
immutable storage

M2 — Employer clusters
create/search clusters
manual assignment

M3 — Recognition v0
deterministic matching
known/new employer decision

M4 — Employer resolution
known employers
aliases
candidate identities
confirmation/rejection

M5 — Publication families
cross-source duplicate recognition

M6 — User history
research/application/contact events

M7 — Recognition review UI
explanations and corrections

M8 — Source adapter
first dedicated job-board capture

M9 — Browser extension prototype
```

This order prioritizes the useful recognition loop before automation.

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
"This is probably Employer Cluster #14."

User:
"Yes."

or:

"No, this is a new employer."
```

This is not a temporary embarrassment to hide.

Human correction is part of the recognition architecture.

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
desktop wrapper
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

# 97. Architectural Risk: Vacancy-Centric Drift

Developers may naturally model:

```text
Vacancy {
  company
  status
  userApplied
}
```

because this resembles ordinary job-board software.

This would undermine the Job Nearby product model.

Code reviews should preserve the distinction:

```text
Source Observation
Employer Cluster
Employer
Publication Family
Recruitment Campaign
User Interaction
```

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

**A3 — SQLite is the recommended MVP persistence layer, with migration compatibility toward PostgreSQL.**

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

---

# 104. Architecture Baseline

Once this document is approved, the project has sufficient conceptual definition to establish the first implementation baseline.

The initial repository should contain at minimum:

```text
README.md

docs/
  PRODUCT_SPECIFICATION.md
  RECOGNITION_MODEL.md
  DATA_MODEL.md
  ARCHITECTURE.md

src/
tests/
```

The next step is no longer another conceptual document.

The next step should be:

> **Create the Git repository and TypeScript project baseline, add the approved documentation, establish tests and database migration tooling, and make the first clean baseline commit before implementing product features.**

The first code after that baseline should implement:

```text
SourceReference
SourceObservation
manual capture
SQLite persistence
basic tests
```

Recognition should begin only after immutable observation capture is working correctly.
