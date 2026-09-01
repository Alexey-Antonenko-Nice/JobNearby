# Job Nearby — Data Model

**Version:** 0.1
**Status:** Working Draft
**Project:** Job Nearby
**Related documents:** `PRODUCT_SPECIFICATION.md`, `RECOGNITION_MODEL.md`

## 1. Purpose

This document defines the core Job Nearby domain entities, their relationships, ownership, lifecycle, mutability, and historical behavior.

The model is designed around four principles:

1. source observations are preserved;
2. inferred knowledge is revisable;
3. employer identity may remain unresolved;
4. private user-history data remains separate from public labor-market evidence.

The model is intentionally provider-independent. Indeed, Meteojob, Jooble, France Travail, company career pages, public registries, browser capture, and future sources must all fit the same core domain.

---

## 2. Domain Layers

The Job Nearby domain is divided into five logical layers.

```text
SOURCE LAYER
Raw captured observations

        ↓

EVIDENCE LAYER
Normalized facts extracted from observations

        ↓

RECOGNITION LAYER
Publication families, employer clusters,
candidate identities, recognition conclusions

        ↓

LABOR-MARKET LAYER
Employers, locations, recruitment campaigns,
hiring history and analytics

        ↓

USER LAYER
Private user actions, notes and application history
```

These layers should remain conceptually distinct even when stored in the same database.

---

# 3. Identity Conventions

Every persistent entity should have an internal Job Nearby identifier.

Example:

```text
SourceObservationId
EmployerClusterId
EmployerId
RecruitmentCampaignId
```

Internal IDs must not depend on external source identifiers.

External IDs may change, disappear, collide across providers, or be absent.

Conceptually:

```text
Job Nearby internal ID
        ≠
Indeed vacancy ID
        ≠
Meteojob job ID
        ≠
SIRET
```

External identifiers are attributes/evidence, not primary domain identity.

---

# 4. Time Conventions

The model distinguishes different kinds of time.

Typical timestamps include:

```text
observedAt
publishedAt
createdAt
updatedAt
evaluatedAt
confirmedAt
occurredAt
```

`observedAt` is particularly important.

It means:

> The moment Job Nearby captured or observed the source information.

This may differ from the source's own publication date.

---

# 5. SourceObservation

`SourceObservation` is the fundamental immutable evidence record.

`CanonicalVacancy` is the separate, provider-independent interpretation of a
recruitable role supported by one or more source observations. It preserves opaque
evidence references, uncertainty, and conflicts without replacing observations or
becoming private CRM state. Its Job Nearby identity is independent of provider IDs
and employer-cluster identity. See `CANONICAL_VACANCY.md`.

The durable canonical-vacancy projection stores observation membership, evidence
references, field states and alternatives, and organization relationships as
structured relational data. Re-saving atomically replaces that current projection;
it does not mutate observations or yet retain projection history.

Canonical identity persistence enforces that one `SourceObservation` belongs to
at most one `CanonicalVacancy`. A normalized provider namespace plus exact,
case-sensitive external ID may likewise identify at most one canonical vacancy.
Atomic claim records coordinate concurrent processors before a complete canonical
projection exists; they reserve identity and membership but do not contain vacancy
facts or replace immutable observations as evidence. Repeated or competing claims
converge on the same internal canonical ID. An observation without an external ID
can still claim membership, but it creates no exact provider-identity claim.

It represents what Job Nearby captured from one source at one moment.

Conceptual structure:

```text
SourceObservation

id
source
observedAt

sourceUrl?
externalId?
publishedAt?

title?
displayedCompanyName?
locationText?
description?
salaryText?
contractText?
contactText?

rawContent?
metadata
```

The precise source payload may vary.

---

# 6. SourceObservation Mutability

A captured observation should normally be treated as immutable.

If the same source page changes later, Job Nearby should create another observation rather than silently overwrite history.

Example:

```text
Observation #101
20 Aug
Salary: €30–35k

Observation #183
25 Aug
Same source vacancy
Salary: €32–36k
```

This preserves the temporal evolution of the source.

---

# 7. SourceReference

Each observation has a source reference.

Conceptually:

```text
SourceReference

sourceType
sourceName
sourceUrl?
externalId?
providerMetadata?
```

Potential source types include:

```text
JOB_BOARD
RECRUITMENT_AGENCY
EMPLOYER_WEBSITE
PUBLIC_API
PUBLIC_REGISTER
EMAIL
MANUAL
BROWSER_CAPTURE
OTHER
```

The exact enum may evolve.

---

# 8. Raw Content

When legally and technically appropriate, Job Nearby may preserve raw captured content.

Possible representations include:

```text
raw HTML snapshot
structured source payload
plain text capture
source JSON
selected page fields
```

Raw content must not be assumed to be permanently redistributable merely because it was captured.

Storage, licensing, and export policy should remain separate architectural concerns.

---

# 9. EvidenceRecord

`EvidenceRecord` represents a normalized fact extracted from an observation or another evidence source.

Conceptually:

```text
EvidenceRecord

id
type
value

sourceObservationId?
sourceReference

observedAt
confidence?
normalizationMethod?
```

Examples:

```text
type = EMPLOYER_NAME
value = "Blue Paper"

type = LOCATION_CITY
value = "Strasbourg"

type = EMPLOYEE_COUNT_APPROX
value = 160

type = SHIFT_PATTERN
value = "2x8"
```

---

# 10. Observation Versus Evidence

`SourceObservation` preserves source material.

`EvidenceRecord` represents normalized information extracted from it.

Example:

```text
Source text:
"PME alsacienne d'environ 160 collaborateurs"

        ↓

Evidence:
REGION = Alsace
COMPANY_TYPE = SME
EMPLOYEE_COUNT_APPROX = 160
```

The extracted evidence may later be recalculated without changing the original observation.

---

# 11. Evidence Value Types

Evidence values may require multiple data shapes.

Examples:

```text
string
number
boolean
date
range
location
identifier
enum
structured object
```

The implementation should avoid forcing every evidence value into a single string representation.

---

# 12. Evidence Provenance

Every evidence record should be traceable back to its source.

Conceptually:

```text
EvidenceRecord
     ↓
SourceObservation
     ↓
SourceReference
```

Evidence derived from several observations may instead reference several supporting records.

This may be modeled through a relationship entity rather than a single foreign key.

---

# 13. EvidenceRole

Evidence may support different recognition purposes.

Potential roles include:

```text
IDENTITY
LOCATION
ORGANIZATION
INDUSTRY
RECRUITMENT
TEXTUAL
TEMPORAL
CONTACT
```

A single evidence record may potentially support more than one role.

---

# 14. Recruiter

`Recruiter` represents a recruitment intermediary or recruiting organization.

Examples:

```text
Page Personnel
Nextep HR
ACTUA
CAMO EMPLOI
```

Conceptual structure:

```text
Recruiter

id
canonicalName
aliases
website?
identifiers?
```

A recruiter is not automatically an employer.

---

# 15. RecruitmentContact

`RecruitmentContact` represents a known recruiting person or contact point.

Conceptually:

```text
RecruitmentContact

id
name?
role?
email?
phone?
recruiterId?
employerId?
employerLocationId?
```

The exact employer relationship may sometimes be unknown.

All contact details should retain provenance.

---

# 16. EmployerCluster

`EmployerCluster` is the core recognition-memory entity.

It represents observations believed to concern the same real employer/location, whether or not the real identity is known.

Conceptual structure:

```text
EmployerCluster

id
status

createdAt
updatedAt

resolvedEmployerId?

primaryLocationHint?
displayLabel?

fingerprintId?
```

Possible status values:

```text
UNRESOLVED
PROBABLY_RESOLVED
RESOLVED
CONFLICTED
```

---

# 17. EmployerCluster Identity

An employer cluster has a stable internal identity independent of company name.

Example:

```text
EmployerCluster #31

20 Aug:
UNKNOWN — Brumath

2 Sep:
Probable Company A

8 Sep:
Resolved as Company B
```

The cluster remains the same Job Nearby entity throughout this evolution.

---

# 18. ObservationClusterAssignment

The relationship between a source observation and an employer cluster is itself an inference.

It should therefore be represented explicitly.

Conceptually:

```text
ObservationClusterAssignment

id
sourceObservationId
employerClusterId

confidence
status

algorithm
algorithmVersion
evaluatedAt

explanation?
```

Possible statuses:

```text
PROPOSED
ACCEPTED
REJECTED
USER_CONFIRMED
```

---

# 19. Why Assignment Is a Separate Entity

This must not be represented merely as:

```text
sourceObservation.employerClusterId
```

because:

* the assignment may change;
* several candidate clusters may exist;
* confidence matters;
* the user may reject it;
* algorithms may be rerun;
* historical inference should remain auditable.

---

# 20. EmployerFingerprint

`EmployerFingerprint` represents structured employer characteristics derived from observations associated with a cluster.

Conceptually:

```text
EmployerFingerprint

id
employerClusterId

features
generatedAt

algorithm
algorithmVersion
```

The fingerprint itself should be recalculable.

It is not immutable source evidence.

---

# 21. FingerprintFeature

A fingerprint feature may be modeled explicitly.

Conceptually:

```text
FingerprintFeature

type
normalizedValue
weight?
specificity?
confidence?

supportingEvidenceIds[]
```

Examples:

```text
LOCATION_CITY = Strasbourg
INDUSTRY = Paper manufacturing
EMPLOYEE_COUNT ≈ 160
INFRASTRUCTURE = Biomass boiler
```

---

# 22. Employer

`Employer` represents a resolved or explicitly known real-world employing organization.

Conceptual structure:

```text
Employer

id
canonicalName

legalName?
website?
industry?
identifiers?

createdAt
updatedAt
```

An employer should not carry every observed value directly.

Observed and changing facts should remain evidence-backed.

---

# 23. Employer Alias

Companies may appear under multiple names.

Conceptually:

```text
EmployerAlias

id
employerId
name
normalizedName
sourceReference?
status
```

Potential statuses:

```text
OBSERVED
CONFIRMED
REJECTED
HISTORICAL
```

Aliases assist future employer recognition.

---

# 24. EmployerIdentifier

External official or commercial identifiers should be modeled separately.

Examples:

```text
SIREN
SIRET
VAT
registry ID
company-domain
internal source ID
```

Conceptually:

```text
EmployerIdentifier

id
employerId
type
value
sourceReference
validFrom?
validTo?
```

This avoids hard-coding French identifiers into the base Employer entity.

---

# 25. EmployerLocation

`EmployerLocation` represents a physical location associated with an employer.

Conceptually:

```text
EmployerLocation

id
employerId

label?
address?
postalCode?
city?
countryCode?

latitude?
longitude?

locationType
```

Possible location types include:

```text
WORKPLACE
ESTABLISHMENT
RECRUITMENT_OFFICE
HEAD_OFFICE
APPROXIMATE_WORKPLACE
UNKNOWN
```

---

# 26. Employer Versus EmployerLocation

One employer may have multiple locations.

Example:

```text
Employer: Company A

├── Strasbourg production site
├── Brumath service office
└── Paris head office
```

For Job Nearby's user experience, the location relevant to hiring or work may be more important than the legal head office.

---

# 27. EmployerCandidate

An `EmployerCandidate` links an unresolved employer cluster to a possible real employer identity.

Conceptually:

```text
EmployerCandidate

id
employerClusterId
employerId

score?
confidence
status

createdAt
evaluatedAt
```

Potential statuses:

```text
CANDIDATE
PROBABLE
REJECTED
SELECTED
```

---

# 28. EmployerCandidateEvidence

Candidate conclusions need explicit supporting and opposing evidence.

Conceptually:

```text
EmployerCandidateEvidence

id
employerCandidateId
evidenceRecordId

effect
weight?
explanation?
```

Possible effects:

```text
SUPPORTS
CONTRADICTS
NEUTRAL
```

This allows recognition explanations to be reconstructed.

---

# 29. IdentityResolution

`IdentityResolution` represents a conclusion about the real identity of an employer cluster.

Conceptually:

```text
IdentityResolution

id
employerClusterId

status
employerId?

confidence

algorithm
algorithmVersion
evaluatedAt

confirmedByUser?
```

Possible status values:

```text
RESOLVED
PROBABLE
AMBIGUOUS
UNRESOLVED
CONFLICTED
```

---

# 30. Resolution History

Identity resolution should be historical.

Example:

```text
20 Aug
UNRESOLVED

23 Aug
PROBABLE → Company A

29 Aug
Company A rejected

2 Sep
RESOLVED → Company B
```

Older resolution attempts should remain available for audit and debugging.

---

# 31. Publication

The term `Publication` refers to a vacancy advertisement as represented by one source.

In the initial data model, `SourceObservation` may already represent the captured publication sufficiently.

However, a future normalized `Publication` entity may be useful when several observations represent the same source publication over time.

Conceptually:

```text
Publication

id
source
externalId?

firstObservedAt
lastObservedAt

currentNormalizedState?
```

Then:

```text
Publication
    ├── Observation at T1
    ├── Observation at T2
    └── Observation at T3
```

For MVP v1 this additional abstraction may be postponed unless implementation experience demonstrates a clear need.

---

# 32. PublicationFamily

`PublicationFamily` groups publications believed to be copies, syndications, or republications of substantially the same advertisement.

Conceptually:

```text
PublicationFamily

id
createdAt
updatedAt

representativeTitle?
```

Membership is inferred, not observed.

---

# 33. PublicationFamilyMembership

Conceptually:

```text
PublicationFamilyMembership

id
publicationFamilyId
sourceObservationId

confidence
status

algorithm
algorithmVersion
evaluatedAt
```

This relationship must support later correction.

---

# 34. RecruitmentCampaign

`RecruitmentCampaign` represents inferred employer hiring activity.

Conceptually:

```text
RecruitmentCampaign

id
employerClusterId

status

firstObservedAt
lastObservedAt

occupation?
location?
positionCount?
positionCountType?

createdAt
updatedAt
```

---

# 35. PositionCount

Position count requires uncertainty.

Conceptually:

```text
PositionCount

type:
  EXACT
  MINIMUM
  RANGE
  PLURAL_UNKNOWN
  UNKNOWN

value?
minimum?
maximum?
```

Examples:

```text
EXACT = 3

MINIMUM = 2

PLURAL_UNKNOWN

UNKNOWN
```

This avoids interpreting every publication as one position.

---

# 36. RecruitmentCampaignMembership

A publication family or observation may be associated with a recruitment campaign.

Conceptually:

```text
RecruitmentCampaignMembership

id
recruitmentCampaignId
publicationFamilyId?

sourceObservationId?

confidence
status

algorithm
algorithmVersion
evaluatedAt
```

Usually publication-family membership should be preferred when available.

---

# 37. Campaign Status

Potential campaign states include:

```text
ACTIVE
PROBABLY_ACTIVE
ENDED
RECURRENT
UNKNOWN
```

Status should be inferred from observations rather than assumed solely from the availability of one source URL.

---

# 38. Occupation

Occupations should use a normalized internal model.

Conceptually:

```text
Occupation

id
canonicalName

classificationSystem?
classificationCode?
```

Examples of external classifications:

```text
ROME
ESCO
other national systems
```

The base architecture must remain extensible beyond France.

---

# 39. OccupationObservation

A source publication may contain an observed or inferred occupation.

Conceptually:

```text
OccupationObservation

id
sourceObservationId

rawTitle
normalizedOccupationId?
confidence
normalizationMethod
```

This preserves the difference between source wording and normalized classification.

---

# 40. Skill

Skills may eventually be normalized separately.

Conceptually:

```text
Skill

id
canonicalName
classificationSystem?
classificationCode?
```

---

# 41. SkillObservation

Conceptually:

```text
SkillObservation

id
sourceObservationId

rawText
normalizedSkillId?
confidence
```

Skill extraction is not required for the earliest recognition MVP but the model should leave room for it.

---

# 42. ContactPoint

Contact information should be modeled independently and retain provenance.

Conceptually:

```text
ContactPoint

id

type
value

employerId?
employerLocationId?
recruiterId?
recruitmentContactId?

sourceReference
observedAt

status?
```

Types may include:

```text
EMAIL
PHONE
WEBSITE
CAREER_PAGE
APPLICATION_URL
LINKEDIN
OTHER
```

---

# 43. Contact Validity

Contact information may become outdated.

Potential status values:

```text
ACTIVE
UNKNOWN
INVALID
HISTORICAL
```

Job Nearby should avoid assuming that a phone number observed once remains indefinitely valid.

---

# 44. UserEmployerInteraction

The private user domain begins with `UserEmployerInteraction`.

Rather than storing one mutable status, Job Nearby should preferably preserve interaction history.

Conceptually:

```text
UserEmployerInteraction

id
userId
employerClusterId

type
occurredAt

notes?
relatedObservationId?
relatedCampaignId?
```

---

# 45. User Interaction Types

M6.1 makes the vacancy-specific part of the USER LAYER concrete as a separate,
private relationship:

```text
CanonicalVacancy
        ↓
UserVacancyInteractionEvent
```

`UserVacancyInteractionEvent` is append-only and records private actions such as
reviewing, applying, contacting, interviewing, rejecting, withdrawing, or closing.
It does not add private state to `CanonicalVacancy`, alter its public evidence, or
change `SourceObservation` and employer-recognition records. The full event history
is primary. Current `UserVacancyState` is derived from the latest event ordered by
`occurredAt`, then `recordedAt`, then event ID. A canonical vacancy with no events
is implicitly `NEW`; `NEW` is not stored as an event.

The vacancy interaction history is intentionally distinct from the future
employer-level history described below.

M6.2 adds `EmployerMemoryView` as a derived, read-only composition:

```text
EmployerCluster
  -> CanonicalVacancy[]
  -> UserVacancyHistory[]
  -> EmployerMemoryView
```

The view includes only canonical vacancies whose explicit employer relationship
references the cluster. It summarizes immutable observation history, existing
organization roles, and private vacancy interaction histories without merging or
mutating them. `EmployerMemoryView` has no persistence table and is not
source-of-truth data; it is reconstructed from the public and private layers.

M6.3 composes a vacancy-centric review projection from the same owned data:

```text
CanonicalVacancy
        +
UserVacancyHistory
        +
EmployerMemoryView
        ↓
VacancyReviewView
```

`VacancyReviewView` is derived and read-only. It exposes canonical facts,
observation recurrence, employer memory, organization roles, private interaction
history, and transparent review signals. It is not persisted and does not produce
recommendations, scores, APPLY/SKIP decisions, or new market evidence. A known
employer conservatively means that the explicit employer cluster contains another
canonical vacancy; cluster existence or resolved identity alone is insufficient.

M6.4 exposes the explicit review/action loop without changing ownership:

```text
CanonicalVacancy
  -> VacancyReviewView
  -> explicit UserVacancyInteractionEvent
  -> refreshed VacancyReviewView
```

Reading or opening a review never records `REVIEWED`. That event, like every other
private interaction, must be requested explicitly. Only the append-only USER LAYER
changes; review and employer-memory signals remain derived.

Possible types include:

```text
DISCOVERED
RESEARCHED
INTERESTING
NOT_INTERESTING
CONTACTED
APPLICATION_PREPARED
APPLICATION_SENT
REPLY_RECEIVED
INTERVIEW
REJECTED
OFFER_RECEIVED
FOLLOW_UP
NOTE
```

The list should remain extensible.

---

# 46. Why User History References EmployerCluster

User interactions should normally reference `EmployerCluster`, not only resolved `Employer`.

Reason:

The user may research or contact an employer before Job Nearby has identified its legal/company name.

Example:

```text
UNKNOWN EMPLOYER #17

researched: 20 Aug
contacted: 21 Aug

resolved as XYZ Industries: 30 Aug
```

The historical user actions remain attached correctly.

---

# 47. User Notes

Private notes should be separated from public evidence.

Conceptually:

```text
UserNote

id
userId

employerClusterId?
sourceObservationId?
recruitmentCampaignId?

content
createdAt
updatedAt
```

Private notes must never accidentally become public recognition evidence.

---

# 48. RecognitionResult

A `RecognitionResult` is primarily a service output rather than necessarily a long-lived domain entity.

Conceptually:

```text
RecognitionResult

sourceObservationId

publicationFamilyMatch?
employerClusterMatch
identityResolution
campaignMatch?

explanation
warnings
```

It provides a convenient aggregate for the UI.

---

# 49. RecognitionExplanation

Recognition explanations should be structured.

Conceptually:

```text
RecognitionExplanation

supportingEvidence[]
contradictoryEvidence[]
candidateComparisons[]
summary
```

The user interface can render this in readable language.

---

# 50. RecognitionAlgorithmRun

For reproducibility and debugging, recognition executions may eventually be recorded.

Conceptually:

```text
RecognitionAlgorithmRun

id
algorithm
algorithmVersion

startedAt
completedAt

inputReference
resultReference?
```

This is especially useful once algorithm evolution becomes significant.

It may be postponed in the first MVP if unnecessary.

---

# 51. MergeRecord

Cluster merges must preserve history.

Conceptually:

```text
MergeRecord

id

sourceClusterIds[]
targetClusterId

reason
confidence?
performedAt
performedBy
```

`performedBy` may indicate:

```text
USER
ALGORITHM
ADMIN
```

---

# 52. SplitRecord

Cluster splits similarly require history.

Conceptually:

```text
SplitRecord

id

sourceClusterId
resultClusterIds[]

reason
performedAt
performedBy
```

Observation assignments are then updated through new assignment records rather than deleting historical recognition data.

---

# 53. ConfirmationRecord

Human confirmations and rejections should be explicit.

Conceptually:

```text
ConfirmationRecord

id
userId

targetType
targetId

decision
createdAt

notes?
```

Possible decisions:

```text
CONFIRMED
REJECTED
CORRECTED
```

Targets may include:

```text
EmployerCandidate
ObservationClusterAssignment
PublicationFamilyMembership
RecruitmentCampaignMembership
```

---

# 54. DataSourceReference

External enrichment data should use a common provenance abstraction.

Conceptually:

```text
DataSourceReference

id

sourceType
sourceName

url?
externalId?

retrievedAt
```

Examples:

```text
INSEE SIRENE
ROME
France Travail
company website
search result
```

---

# 55. Public Versus Private Data Boundary

The data model must distinguish public/shared evidence from user-private information.

Conceptually:

```text
PUBLIC / SHAREABLE DOMAIN

SourceObservation
EvidenceRecord
Recruiter
EmployerCluster
Employer
EmployerLocation
EmployerCandidate
IdentityResolution
PublicationFamily
RecruitmentCampaign
Occupation
Skill
DataSourceReference

PRIVATE USER DOMAIN

UserEmployerInteraction
UserNote
application-related metadata
personal recruiter notes
```

The exact sharing policy may become more restrictive depending on source licensing.

---

# 56. Ownership Rules

A useful conceptual ownership model is:

```text
SourceObservation
owns no inference

EmployerCluster
owns recognition context

Employer
owns canonical resolved identity

RecruitmentCampaign
belongs to EmployerCluster

UserEmployerInteraction
belongs to User + EmployerCluster
```

Inference relationships should not be hidden inside unrelated objects.

---

# 57. Historical Versus Current State

The model contains both history and current projections.

For example:

```text
IdentityResolution history
        ↓
Current employer identity
```

or:

```text
UserEmployerInteraction history
        ↓
Current user status for employer
```

Current state should preferably be derived from history rather than replacing it.

Materialized current-state projections may later be added for performance.

---

# 58. Immutable Entities

Entities that should normally be immutable after creation include:

```text
SourceObservation
historical ConfirmationRecord
historical MergeRecord
historical SplitRecord
historical recognition evaluation
```

Corrections should usually create new records.

---

# 59. Recalculable Entities

Entities that should be treated as recalculable include:

```text
EmployerFingerprint
candidate rankings
confidence values
recognition explanations
campaign inference
normalized classifications
```

They depend on algorithms that may evolve.

---

# 60. Stable Entities

Entities intended to have stable internal identity include:

```text
EmployerCluster
Employer
EmployerLocation
Recruiter
RecruitmentCampaign
Occupation
Skill
```

Their attributes may evolve, but their internal identity should remain stable where possible.

---

# 61. Deletion Strategy

Hard deletion should be uncommon for evidence and inference history.

Preferred mechanisms include:

```text
invalidated
superseded
rejected
merged
historical
```

Hard deletion may still be required for:

* privacy requests;
* legal obligations;
* accidental sensitive-data capture;
* user account deletion;
* corrupted data.

---

# 62. Minimal MVP Entity Set

The full conceptual model is intentionally richer than the first implementation.

The first MVP probably requires only:

```text
SourceObservation
SourceReference

EmployerCluster
ObservationClusterAssignment

Employer
EmployerAlias
EmployerLocation

EmployerCandidate
IdentityResolution

Recruiter

PublicationFamily
PublicationFamilyMembership

UserEmployerInteraction

ConfirmationRecord
```

The following can initially remain simplified or deferred:

```text
EvidenceRecord as fully generic system
RecruitmentCampaign
Skill normalization
RecognitionAlgorithmRun
MergeRecord / SplitRecord UI
advanced ContactPoint lifecycle
```

However, the MVP implementation should avoid architectural choices that make these impossible later.

---

# 63. Suggested Entity Relationship Overview

```text
SourceReference
      │
      ▼
SourceObservation
      │
      ├──────────────► PublicationFamilyMembership
      │                         │
      │                         ▼
      │                 PublicationFamily
      │
      ├──────────────► ObservationClusterAssignment
      │                         │
      │                         ▼
      │                  EmployerCluster
      │                         │
      │             ┌───────────┼────────────┐
      │             │           │            │
      │             ▼           ▼            ▼
      │     EmployerCandidate  Recruitment   UserEmployer
      │             │         Campaign       Interaction
      │             ▼
      │      IdentityResolution
      │             │
      │             ▼
      │          Employer
      │             │
      │             ▼
      │      EmployerLocation
      │
      └──────────────► Recruiter / Contact evidence
```

---

# 64. Key Cardinalities

Conceptually:

```text
SourceReference
1 → many SourceObservations

SourceObservation
many ↔ many EmployerClusters
through assignments

EmployerCluster
0 or 1 currently resolved Employer

EmployerCluster
many EmployerCandidates

Employer
1 → many EmployerLocations

Employer
1 → many EmployerAliases

PublicationFamily
1 → many publication observations

EmployerCluster
1 → many RecruitmentCampaigns

User
1 → many UserEmployerInteractions

EmployerCluster
1 → many UserEmployerInteractions
```

Several of these are historically many-to-many even if the current projection looks simpler.

---

# 65. Example — Anonymous Brumath Employer

Captured observation:

```text
SourceObservation #301

source:
Meteojob

displayedCompany:
ACTUA

location:
Brumath

description:
automated production-line company
international travel
mechanical/electrical commissioning
```

Recruiter:

```text
Recruiter #12
ACTUA
```

Recognition:

```text
EmployerCluster #31
UNRESOLVED
```

Assignment:

```text
Observation #301
    ↓ 0.96
EmployerCluster #31
```

Employer candidates:

```text
Company A — rejected
Company B — low confidence
```

User history:

```text
EmployerCluster #31
researched
```

The system is already useful despite lacking a resolved Employer.

---

# 66. Example — Blue Paper Resolution

Observations:

```text
Publication A
Publication B
Publication C
```

Assignments:

```text
A ─┐
B ─┼──► EmployerCluster #22
C ─┘
```

Fingerprint:

```text
Strasbourg
paper manufacturing
~160 employees
biomass boiler
wastewater treatment
```

Candidate:

```text
EmployerCandidate:
Blue Paper
confidence: very high
```

Resolution:

```text
EmployerCluster #22
        ↓
Employer:
Blue Paper
```

The underlying observations remain unchanged.

---

# 67. Example — Same Company, Different Locations

Suppose an employer operates:

```text
Company A

Strasbourg office
Molsheim factory
Paris headquarters
```

These should normally resolve to the same `Employer` but different `EmployerLocation` records.

Depending on the desired recognition granularity, Job Nearby may maintain separate employer clusters for materially different hiring locations and later resolve all of them to the same employer.

This prevents the company-first UI from losing geographic relevance.

---

# 68. Employer Cluster Granularity

For Job Nearby, cluster granularity should generally represent:

> **the same practical hiring employer/location from the job seeker's perspective**

rather than the broadest possible corporate group.

Therefore:

```text
Large Group
    ↓
French subsidiary
    ↓
Strasbourg establishment
```

may result in the Strasbourg establishment being the relevant clustering target even if the corporate parent is known.

This keeps recognition useful for nearby job hunting.

---

# 69. Canonical Employer Does Not Destroy Local Identity

Resolving a cluster to an employer must not remove location-specific information.

Example:

```text
Employer:
Large Industrial Group

EmployerCluster:
Large Industrial Group — Molsheim site

EmployerLocation:
Molsheim plant
```

The application may display the local site prominently while retaining the broader canonical employer identity.

---

# 70. Current Employer Projection

For UI convenience, Job Nearby may expose a derived current employer view:

```text
CurrentEmployerView

clusterId
displayName
identityStatus
identityConfidence
primaryLocation
recruiter?
latestHiringActivity
userStatus
```

This is a projection, not a source-of-truth entity.

It should be reconstructable from underlying domain data.

---

# 71. Current User Status Projection

Similarly:

```text
CurrentUserEmployerStatus

employerClusterId
latestMeaningfulState
lastInteractionAt
applicationState?
```

can be derived from interaction history.

This supports efficient UI without sacrificing event history.

---

# 72. Storage Neutrality

This data model is conceptual.

It does not yet decide whether storage should use:

```text
PostgreSQL
SQLite
document database
embedded local storage
hybrid architecture
```

That belongs in `ARCHITECTURE.md`.

The domain model should not be unnecessarily distorted to fit one storage technology.

---

# 73. TypeScript Neutrality

This document also deliberately stops short of defining final TypeScript interfaces.

The TypeScript implementation should follow the domain model after architecture decisions are made.

In particular, implementation should avoid premature patterns such as:

```text
one giant Vacancy interface
```

or:

```text
Employer {
  name
  address
  status
  vacancy[]
}
```

because these would collapse evidence, identity, inference, and history into one mutable object.

---

# 74. Data Model Validation Rules

Initial validation rules should include:

**D1 — Every SourceObservation has a source and observation timestamp.**

**D2 — EmployerCluster does not require resolved employer identity.**

**D3 — Recruiter identity must not automatically populate employer identity.**

**D4 — Cluster assignment must be representable independently from the observation.**

**D5 — Employer identity resolution must retain confidence and provenance.**

**D6 — Publication-family membership must remain revisable.**

**D7 — User history may exist for unresolved employer clusters.**

**D8 — External identifiers do not replace internal IDs.**

**D9 — Current state must not destroy historical states.**

**D10 — Private user data must remain separable from public labor-market evidence.**

---

# 75. Foundational Data Model Rules

The following rules are established by Data Model v0.1.

**DM1 — `SourceObservation` is the immutable foundation of captured evidence.**

**DM2 — Normalized evidence is derived from, not substituted for, source observations.**

**DM3 — `EmployerCluster` is the primary recognition-memory entity.**

**DM4 — Employer clusters may remain permanently unresolved.**

**DM5 — `Employer` represents resolved real-world identity, not anonymous hiring activity.**

**DM6 — Observation-to-cluster membership is an inference relationship with confidence.**

**DM7 — Employer candidates and identity resolutions preserve alternative hypotheses and history.**

**DM8 — `EmployerLocation` is distinct from the employer's corporate identity.**

**DM9 — Recruiters are independent entities and roles.**

**DM10 — Publication families are inferred groups, not destructive deduplication.**

**DM11 — Recruitment campaigns are separate from publications and may represent multiple positions.**

**DM12 — User interactions attach to employer clusters so history survives later identity resolution.**

**DM13 — Historical observations, confirmations, and recognition changes should normally be additive.**

**DM14 — Recalculable inference must remain distinguishable from immutable evidence.**

**DM15 — Provider-specific identifiers and schemas belong at the source boundary, not in the core domain.**

---

# 76. Recommended MVP Domain Boundary

For the first TypeScript implementation, the recommended domain boundary is:

```text
capture/
  SourceObservation
  SourceReference

recognition/
  EmployerCluster
  ObservationClusterAssignment
  EmployerCandidate
  IdentityResolution
  PublicationFamily
  PublicationFamilyMembership
  ConfirmationRecord

employers/
  Employer
  EmployerAlias
  EmployerLocation
  Recruiter

user-history/
  UserEmployerInteraction
```

This is not yet a required folder structure.

It is a conceptual decomposition to be reviewed in the architecture document.

---

# 77. Next Document

The next project document should be:

**`ARCHITECTURE.md`**

It should decide how this data model is implemented operationally, including:

* application topology;
* frontend/backend boundary;
* local versus server storage;
* database choice;
* source adapter architecture;
* browser-extension relationship;
* recognition service boundaries;
* background reprocessing;
* external research adapters;
* privacy boundary;
* API design;
* testing strategy;
* migration strategy;
* repository structure;
* TypeScript package/module boundaries;
* deployment assumptions;
* how future contributors can add recognition algorithms and source adapters without modifying the core domain.

After `ARCHITECTURE.md` is approved, the project should have enough stability to initialize the repository and begin the TypeScript implementation.
