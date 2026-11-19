# Job Nearby — Data Model

**Version:** 0.2 (M18.1 CRM alignment)
**Status:** Working Draft
**Project:** Job Nearby
**Related documents:** `PRODUCT_SPECIFICATION.md`, `RECOGNITION_MODEL.md`

## 1. Purpose

This document defines the core Job Nearby domain entities, their relationships, ownership, lifecycle, mutability, and historical behavior.

The opportunity is the central CRM view, composed from evidence-backed canonical
facts and separate private records. This remains a conceptual model: many named
entities below are not implemented. Section 78 is the current CRM delivery/gap audit.

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

`displayedCompanyName` is the company's source-provided text, not a resolved
`Employer` reference. It is observed evidence only; it does not establish
recognition, organization identity, or the employer role for a vacancy.

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

type = DISPLAYED_COMPANY_NAME
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

Observed company text must remain distinguishable from normalized employer
identity. Extracting a company name does not itself assign an employer cluster or
decide an organization role.

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

It groups observations believed to concern the same practical hiring
employer/location identity, whether or not the legal or canonical identity is
known. It represents recognition/identity grouping, not a vacancy's organization
role.

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

The relationship between a source observation and an employer cluster is a
recognition/identity relationship and should be represented explicitly. It may
result from automatic recognition or an explicit identity-linkage decision.
Neither outcome establishes that the cluster's organization is the employer for
the vacancy.

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

`USER_CONFIRMED` describes the observation-to-cluster identity relationship only.
It must not be interpreted as a human-confirmed organization role for any vacancy.
Employer-memory reuse may add conservative recognition or cluster membership to a
new vacancy without creating a `VacancyOrganizationRoleDecision` for it.

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

# 23. Employer Alias Evidence

An organization may be observed under multiple names. Alias evidence records an
identity linkage from an observed name to a known employer cluster.

Conceptually:

```text
EmployerAliasEvidence

id
aliasName
normalizedAliasName
employerClusterId
sourceAssignmentId
sourceType
createdAt
explanation
```

The evidence is backed by an identity assignment and may be active only while
that supporting assignment remains effective. Historical evidence is retained
for audit. Alias evidence assists future employer recognition but does not
decide the organization's role for any vacancy.

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
```

This is an identity conclusion, not an organization-role decision. A reviewer
may separately accept an identity link or alias; that human decision remains
distinct from deciding which organization plays the employer role on a vacancy.

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

`UserEmployerInteraction` is an earlier conceptual employer-level design, not the
implemented interaction record. Current private history uses vacancy-specific
`UserVacancyInteractionEvent` (section 45). Employer-level views aggregate it.

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

Current history lookup follows effective ACCEPTED/USER_CONFIRMED observation
assignments, with a conservative canonical relationship fallback; see
`M12.5-employer-history.md`. This updates the earlier M6.2 relationship-only rule. It summarizes immutable observation history, existing
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

Future conceptual types (not the current event enum) include:

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

Current interaction records reference `CanonicalVacancy`, not `EmployerCluster`.
Employer history is a derived association across vacancies and effective memberships.
A future employer-only interaction may use a cluster without requiring resolved identity;
it must not replace vacancy-specific application history.

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

# 53. VacancyOrganizationRoleDecision

`VacancyOrganizationRoleDecision` is the authoritative, human-authored decision
about an organization's role on one `CanonicalVacancy`. It is not a general
confirmation of the organization identity or cluster membership.

Conceptually:

```text
VacancyOrganizationRoleDecision

id
canonicalVacancyId
identityKey
organizationName
normalizedName
role
previousDecisionId?
basis
overrideAcknowledged
createdAt
```

Possible roles include:

```text
EMPLOYER
STAFFING_AGENCY
RECRUITER
CLIENT
CONSULTANCY
```

Each decision belongs to one vacancy and one organization identity key. A
decision for one vacancy does not transfer to another because of a matching name,
cluster, source tenant, prior employer knowledge, or alias. A changed role is an
explicit new decision linked to the prior decision; source recapture alone does
not replace it.

The decision is separate from:

* source-observed company text and extracted organization evidence;
* employer identity resolution and alias evidence;
* observation-to-cluster assignment and employer-memory reuse.

Do not use a generic confirmation record or an identity assignment as a
substitute for this vacancy-specific decision.

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
MARKET EVIDENCE DOMAIN (NOT AUTOMATICALLY SHAREABLE)

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
VacancyOrganizationRoleDecision
application-related metadata
personal recruiter notes
```

All data is local by default. Captured material may contain personal information or
source licensing restrictions; a market-domain label does not authorize sharing. CVs,
letters, contacts, notes, tasks and application history remain private regardless of
public source-code distribution.

---

# 56. Ownership Rules

A useful conceptual ownership model is:

```text
SourceObservation
owns no inference

EmployerCluster
owns recognition/identity grouping, not vacancy organization roles

Employer
owns canonical resolved identity

VacancyOrganizationRoleDecision
belongs to one CanonicalVacancy and records a human role decision

RecruitmentCampaign
belongs to EmployerCluster

UserEmployerInteraction
conceptual employer-level record; current UserVacancyInteractionEvent belongs to CanonicalVacancy
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
historical VacancyOrganizationRoleDecision
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

The following is the historical recognition-prototype proposal, not the current
schema or the CRM implementation backlog (see section 78):

```text
SourceObservation
SourceReference

EmployerCluster
ObservationClusterAssignment

Employer
EmployerAliasEvidence
EmployerLocation

EmployerCandidate
IdentityResolution

Recruiter

PublicationFamily
PublicationFamilyMembership

UserEmployerInteraction

VacancyOrganizationRoleDecision
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

CanonicalVacancy
      │
      └──────────────► VacancyOrganizationRoleDecision
                         (human-authored, vacancy-specific)
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

EmployerCluster
1 → many EmployerAliasEvidence records

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

This preserves geographic relevance in employer context across CRM opportunities.

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

Prior employer knowledge/memory may be derived from earlier assignments and
identity evidence. Conservative reuse may inform recognition or cluster
membership for another vacancy; it does not create that vacancy's
`VacancyOrganizationRoleDecision`.

Inbox and Review may expose the same read-only employer presentation derived from
source evidence, recognition and identity relationships, prior employer knowledge,
and any vacancy-specific role decision. This presentation creates or mutates none
of those records. Do not persist a separate employer-display state or use it as
an authoritative domain decision; the underlying evidence and decisions remain
the source of truth.

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

# 72. Storage neutrality and current persistence

The domain boundaries remain storage-independent. The actual implementation uses
local SQLite through repository adapters and migrations; storage is not an undecided
runtime choice. Alternative database adapters are optional future work, not an
installation requirement. M19.1 establishes managed immutable document copies
behind a storage port (section 81); desktop packaging and full backup remain future work.

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

**D11 — Displayed company text is source evidence, not resolved employer identity.**

**D12 — Observation-to-cluster membership records recognition/identity grouping, not an organization role.**

**D13 — Alias evidence links organization identities and does not assign vacancy roles.**

**D14 — Reusing employer memory does not create a human organization-role decision for another vacancy.**

**D15 — `VacancyOrganizationRoleDecision` is the authoritative human role decision for one vacancy.**

**D16 — Role decisions survive source recapture; changing a role requires an explicit new decision.**

**D17 — Ambiguous employer candidates remain alternatives until a person makes a decision.**

**D18 — Employer presentation in Inbox and Review is derived and read-only, not persisted domain state.**

---

# 75. Foundational Data Model Rules

The following rules are established by Data Model v0.1.

**DM1 — `SourceObservation` is the immutable foundation of captured evidence.**

**DM2 — Normalized evidence is derived from, not substituted for, source observations.**

**DM3 — `EmployerCluster` is the primary recognition-memory entity.**

**DM4 — Employer clusters may remain permanently unresolved.**

**DM5 — `Employer` represents resolved real-world identity, not anonymous hiring activity.**

**DM6 — Observation-to-cluster membership is a recognition/identity relationship with confidence and provenance, not an organization role.**

**DM7 — Employer candidates and identity resolutions preserve alternative hypotheses and history.**

**DM8 — `EmployerLocation` is distinct from the employer's corporate identity.**

**DM9 — Recruiters are independent entities and roles.**

**DM10 — Publication families are inferred groups, not destructive deduplication.**

**DM11 — Recruitment campaigns are separate from publications and may represent multiple positions.**

**DM12 — Current user interactions attach to canonical vacancies; derived employer history follows supported memberships without moving or rewriting private events.**

**DM13 — Historical observations, confirmations, and recognition changes should normally be additive.**

**DM14 — Recalculable inference must remain distinguishable from immutable evidence.**

**DM15 — Provider-specific identifiers and schemas belong at the source boundary, not in the core domain.**

**DM16 — Displayed company evidence, organization identity, cluster membership, and vacancy role are separate concepts.**

**DM17 — Identity and alias linkage cannot serve as a vacancy-specific organization-role decision.**

**DM18 — Prior employer-memory reuse may inform recognition but does not confirm the role on a new vacancy.**

**DM19 — `VacancyOrganizationRoleDecision` is human-authored, vacancy-specific, and independent of cluster membership.**

**DM20 — Only an explicit new role decision changes a previously decided vacancy role; recapture alone does not.**

**DM21 — Derived employer presentation is read-only and has no persisted state entity.**

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

employers/
  Employer
  EmployerAliasEvidence
  EmployerLocation
  Recruiter

organizations/
  VacancyOrganizationRoleDecision

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

The repository and TypeScript implementation already exist. The next work follows
ARCHITECTURE section 91; the sections above remain conceptual guidance rather than
a migration specification.


# 78. CRM core gap analysis (M18.1)

Audit baseline: `afb16e98d824e6670e74c9e357665fe23efa4041`. No live database was
opened. Evidence: `src/domain/user/UserVacancyInteractionEvent.ts`,
`src/infrastructure/persistence/SqliteUserVacancyInteractionRepository.ts`,
`src/domain/vacancies/CanonicalVacancy.ts`, migration files 001-011,
`src/application/user/`, `ui/src/ReviewPage.tsx` and `ui/src/InboxPage.tsx`.
Concept names below describe responsibility; they do not prescribe new tables.

| Concept | Classification | Existing representation and later boundary |
| --- | --- | --- |
| Vacancy/opportunity identity and market facts | Adequately represented as foundation | CanonicalVacancy, source/exact-identity claims and evidence references; compose private CRM records by stable canonical ID |
| Application / JobApplication | Partial | APPLIED events and optional channel/source reference; no preparation record or separate application-attempt lifecycle. Decide whether repeat applications need their own identity before adding an entity |
| Application/pipeline state | Partial | NEW or latest interaction type; richer process state must remain distinct from latest activity, recognition and archive |
| CV/Resume and MotivationLetter/CoverLetter | Implemented narrowly (M19.1) | Shared ApplicationDocument with CV/MOTIVATION_LETTER kind and name; richer language/variant metadata deferred |
| DocumentVersion | Implemented (M19.1) | Immutable version metadata and managed exact bytes; SHA-256 verifies integrity; future backups must include files |
| VacancyApplicationDocument association | Selected-version history implemented (M19.1) | Current/prior exact-version selections by document kind; actual sending/submission proof deferred |
| Contact | Partial conceptual coverage; missing CRM implementation | RecruitmentContact/ContactPoint were documented; person/contact evidence extraction is not an editable contact library |
| VacancyContact relationship | Missing | Many-to-many private links with context/role; do not require one contact to belong to one vacancy |
| Interaction / Activity | Partial | Append-only vacancy events with occurredAt/recordedAt and typed metadata; extend deliberately for communication, documents, notes and links without losing historical events |
| Task / NextAction | Implemented narrowly (M18.4) | Multiple private vacancy actions with optional due instants, completion/cancellation and append-only schedule/lifecycle history; no contact linking |
| Reminder | In-app derived only (M18.4) | Independent action reminder time, replacement/dismissal history; no scheduler or delivery infrastructure |
| Interview/process event | Partial | INTERVIEW event supports stage; no scheduled/completed distinction, calendar time, participant or assignment tracking. Assess activity extension before adding a separate interview aggregate |
| Notes | Implemented (M18.2) | Dedicated append-only VacancyNote records, exposed in Review; no editing or interaction-state side effects |
| Outcome | Partial | OFFER/REJECTED/WITHDRAWN/CLOSED events; richer outcome detail and reason are not implemented |
| Priority | Implemented (M18.2) | Private canonical-vacancy preference: NONE, LOW, NORMAL, HIGH; independent of recognition confidence |
| Archive/restore | Adequately represented for current workflow | Migration 011 and cleanup service; archive is not an application outcome, and source recapture must not silently reopen it |

Current event types are REVIEWED, INTERESTED, APPLIED, CONTACTED, INTERVIEW, OFFER,
REJECTED, WITHDRAWN and CLOSED. The current state is NEW without events, otherwise
the latest event by occurredAt, recordedAt and ID. CONTACTED has optional direction
and contact method, not a Contact ID or communication body. Existing UI action
buttons and derived history summaries do not constitute the full future CRM timeline.

## CRM ownership and invariants for later implementation

- Canonical market facts remain separate from private opportunity tracking. Recognition failure/uncertainty never blocks private application activity.
- Preserve stable references across recapture/reprojection; never infer human role confirmation from task/application state or employer-cluster membership.
- Current pipeline state and chronological activity are distinct. Changing state adds auditable history; recording a call need not move the process backward.
- Contacts and document-library items have independent lifecycles. Vacancy links, submitted versions and activity references are private relationships.
- Past document usage must resolve to the version actually submitted after edits, renames, deletion of the external original, backup/restore and machine transfer. M19.1 uses managed copies; recording actual submission remains future work.
- Tasks describe intent; reminders describe alerts. Completion, cancellation, missed delivery, time zones and restart behavior need explicit semantics.
- Private notes and user contact details are never silently promoted into shared recognition evidence. Public GitHub source does not publish local records.
- Existing cleanup safeguards must be extended before introducing new dependent records; document/contact deletion must not silently break application history. User-directed privacy deletion remains possible.

The M18.1 gap audit itself introduced no entity, enum, table or schema migration. The next private
tracking increment and later pipeline decisions should reuse the current repository
and application boundaries rather than replacing evidence-backed canonical records.


# 79. Private opportunity priority and notes (M18.2)

VacancyCrmState is a private read model keyed by canonical vacancy ID, separate
from CanonicalVacancy market facts and SourceObservation. It contains current
priority and chronological notes. It is not application/process state, recognition
confidence, archive state, a next action, or interaction history.

Migration 012 adds:
- vacancy_crm_priority: one optional row per canonical vacancy; priority is NONE,
  LOW, NORMAL or HIGH. Missing row reads as NONE without a write.
- vacancy_notes: id, canonical_vacancy_id, text and server-recorded created_at.
  Notes are append-only; corrections are new notes. Text must be nonblank and at
  most 10,000 characters. Ordering is created_at then insertion order for ties.

A note request ID provides retry idempotence: the same vacancy/text returns the
existing note without changing its timestamp; reuse for different content is rejected.
There is no note edit or standalone delete command in this increment.
setVacancyPriority and addVacancyNote are explicit application commands; Review
reads CRM state through the existing workflow. Neither command writes captured
evidence, employer assignments or interaction events.

Recapture/reprojection and archive/restore preserve both tables. Single-capture
cleanup retains them. Guarded whole-vacancy deletion removes them by foreign-key
cascade, with a scoped cleanup guard permitting note deletion. Preview counts
include private CRM rows; changing priority or adding a note invalidates a prior
cleanup token. Priority is current mutable intent; note history is auditable.

# 80. Vacancy next actions and reminders (M18.4)

VacancyCrmRepository owns private scheduling state through getNextActions and
explicit application commands: createVacancyNextAction, completeVacancyNextAction,
cancelVacancyNextAction, rescheduleVacancyNextAction, setVacancyActionReminder and
dismissVacancyActionReminder. These commands never change process state,
interactions, priority, notes, archive state, employer recognition or source identity.

Migration 014 adds two tables:
- vacancy_next_actions: immutable ID, canonical vacancy ID, description, initial
  optional due_at and server-recorded created_at. Multiple actions per vacancy.
- vacancy_action_changes: immutable request ID, canonical vacancy/action IDs,
  typed operation, optional due_at/remind_at/reminder_id and server-created timestamp.
  Composite foreign keys enforce action/vacancy ownership.

The action projection folds changes in insertion order; creation and each change
remain visible in Review history. Completion/cancellation set lifecycle timestamps
without deleting anything; terminal actions cannot be rescheduled or changed.
Description editing and reopening terminal actions are deferred. Cancel and create
a replacement when needed.

A VacancyActionReminder is a distinct projection of a SET_REMINDER record, whose
request ID is its durable reminder ID. It has its own remindAt and createdAt,
and derives dismissedAt or supersededAt from later commands. Setting a new reminder
supersedes the earlier one while retaining its history. One reminder per action is
current at a time; a reminder may exist without a due date or before/after that date.
Completion/cancellation suppress reminder-due signaling but retain reminder history.

All timestamps are UTC ISO instants with milliseconds and Z. Review accepts local
date/time, labels the browser time zone and converts to UTC before submission;
invalid local times (including a daylight-saving gap) are rejected. A repeated
daylight-saving hour uses the browser's earlier-occurrence interpretation.
No date-only/end-of-day semantics are implied. API timestamps without a time zone
or normalized UTC representation are rejected.

Review derives status from a single injectable current-time value:
- ACTIVE without dueAt: NONE; future dueAt: UPCOMING.
- dueAt exactly equals now: DUE; dueAt earlier than now: OVERDUE.
- COMPLETED/CANCELLED: INACTIVE for due-state purposes, excluded from overdue count.
- reminderDue: ACTIVE plus a current, undismissed reminder with remindAt <= now.

These derived flags are never persisted. They refresh when Review is read, after
commands, or with Refresh action status. An open idle page does not update itself.
There is no scheduler, background polling, calendar integration or desktop notification.
Archived vacancies retain their actions and can still show due signals in Review.

Creation uses requestId as action ID. Each subsequent command has its own request
ID. An identical retry returns without appending, preserving original timestamps
and never replaying an old schedule over a later one. Reuse for a different payload
is rejected. Validation and append occur in one IMMEDIATE transaction.

Both tables reject updates and permit deletion only through guarded whole-vacancy
cleanup. Recapture, archive/restore and single-capture deletion preserve them.
Whole-vacancy previews count actions and action/reminder history; every appended
change invalidates existing cleanup tokens.


# 81. Application documents and version selections (M19.1)

ApplicationDocument != ApplicationDocumentVersion != VacancyApplicationDocument.
All are private CRM information, never source or employer-recognition evidence.

Migration 015 adds:

- `application_documents`: shared logical ID, kind (`CV` or `MOTIVATION_LETTER`),
  name and server UTC creation timestamp. A document is not owned by a vacancy.
- `application_document_versions`: immutable UUID, document ID, per-document
  sequential version number, original filename (metadata only), optional media
  type (untrusted metadata), byte size, SHA-256, relative storage key, UTC creation
  timestamp, unique import request ID and request fingerprint.
- `vacancy_application_documents`: immutable association/request ID, canonical
  vacancy ID, exact version ID and UTC creation timestamp. It references a version,
  never a floating logical document or external file path.

The latest association in insertion order for each document kind is current for
that vacancy. Earlier selections remain queryable, including replacement by a
version of another logical document of the same kind. No history row is overwritten.
Association means selected/intended, not proof of sending or an application event.

Version numbering and metadata insertion occur in an IMMEDIATE transaction.
An identical import retry returns the original version and verifies its bytes;
conflicting request-ID reuse is rejected. Association retries are similarly
idempotent and do not reactivate superseded selections. Source paths are not stored.
File integrity is checked on library reads, selection and download; missing/corrupt
files remain visible as such and do not silently change identity or disappear.

Updates to all three base tables are rejected. M19.2 projects logical rename/archive
state from its separate change ledger (section 82). Standalone document/version deletion is
not supported. Associations cascade only during guarded whole-vacancy deletion;
shared documents, versions and bytes remain, even if no vacancy currently uses them.
Recapture, archive/restore and single-capture deletion preserve associations.
Association additions invalidate cleanup approval tokens. Priority, notes, process
state, next actions, interactions and organization decisions are unchanged.


# 82. Logical document lifecycle (M19.2)

Logical display metadata can change; immutable document versions cannot.
Migration 016 adds `application_document_changes`: request ID, logical document ID,
operation (`RENAME`, `ARCHIVE`, `RESTORE`), name only for rename, and server UTC
creation time. Rows are append-only with foreign-key and update/delete guards.
No existing document, version or association is rewritten by migration.

The logical document read model folds these commands in insertion order to derive
its current name and nullable `archivedAt`. Initially all M19.1 documents are active.
Archive/restore is independent of vacancy archive and changes no files or versions.
Renaming changes the current displayed name, including in historical views; no
historical name snapshot is implied. Exact version IDs/metadata remain unchanged.

Explicit application commands execute in IMMEDIATE transactions. Identical request
retries return without appending or replaying an old change over newer intent.
Reusing a lifecycle request ID for another document, operation or name is rejected.
Archived documents reject new imports and associations until restored. Retries of
already-successful imports/associations remain idempotent even after archive.

Version views expose `referenceCount` (all retained association rows) and
`currentReferenceCount` (latest association per vacancy/document kind). Their
difference is the superseded-reference count. Counts include archived vacancies,
archived documents and all other vacancies, not just the visible Review or Inbox.
Repeated selections are separate references; the count is not unique-vacancy count.

Permanent deletion is deferred for **all** logical documents and versions, including
unreferenced ones. Existing database guards remain; no destructive application,
HTTP or UI command is provided. Removing a vacancy's last association reduces the
reference count but does not delete library metadata, lifecycle history or files.

## M20.1 — Implemented private contacts

`Contact` is a reusable user-owned person identity: display name, job title, notes and UTC creation/archive timestamps. Multiple editable `ContactMethod` records preserve entered EMAIL, PHONE, LINKEDIN_URL or OTHER values. Names/emails never automatically merge identities; duplicate warnings are deferred.

`VacancyContact` links a canonical vacancy to a contact with its own role: RECRUITER, HIRING_MANAGER, HR, INTERVIEWER, REFERRAL, EMPLOYEE_CONTACT, AGENCY_CONSULTANT or OTHER. Ending sets endedAt and preserves earlier links. Contacts may be edited, archived and restored, but not permanently deleted.

Contact != Organization; contact role != VacancyOrganizationRoleDecision; contact method != Interaction. Older RecruitmentContact/ContactPoint sections are conceptual. Organization links are deferred: current optional organization IDs lack a reusable organization table/FK; employer clusters and agency-role memory are not interchangeable with organization identities. Interaction/contact and action/contact links were deferred in M20.1 and are implemented in M20.2 below; historical metadata remains unchanged.

Migration 017 adds contacts, contact_methods, vacancy_contacts and contact_requests (retry fingerprints/result IDs). Each command uses an IMMEDIATE transaction. Identical retries do not replay earlier edits; conflicting request reuse fails. Captured person evidence never populates this library automatically.

## M20.2 — Contact references on private activity

Interactions and next actions optionally reference Contact. Migration 018 adds immutable `interaction_contact_references` and `action_contact_references` with contact FKs (RESTRICT), plus interaction request receipts. Existing event/action tables, timestamps and metadata are unchanged; old records remain contactless. No backfill or name matching occurs.

New references require an active contact and an active VacancyContact link for the same vacancy. Existing references survive contact archive, relationship ending and vacancy archive/restore. Contact is fixed at event/action creation; lifecycle changes cannot reassign it. Reads resolve the current contact name and archive status, not a historical name snapshot. Renaming therefore changes the displayed name while retaining the same person ID.

CONTACTED, APPLIED, INTERVIEW, OFFER, REJECTED, WITHDRAWN and CLOSED may reference people; REVIEWED and INTERESTED remain personal review decisions. No new interaction taxonomy is introduced. Existing metadata is retained unchanged. Reminder ownership stays with the action. Contact identity != interaction != vacancy relationship != next action.

## M20.3 — Unified vacancy activity projection

VacancyActivityItem is a read model, not a persisted entity. It retains a namespaced stable ID, vacancy ID, kind, source model/record ID, source timestamp, presentation text and optional resolved Contact. Interactions use occurredAt; notes, process transitions, actions/changes and document associations use createdAt. Contact link/end events use createdAt/endedAt. Equal timestamps sort by code-point activity ID; default ordering is newest-first.

No event is inferred from current priority, default DISCOVERED state, recognition state, document/contact archive flags or derived reminder-due status. Vacancy archive stores only its current archived_at/revision, so archive/restore history cannot be reconstructed and is omitted. No archive-history table is added.


### M21.1 — Daily work queue

Today is a non-persisted operational view across unarchived opportunities. It is not a scheduler or a second task/reminder system; most edits remain in Review. Browser timezone defines calendar days; stored instants remain UTC. Refresh recomputes against server time, without background jobs or notifications.

Action precedence is overdue, reminder due, due today, then upcoming through the next seven local calendar days (including that day's end). Existing action/reminder derivation remains authoritative. Distinct actions stay distinct. Missing-action precedence is HIGH priority, stale awaiting response, then general active opportunity. REJECTED, WITHDRAWN and NO_LONGER_RELEVANT suppress missing-action prompts; OFFER remains active. Explicit active actions still surface even in terminal process states.

Awaiting response is stale after seven local calendar-day boundaries without private activity, and only without an active action. This configurable review heuristic is not a universal follow-up deadline and creates no task. Activity uses interaction occurredAt, transition/note/action/change/document-selection createdAt and contact relationship creation/end timestamps, matching the activity timeline sources. Canonical createdAt is the fallback. Public recapture, priority edits, recognition churn, contact renames and document-library lifecycle edits do not reset this clock.

Category ordering: overdue, reminder due, today, HIGH without action, stale awaiting response, upcoming, general without action. Within categories: earliest relevant instant, HIGH/NORMAL/LOW/NONE priority, stable ID. Equal-time ordering is deterministic. The SQLite adapter batch-loads a consistent snapshot without loading Review per vacancy, source payloads or document bytes. No queue records, migrations or cleanup-token inputs are introduced. Archive excludes; restore reuses preserved CRM state. Company labels use existing canonical employer/displayed-company projections and imply no new confirmation.


### M21.2 — Existing commands from Today

Today remains a derived queue and now offers Complete action, Cancel action and Dismiss reminder through the same application commands and HTTP endpoints as Review. An action-backed item represents an active action; an optional exact current due reminder ID enables dismissal independently of queue category. Vacancy-level attention items remain navigation-only. No dashboard mutation model, schema or scheduler is added.

Each command attempt is followed by a full queue read, including failures whose response may have been lost. Summary counts, category changes and ordering come only from that read. Per-action pending guards prevent duplicate clicks; uncertain retries retain the request ID, including when the command succeeded but refresh failed. Conflicts remain visible and trigger refresh. Cancellation uses no modal, consistent with Review; history is retained. Dismissal never completes an action. Existing action-change history naturally updates private staleness. Archive races obey existing commands without unarchiving. Contact-detail deep links remain deferred because Contacts has no detail route.
