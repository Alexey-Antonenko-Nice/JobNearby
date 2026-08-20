# Job Nearby — Product Specification

**Version:** 0.1
**Status:** Working Draft
**Project:** Job Nearby
**License intention:** Free and Open Source Software

## 1. Purpose

Job Nearby is a company-first, multi-source job-search intelligence application.

Its purpose is to help a job seeker obtain a suitable job offer while minimizing unnecessary search effort.

Job seekers encounter vacancy publications through many independent sources such as job boards, recruitment agencies, public employment services, company career pages, email alerts, and other channels.

These publications do not provide a reliable representation of the real labor market by themselves.

The same recruitment activity may:

* appear on several job boards;
* be republished repeatedly;
* be published by a recruitment agency instead of the actual employer;
* appear under different company names;
* hide the employer completely;
* represent several positions in a single advertisement;
* produce several different advertisements for the same recruitment campaign.

As a result, counting or browsing vacancy publications alone can produce a distorted picture of actual employer demand and cause the job seeker to repeatedly investigate the same companies or opportunities.

Job Nearby converts these fragmented observations into a persistent, company-centered representation of the job market.

---

## 2. Core Product Principle

Job Nearby is **not primarily a vacancy aggregator or job board**.

The principal user-facing entity is the **employer**, represented at the physical location relevant to employment and recruitment.

Vacancy publications are treated as **observations and evidence about employer hiring activity**.

The basic conceptual transformation is:

```text
Vacancy Publications
        ↓
Evidence Extraction
        ↓
Publication Recognition
        ↓
Employer Clustering
        ↓
Employer Identification
        ↓
Recruitment Activity
        ↓
Company Labor-Market Profile
        ↓
Job-Seeker Interaction
```

The application should help answer:

> Which real company is behind this vacancy publication?

> Have I encountered this company before?

> What do I already know about this company?

> Have I already researched, contacted, or applied to it?

> Is this publication new, or have I probably seen the same recruitment activity elsewhere?

> What does the company's observed recruitment history tell me about its demand for workers?

---

## 3. Primary User Goal

The primary goal is not to maximize the number of vacancies shown to the user.

The goal is to improve **job-search efficiency**.

Conceptually:

```text
Job Search Efficiency
        =
Probability of obtaining an acceptable job offer
        /
Job-seeker effort
```

This is a product objective rather than an immediately computable metric.

Job Nearby should therefore prefer reducing unnecessary work over maximizing displayed content.

For example:

```text
30 fresh vacancy publications
        ↓
23 probable employers
        ↓
14 already known employers
 9 genuinely new employers
        ↓
User investigates primarily
the 9 new employers
```

This may be considerably more useful than presenting all 30 publications independently.

---

## 4. Company-First Model

For Job Nearby, a company is represented at the level useful to a job seeker.

The system is not primarily concerned with reconstructing complete corporate ownership or management structures.

The relevant entity is an employer or employer location that:

* employs or potentially employs workers;
* has or is associated with a physical workplace;
* conducts recruitment directly or through an intermediary;
* can potentially be contacted or investigated by the job seeker.

Legal entities, corporate groups, SIREN/SIRET identifiers, subsidiaries, establishments, and similar information may be retained when useful for identification and deduplication, but they are supporting information rather than the primary user experience.

---

## 5. Employer Identity Is Not Required

A fundamental Job Nearby principle is:

> **An employer can exist in the system before its name is known.**

Example:

```text
UNKNOWN EMPLOYER #17

Location:
Molsheim

Characteristics:
International industrial group
Highly automated manufacturing site

Observed recruitment:
Maintenance technicians

Identity:
Unresolved
```

If another publication later contains a similar employer fingerprint, Job Nearby may recognize it as belonging to the same employer even though the employer remains anonymous.

Later evidence may resolve the identity:

```text
UNKNOWN EMPLOYER #17
        ↓
XYZ Industries France
```

All historical observations associated with the unresolved employer are then retained as part of the resolved employer history.

---

## 6. Employer Clustering and Employer Identification

Job Nearby treats these as two different inference problems.

### 6.1 Employer clustering

Question:

> Do these publications probably concern the same real employer?

Example:

```text
Publication A ──┐
Publication B ──┼──► UNKNOWN EMPLOYER #17
Publication C ──┘
```

The employer's actual name may remain unknown.

### 6.2 Employer identification

Question:

> Which real company does this employer cluster represent?

Example:

```text
UNKNOWN EMPLOYER #17
        ↓
Candidate evidence
        ↓
Groupe SIAT
```

The confidence values for these conclusions must remain independent.

Example:

```text
sameEmployerConfidence = 0.96
identityConfidence     = 0.35
```

This means Job Nearby is highly confident that several publications concern the same employer but does not yet know reliably which company it is.

---

## 7. Multi-Source by Design

Job Nearby must not depend conceptually on one vacancy provider.

Potential sources include:

* Indeed;
* Meteojob;
* Jooble;
* France Travail;
* HelloWork;
* recruitment agencies;
* employer career pages;
* email vacancy alerts;
* public APIs;
* permitted feeds;
* manually supplied vacancy information;
* future sources not yet known.

Source-specific mechanisms should feed a common internal observation model.

Conceptually:

```text
Indeed ──────────────┐
Meteojob ────────────┤
Jooble ──────────────┤
France Travail ──────┤
Company websites ────┤
Manual capture ──────┤
Future sources ──────┘
                     ↓
             Source Observation
```

The domain model must therefore not contain assumptions specific to France Travail, Indeed, or another individual provider.

---

## 8. Source Observation

A source observation represents what Job Nearby actually observed at a particular moment.

A URL alone is not sufficient evidence.

Job-board links may:

* expire;
* redirect;
* become inaccessible;
* point to a generic search page after the vacancy closes;
* contain temporary email tracking information;
* change their displayed content.

Job Nearby should therefore preserve the useful information available when the publication is captured.

Typical observation data may include:

```text
source
source URL
source vacancy identifier
capture timestamp

displayed title
displayed company
location
description
salary
contract information
publication date
recruiter
contact information

source-specific metadata
raw captured content
```

Not all fields will be available for every source.

---

## 9. Evidence Preservation

Job Nearby must distinguish between:

**Observation**

and

**Inference**.

The basic rule is:

```text
Source Data
    ↓
Immutable Observation
    ↓
Normalized Evidence
    ↓
Inference
    ↓
Domain Knowledge
```

Original observations should not be destroyed merely because the system has normalized, deduplicated, or classified them.

This enables:

* future reprocessing;
* improved recognition algorithms;
* correction of incorrect inference;
* auditing;
* comparison of alternative algorithms;
* historical analysis;
* open-source experimentation.

---

## 10. Provenance

Important facts and conclusions should retain information about their origin.

For example:

```text
Company address
Source: SIRENE

Vacancy publication
Source: Meteojob

Recruitment potential
Source: external public dataset

Employer identity
Derived by: Job Nearby recognition engine

Identity confirmation
Confirmed by: user
```

Job Nearby should avoid representing inferred information as directly observed fact.

---

## 11. Recruiter Is Not Necessarily the Employer

Recruitment agencies and intermediaries must be distinguished from actual employers.

Example:

```text
Publication:
Technicien de Maintenance

Displayed company:
Page Personnel

Recruiter:
Page Personnel

Actual employer:
Unknown industrial company

Workplace:
Obernai
```

Job Nearby must not automatically interpret the displayed recruitment agency as the employer.

The conceptual roles are:

```text
Publication
     │
     ├── Recruiter
     ├── Employer
     └── Workplace
```

These may refer to the same organization/location for direct recruitment, or to different entities when recruitment is outsourced.

---

## 12. Publication Duplication

Job Nearby distinguishes several forms of apparent duplication.

### 12.1 Publication duplicate

The same or substantially identical advertisement appears through several channels.

Example:

```text
Meteojob publication ─┐
HelloWork publication ├──► same publication family
Jobijoba publication ─┘
```

### 12.2 Recruitment duplicate

Different publications may represent the same underlying recruitment activity.

This is a more difficult inference problem.

### 12.3 Employer duplicate

Different publications or names may refer to the same employer.

Example:

```text
ABC Industrie
ABC Industries SAS
ABC Group Strasbourg
        ↓
same employer/location
```

These forms of duplication must not be treated as the same problem.

---

## 13. Publication Family

A Publication Family groups publications believed to be copies, syndications, or republications of substantially the same advertisement.

Example:

```text
Publication Family #42

Meteojob
HelloWork
Jobijoba
Recruitment agency site
```

All original publications remain preserved.

Publication-family detection reduces distortion without losing information about where and how the advertisement was distributed.

---

## 14. Recruitment Campaign

Real-world examples show that the relationship:

```text
one advertisement = one vacant position
```

cannot be assumed.

One advertisement may recruit several employees.

Several advertisements may support one recruitment campaign.

Repeated advertisements may indicate:

* continuous recruitment;
* several open positions;
* expansion;
* high employee turnover;
* difficulty recruiting;
* automatic republication;
* an unfilled position.

Job Nearby therefore introduces the conceptual entity **Recruitment Campaign**.

A recruitment campaign represents inferred employer hiring activity and may contain one or more publication families.

The exact number of positions may remain unknown.

---

## 15. Employer Fingerprint

Anonymous employers may sometimes be recognized through combinations of characteristics.

Potential fingerprint evidence includes:

* location;
* industrial sector;
* company size;
* approximate employee count;
* products;
* manufacturing processes;
* machinery;
* technologies;
* shift pattern;
* maintenance-team size;
* energy infrastructure;
* unusual terminology;
* required languages;
* salary structure;
* benefits;
* recruitment agency;
* job responsibilities;
* related vacancies;
* career-page information;
* historical observations.

Individual clues may be weak.

A combination can provide strong identification evidence.

Example:

```text
Strasbourg
+ paper manufacturer
+ approximately 160 employees
+ European market
+ large paper machine
+ biomass boiler
+ wastewater treatment
+ electricity generation
        ↓
strong employer fingerprint
```

---

## 16. Probabilistic Recognition

Recognition must be probabilistic rather than destructive.

Job Nearby should be capable of expressing:

```text
Employer candidate A    82%
Employer candidate B    13%
Unknown                  5%
```

Confidence should accompany significant inferred relationships.

A low-confidence inference should not silently overwrite evidence.

When confidence is insufficient, the correct result is:

```text
UNRESOLVED
```

rather than a forced company identification.

---

## 17. Human Confirmation

The user should be able to:

* confirm an employer identity;
* reject an employer identity;
* merge employer clusters;
* separate incorrectly merged clusters;
* mark publications as related;
* mark publications as unrelated;
* correct extracted information.

Human confirmation becomes part of the evidence history.

The system should distinguish between:

```text
algorithmically inferred
```

and

```text
user confirmed
```

information.

---

## 18. Employer Labor-Market History

Each employer accumulates an observed hiring history.

Potential information includes:

* first observed hiring activity;
* most recent hiring activity;
* number of observed publications;
* publication families;
* recruitment campaigns;
* occupations sought;
* skills sought;
* locations;
* recruitment frequency;
* recruitment channels;
* recruitment agencies used;
* persistent demand patterns.

Historical evidence must be preserved rather than replacing previous observations with the latest value.

---

## 19. User Interaction History

The user's relationship with an employer is distinct from the employer's labor-market history.

Example statuses or events may include:

```text
discovered
researched
interesting
not interesting
contacted
application prepared
application sent
reply received
interview
rejected
offer received
follow-up required
```

This should be represented as an event/history model rather than merely one permanent status wherever practical.

Example:

```text
Employer: Company A

Labor-market history:
  7 publications observed
  repeated maintenance recruitment

User history:
  researched       12 Aug
  application sent 14 Aug
  reply received   18 Aug
```

---

## 20. Primary MVP Workflow

The first useful Job Nearby workflow is:

```text
User encounters vacancy
        ↓
Capture/import publication
        ↓
Preserve source observation
        ↓
Extract and normalize evidence
        ↓
Search existing employer clusters
        ↓
Existing employer?
   /             \
 YES              NO
  │                │
attach         create provisional
observation    employer cluster
  │                │
  └───────┬────────┘
          ↓
Attempt employer identification
          ↓
Retrieve user history
          ↓
Present result
          ↓
User confirms/corrects
          ↓
Preserve new knowledge
```

---

## 21. MVP User Result

The first version should be able to produce results such as:

```text
COMPANY RECOGNIZED

Groupe SIAT — Urmatt

Identification confidence:
Very high

Company already known:
YES

Previous publications:
7

Recent recruitment:
Maintenance technicians

Your history:
Not contacted

Latest publication:
Possibly part of an existing
recruitment campaign
```

or:

```text
EMPLOYER UNRESOLVED

Unknown Employer #17 — Molsheim

Employer cluster already known:
YES

Previous publications:
4

Probable recruitment:
Several maintenance technicians

Actual company:
Not reliably identified

Your history:
Already investigated
```

The second result is still useful.

---

## 22. Initial Capture Strategy

The first implementation does not require automatic access to every vacancy provider.

Potential initial ingestion mechanisms include:

* manual text paste;
* manual URL submission;
* browser-based capture;
* browser extension;
* email import;
* source APIs where available and appropriate.

A browser extension may eventually provide a particularly useful workflow:

```text
User views vacancy
        ↓
Add to Job Nearby
        ↓
Visible vacancy information captured immediately
        ↓
Recognition performed
        ↓
Existing company/history shown
```

Source-specific legal and technical restrictions must be investigated before implementing automated capture or redistribution.

---

## 23. Labor-Market Analytics

Labor-market analytics are an important long-term function but are not required for the first MVP.

Accumulated observations can eventually support company analytics such as:

```text
Hiring activity
Persistent demand
Occupations sought
Skills sought
Recruitment frequency
Recruitment channels
Recruitment trends
Current campaigns
Historical campaigns
```

This transforms the accumulated job-search memory into a representation of the local labor market.

---

## 24. Company-First User Experience

The eventual primary interface should emphasize companies rather than vacancy counts.

Conceptual example:

```text
BLUE PAPER — Strasbourg

Distance:
7.2 km

Hiring activity:
High

Observed occupations:
Maintenance technician
Electrical technician
Energy technician

Observed publications:
12

Recruitment pattern:
Persistent technical recruitment

Latest observation:
4 days ago

Contactability:
Good

Your status:
Not yet contacted
```

Individual publications remain accessible as supporting evidence.

---

## 25. Geographic Model

Employer locations should be geocoded when reliable location information is available.

This eventually enables:

* nearby-company discovery;
* commuting-distance analysis;
* employer maps;
* geographic labor-market analysis;
* regional demand patterns.

The geographic model must distinguish when possible between:

* employer address;
* workplace;
* recruitment office;
* approximate vacancy location.

These locations are not necessarily identical.

---

## 26. External Data Enrichment

Job Nearby may enrich observations using external authoritative or useful sources.

For France these may include, among others:

* SIRENE/SIRET establishment information;
* ROME occupation and skill classifications;
* geocoding services;
* France Travail vacancy data;
* hiring-potential datasets;
* public company information.

External sources should remain adapters/evidence providers rather than becoming assumptions embedded throughout the core domain model.

This enables future use outside France.

---

## 27. Open-Source Principle

Job Nearby is intended to be free and open source.

The architecture should therefore support:

* transparent inference;
* inspectable evidence;
* replaceable recognition algorithms;
* source adapters;
* community contributions;
* reproducible tests;
* documented decisions;
* extensibility to new countries and vacancy sources.

The application should avoid unnecessary dependence on proprietary services when an open alternative is practical.

If optional AI services are eventually used, core data structures should not depend on one AI provider.

---

## 28. Privacy Principle

Job Nearby contains two fundamentally different categories of information:

### Public labor-market observations

Examples:

* vacancy publications;
* public company information;
* public recruitment information.

### Private job-seeker information

Examples:

* companies investigated;
* applications;
* recruiter conversations;
* interview history;
* personal notes.

The architecture must keep these concerns separable.

Future collaborative or public datasets must not inadvertently expose a user's private job-search history.

---

## 29. MVP Scope

### Included

The initial MVP should concentrate on:

* multi-source vacancy observation;
* persistent capture;
* employer clustering;
* unresolved employers;
* employer identification;
* recognition confidence;
* company profiles;
* previous-publication detection;
* user/company interaction history;
* manual confirmation and correction;
* provenance preservation.

### Explicitly postponed

The initial MVP does not need:

* complete automatic collection of the labor market;
* perfect vacancy deduplication;
* perfect employer identification;
* automatic job applications;
* sophisticated career recommendations;
* salary prediction;
* full labor-market simulation;
* AI-generated application letters;
* comprehensive corporate ownership reconstruction;
* advanced job-seeker scoring;
* mobile applications;
* international support from day one.

These capabilities may be introduced later if supported by the evidence architecture.

---

## 30. Initial Development Strategy

Development should proceed in the following order:

```text
1. Product Specification
        ↓
2. Recognition Model
        ↓
3. Data Model
        ↓
4. Architecture
        ↓
5. Repository creation
        ↓
6. TypeScript project skeleton
        ↓
7. Test corpus from real publications
        ↓
8. Recognition prototype
        ↓
9. Minimal user interface
```

The real vacancy publications examined during initial reconnaissance should become anonymized or legally suitable **test scenarios** representing problems such as:

* directly identified employer;
* anonymous employer successfully identified;
* anonymous employer unresolved;
* recruitment agency versus employer;
* duplicate publication across sources;
* several vacancies in one recruitment campaign;
* same employer with different vacancy descriptions;
* expired tracking URL;
* conflicting employer candidates.

---

## 31. Success Criterion for the First MVP

The first MVP is successful if it meaningfully reduces repeated employer research during everyday job searching.

Given a newly encountered vacancy publication, Job Nearby should attempt to answer:

```text
WHO IS THIS EMPLOYER?

HAVE I SEEN THIS EMPLOYER BEFORE?

WHAT DO I ALREADY KNOW ABOUT IT?

HAVE I ALREADY TAKEN ACTION?

IS THIS PUBLICATION PROBABLY RELATED
TO SOMETHING I HAVE ALREADY SEEN?
```

It does not need to answer every question with certainty.

A correctly expressed:

```text
UNKNOWN
```

or:

```text
PROBABLY THE SAME EMPLOYER — 78%
```

is preferable to an unsupported definitive conclusion.

---

## 32. Foundational Architecture Rules

The following rules are established by Product Specification v0.1:

**Rule 1 — Company first**
Companies/employer locations are the primary user-facing entities.

**Rule 2 — Multi-source**
No individual vacancy provider defines the Job Nearby domain model.

**Rule 3 — Publications are observations**
A vacancy publication is evidence, not automatically a unique vacancy.

**Rule 4 — Preserve evidence**
Normalization and inference must not destroy original observations.

**Rule 5 — Preserve provenance**
Important information should retain its source.

**Rule 6 — Anonymous employers are valid entities**
An employer cluster may exist without a resolved company name.

**Rule 7 — Clustering and identification are independent**
Confidence that publications concern the same employer is separate from confidence in the employer's identity.

**Rule 8 — Recruiter ≠ employer**
Recruitment intermediaries must not automatically become employers.

**Rule 9 — Duplication has multiple meanings**
Publication duplication, recruitment duplication, and employer duplication are separate problems.

**Rule 10 — Recruitment may involve multiple positions**
Publication counts must not be interpreted directly as vacancy counts.

**Rule 11 — Inference is probabilistic**
Uncertainty and contradictory evidence must be representable.

**Rule 12 — Human correction is evidence**
User confirmations and corrections must be preserved.

**Rule 13 — Market history ≠ user history**
Employer hiring observations and private job-seeker interactions are separate domains.

**Rule 14 — Historical evidence matters**
New observations should normally extend history rather than overwrite it.

**Rule 15 — Unknown is a legitimate result**
Job Nearby must prefer unresolved identity to false certainty.

---

## 33. Next Specification

The next project document should be:

**`RECOGNITION_MODEL.md`**

It should define in detail:

* employer fingerprints;
* evidence features;
* employer clusters;
* candidate identities;
* publication-family detection;
* confidence representation;
* positive and negative evidence;
* contradictory evidence;
* human confirmation;
* cluster merge/split behavior;
* re-evaluation when new evidence arrives;
* recognition algorithm evolution;
* test scenarios and expected outcomes.

Only after the Recognition Model is understood should the concrete TypeScript domain model be finalized.
