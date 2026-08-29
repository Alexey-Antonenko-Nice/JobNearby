# Job Nearby — Recognition Model

**Version:** 0.1
**Status:** Working Draft
**Project:** Job Nearby
**Related document:** `PRODUCT_SPECIFICATION.md`

## 1. Purpose

The Job Nearby Recognition Model defines how observations from vacancy publications and external sources are transformed into conclusions about:

* publication relationships;
* recruiters;
* employer clusters;
* employer identities;
* employer locations;
* recruitment campaigns;
* previously encountered companies.

Recognition is not treated as simple string matching.

A vacancy publication may:

* name the employer correctly;
* name a recruitment agency instead;
* omit the employer;
* use a trading name;
* use a legal entity name;
* contain only indirect employer clues;
* reproduce another publication;
* describe several positions;
* contain inaccurate or outdated information.

The Recognition Model must therefore operate on **evidence, hypotheses, and confidence**.

Its fundamental principle is:

> **Job Nearby preserves observations as evidence and treats recognition results as revisable hypotheses.**

---

# 2. Recognition Questions

For every newly captured publication, Job Nearby should eventually be capable of asking several independent questions.

### Question A — Publication relationship

> Have we already observed this publication or substantially the same advertisement?

### Question B — Employer relationship

> Does this publication concern an employer we have already encountered?

### Question C — Employer identity

> Which real company or establishment is this employer?

### Question D — Recruitment relationship

> Does this publication belong to recruitment activity we have already observed?

These questions must not be collapsed into one generic "duplicate" decision.

---

# 3. Recognition Pipeline

The conceptual recognition pipeline is:

```text
New Source Observation
        ↓
Evidence Extraction
        ↓
Evidence Normalization
        ↓
Publication Matching
        ↓
Employer Fingerprint Construction
        ↓
Existing Employer-Cluster Search
        ↓
Employer-Cluster Assignment
        ↓
Employer Identity Resolution
        ↓
Recruitment-Campaign Analysis
        ↓
User-History Lookup
        ↓
Recognition Result
```

Each stage may produce uncertain results.

No stage should require all later stages to succeed.

For example, Job Nearby may successfully determine:

```text
same employer as previous publication
```

while still returning:

```text
actual employer identity unknown
```

---

# 4. Observations and Inferences

The model distinguishes strictly between **observed facts** and **derived conclusions**.

Example observation:

```text
Source: Meteojob
Displayed company: SKAYL
Location: Strasbourg
Description:
"PME alsacienne d'environ 160 collaborateurs..."
```

These values are evidence.

The conclusion:

```text
Actual employer = Blue Paper
```

is an inference.

The system must preserve both.

Conceptually:

```text
Observation
    ↓
Evidence
    ↓
Inference
```

An inference must never silently replace the evidence from which it was derived.

## 4.1 Vacancy Evidence Extraction

The first transformation after capture is provider-independent evidence extraction:

```text
SourceObservation
        ↓
VacancyEvidenceExtractor
        ↓
ExtractedVacancyEvidence
```

The extracted result may contain several organizations, locations, people,
provider-specific identifiers, and employer characteristics. Their roles remain
explicit: a displayed organization need not be the employer, and a displayed
location need not be the workplace. Every item retains its originating observation,
extraction method, value, and extraction confidence.

Extraction confidence answers whether information was correctly extracted or
interpreted. Employer-cluster match confidence answers whether an observation
belongs to a cluster. Employer-identity confidence answers whether the real employer
is known. These are separate confidence values and must not share decision policy.

Evidence extraction proceeds in deliberately separate layers: direct-field
extraction preserves structured source fields; explicit-text extraction recognizes
only narrowly stated facts such as named clients, recruiters, and workplaces;
semantic employer-characteristic and fingerprint extraction is deferred to a later
stage. Explicit-text rules remain deterministic and provider-independent.

Employer-characteristic evidence carries an ordinal specificity level describing
how distinctive the explicit fact is for recognition. Specificity is independent
from extraction confidence: a broadly shared fact can be extracted with high
confidence while remaining low-specificity. Characteristic contradictions and
their effect on candidate matching will be evaluated by a future matcher rather
than by the extractor.

Employer evidence comparison follows extraction and produces separate explainable
positive signals and contradictions. It preserves the evidence behind each result
without calculating a final score:

```text
evidence extraction
        ↓
evidence comparison
        ↓
dimension aggregation
        ↓
deterministic confidence calibration
        ↓
assignment policy
```

Missing evidence is neutral, intermediaries are not employer identity, and only a
small explicit set of incompatible concrete facts is contradictory at this stage.
Dimension aggregation summarizes correlated evidence using qualitative strengths
without losing the underlying signals, contradictions, or evidence references.
Exact characteristic evidence pairs are deduplicated, while distinct normalized
values may reinforce a dimension even when they share a category. Detecting semantic
correlation between different values is intentionally deferred to a later matcher.

The current employer-match confidence is a deterministic, policy-calibrated value
derived only from qualitative dimension assessments. It expresses confidence that
two observations belong to the same employer cluster, but it is not an empirically
calibrated probability. Assignment thresholds remain a separate, user-configurable
policy applied after confidence calculation.

For a candidate employer cluster, matching currently compares the new observation
against each historical observation assigned to that cluster. The cluster confidence
is the maximum supported historical-observation confidence, not an average and not
a synthesized cluster fingerprint. Candidate and historical order provide stable
tie-breaking. A derived cluster-level fingerprint may later optimize this process,
but historical source observations remain the canonical comparison scope.

## Recognition Benchmark Corpus

Job Nearby maintains a validation-only, human-labelled employer-recognition corpus
under `validation/employer-recognition`. Its compact sanitized vacancy excerpts and
expected relationship/action labels support reproducible evaluation without becoming
production truth. Exact numeric confidence is deliberately not a benchmark label.

The validation roadmap is M3.3.1 corpus integrity, M3.3.2 automated matcher
evaluation, M3.3.3 explainability reporting, and M3.3.4 evidence-led improvements.

```text
Benchmark Corpus
        ↓
Validation Harness
        ↓
Observed failures
        ↓
future explainability report
        ↓
future recognition improvements
```

The validation harness measures the current production pipeline without feeding
benchmark labels into runtime recognition or modifying failed outcomes.

M3.3.3 adds a reproducible human-readable explainability report over structured
validation results. It separates observed facts from conservative engineering
hypotheses; diagnostic categories are not benchmark truth. M3.3.4 may use those
observations for targeted recognition improvements.

M3.3.4 expands deterministic employer-characteristic extraction only in response
to observed benchmark gaps, initially covering explicit family ownership, company
scale, wood/energy/heavy-industry activity, and precision machining. Benchmark
labels and downstream comparison, aggregation, calibration, and policy remain fixed;
recognition improvements must be measured against the unchanged corpus.

M3.3 is the regression-validation asset: its known cases may reveal gaps, and it
must remain green after recognition changes made in response to those gaps. M3.4
uses a separate, frozen holdout under `validation/employer-recognition-holdout` to
measure the frozen engine on cases that did not influence its design. Holdout
labels are established before evaluation, and M3.4.1 intentionally stores only the
data and integrity rules without running recognition against it. After results are
observed, those cases are no longer pristine unseen data for later model changes.

The M3.4 sequence is: M3.4.1 freezes the unseen corpus; M3.4.2 preserves the first
independent evaluation (5 of 9 scored cases passed, 55.6%); and M3.4.3 traces each
failure to the earliest pipeline stage where human-visible information stops
contributing. Failure diagnoses separate observed pipeline facts from engineering
hypotheses and do not represent implemented fixes or recognition-model changes.

---

# 5. Evidence

Evidence is any information that can contribute to recognition.

Evidence may originate from:

* vacancy publication content;
* vacancy metadata;
* source identifiers;
* URLs;
* recruiter information;
* employer websites;
* public registers;
* company career pages;
* public APIs;
* previously captured publications;
* user confirmation;
* external datasets.

Each significant piece of evidence should retain provenance.

---

# 6. Evidence Categories

Recognition evidence can be divided into several broad categories.

## 6.1 Identity Evidence

Examples:

* employer name;
* legal name;
* trading name;
* SIREN;
* SIRET;
* VAT number;
* company-domain email;
* official website;
* company career-page URL.

Strong official identifiers may resolve employer identity directly.

---

## 6.2 Geographic Evidence

Examples:

* street address;
* postal code;
* municipality;
* industrial zone;
* department;
* approximate location;
* workplace coordinates;
* recruiter location.

Geographic evidence is particularly important for distinguishing establishments belonging to the same corporate group.

---

## 6.3 Organizational Evidence

Examples:

* approximate employee count;
* subsidiary status;
* international group membership;
* SME status;
* French subsidiary;
* family-owned company;
* site size;
* maintenance-team size.

---

## 6.4 Industrial Evidence

Examples:

* industry;
* products;
* production processes;
* machinery;
* technologies;
* certifications;
* industrial infrastructure.

Examples from reconnaissance include:

```text
paper manufacturing
biomass boiler
wastewater treatment
automated production line
heavy industrial machinery
```

These can form powerful employer fingerprints.

---

## 6.5 Recruitment Evidence

Examples:

* recruiter;
* recruitment agency;
* recruiter reference number;
* occupation;
* contract type;
* salary;
* shift pattern;
* required languages;
* required qualifications;
* unusual benefits;
* training duration;
* travel requirements.

---

## 6.6 Textual Evidence

Examples:

* identical sentences;
* distinctive phrases;
* uncommon vocabulary;
* paragraph structure;
* copied spelling errors;
* identical requirements;
* similar descriptions.

Text similarity is useful but must never be treated as sufficient proof of employer identity by itself.

---

## 6.7 Temporal Evidence

Examples:

* publication date;
* capture date;
* first observation;
* last observation;
* republication interval;
* campaign duration.

Temporal proximity may support or weaken a relationship hypothesis.

---

# 7. Evidence Strength

Not all evidence has equal recognition value.

The Recognition Model should conceptually distinguish:

```text
VERY STRONG
STRONG
MODERATE
WEAK
VERY WEAK
```

Examples:

### Very strong

```text
same SIRET
same official company email domain
explicit company name + exact address
official company career-page match
```

### Strong

```text
same uncommon industrial description
same exact workplace
same recruiter reference
same unusual combination of machinery and industry
```

### Moderate

```text
same city
same occupation
similar salary
same recruitment agency
```

### Weak

```text
same department
same broad industry
same generic job title
```

Evidence strength should eventually be configurable rather than permanently hard-coded into the domain model.

---

# 8. Positive Evidence

Positive evidence supports a hypothesis.

Example hypothesis:

```text
Publication A and Publication B concern the same employer.
```

Positive evidence might include:

```text
+ same exact workplace
+ same industrial process
+ same approximate employee count
+ same unusual equipment description
```

---

# 9. Negative Evidence

Negative evidence weakens a hypothesis.

Examples:

```text
- different municipalities 80 km apart
- incompatible employee counts
- incompatible industrial activities
- different explicit employer identifiers
- conflicting official addresses
```

Negative evidence must not simply be ignored because several positive features match.

---

# 10. Contradictory Evidence

Evidence can conflict.

Example:

```text
Publication A:
Company name = ABC Industries

Publication B:
Company name = XYZ Manufacturing

But:
same address
same phone
same website
```

Possible explanations include:

* company renamed;
* subsidiary relationship;
* establishment acquisition;
* source error;
* recruiter error;
* two companies sharing premises.

Job Nearby should preserve the contradiction rather than forcing an immediate merge.

A recognition result may therefore include:

```text
status: needs-review
reason: contradictory-identity-evidence
```

---

# 11. Employer Fingerprint

An Employer Fingerprint is a structured collection of characteristics inferred or extracted from one or more observations.

Example:

```text
Employer Fingerprint

Location:
Strasbourg

Industry:
Paper manufacturing

Employees:
approximately 160

Market:
Europe

Infrastructure:
paper machine
biomass boiler
wastewater treatment
electricity generation

Recruitment:
maintenance
electrical maintenance
industrial energy
```

An employer fingerprint is not itself an employer identity.

It is a tool for comparing observations and employer clusters.

---

# 12. Fingerprint Features

Potential fingerprint features include:

```text
identity
location
industry
company size
products
processes
equipment
technologies
infrastructure
organization
languages
working patterns
salary patterns
benefits
recruitment agency
recruiter
occupations
skills
textual signatures
```

Fingerprint features should be extensible.

Future recognition improvements must not require redesigning the entire employer model.

---

# 13. Feature Specificity

Recognition value depends not only on whether a feature matches but also on how distinctive that feature is.

For example:

```text
"industrial company"
```

has very little discriminatory value.

Whereas:

```text
"brown-paper manufacturer in Strasbourg
with approximately 160 employees,
biomass boiler and wastewater treatment"
```

has very high discriminatory value.

The recognition engine should eventually consider **feature specificity**.

Conceptually:

```text
Recognition Value
    ≈
Match Strength
×
Feature Specificity
×
Source Reliability
```

This is a conceptual relationship, not yet a fixed mathematical formula.

---

# 14. Employer Cluster

An Employer Cluster represents observations believed to concern the same real employer/location.

An employer cluster may be:

```text
RESOLVED
PROBABLY_RESOLVED
UNRESOLVED
CONFLICTED
```

Example:

```text
Employer Cluster #17

Status:
UNRESOLVED

Location:
Molsheim

Observations:
Publication #24
Publication #37
Publication #51

Fingerprint:
international industrial group
automated production
maintenance recruitment
```

An employer cluster has its own persistent identity inside Job Nearby even before the real employer is identified.

---

# 15. Employer Cluster Assignment

When a new observation arrives, Job Nearby compares it against existing employer clusters.

Possible outcomes:

```text
MATCH_EXISTING
CREATE_NEW
AMBIGUOUS
REQUIRES_REVIEW
```

Example:

```text
New publication
       ↓
Cluster #17   91%
Cluster #42   18%
Cluster #73    4%
       ↓
Assign to Cluster #17
```

The assignment itself should retain its confidence and reasoning.

---

# 16. Cluster Assignment Confidence

Cluster assignment confidence answers:

> How confident are we that this observation belongs to this employer cluster?

It does **not** answer:

> How confident are we that we know the employer's real name?

These values are independent.

Example:

```text
clusterAssignmentConfidence = 0.96
identityConfidence          = 0.31
```

---

# 17. Employer Candidate

An Employer Candidate represents a possible real-world identity for an employer cluster.

Example:

```text
Employer Cluster #17

Candidate identities:

Company A     72%
Company B     21%
Unknown        7%
```

Candidate identities may originate from:

* public registers;
* company websites;
* geographic searches;
* known employer database;
* external APIs;
* human suggestions;
* future AI-assisted research.

---

# 18. Employer Identity Resolution

Identity resolution should use evidence rather than simply choosing the highest-scoring candidate.

Possible results:

```text
RESOLVED
PROBABLE
AMBIGUOUS
UNRESOLVED
CONFLICTED
```

Suggested conceptual interpretation:

```text
RESOLVED
Evidence is sufficiently strong for normal use.

PROBABLE
One candidate is clearly strongest but meaningful uncertainty remains.

AMBIGUOUS
Several candidates remain plausible.

UNRESOLVED
No candidate has sufficient evidence.

CONFLICTED
Strong evidence points in incompatible directions.
```

Exact numerical thresholds should be determined experimentally.

---

# 19. Direct Identification

Some observations identify the employer directly.

Example:

```text
Displayed employer:
Groupe SIAT

Official company career page:
matching vacancy

Workplace:
Urmatt
```

This may result in very high identity confidence.

Even direct identification should retain its evidence rather than becoming an unsupported permanent value.

---

# 20. Indirect Identification

Anonymous employers may be identified indirectly.

Example:

```text
Observation:

Strasbourg
paper manufacturer
~160 employees
European customers
biomass boiler
wastewater treatment
large paper machine
```

Candidate research identifies Blue Paper.

The inference should retain the evidence that produced it.

---

# 21. Recruiter Recognition

Recruiters and employers are separate entities.

Recognition should determine whether the displayed company is:

```text
DIRECT_EMPLOYER
RECRUITMENT_AGENCY
STAFFING_AGENCY
UNKNOWN_ROLE
```

This classification can itself be uncertain.

Known recruitment intermediaries may eventually be stored in a recruiter registry.

---

# 22. Recruiter References

Recruitment-agency reference numbers are valuable evidence.

Example:

```text
JN-062026-7050118
```

Two publications carrying the same recruiter reference strongly suggest a shared publication origin or recruitment record.

Different recruiter references may provide evidence that two apparently identical advertisements represent distinct recruiter assignments.

However:

> Different recruiter references do not prove different employers.

---

# 23. Publication Family Recognition

A Publication Family groups observations that appear to be copies or redistributions of substantially the same advertisement.

Potential signals include:

```text
same recruiter reference
same title
same location
same salary
near-identical description
same requirements
same unusual phrases
same publication period
```

Publication-family confidence should be separate from employer-cluster confidence.

Example:

```text
samePublicationFamilyConfidence = 0.98
sameEmployerConfidence          = 0.99
```

or:

```text
samePublicationFamilyConfidence = 0.15
sameEmployerConfidence          = 0.94
```

The second case represents different advertisements from the same employer.

---

# 24. Recruitment Campaign Recognition

A Recruitment Campaign represents inferred hiring activity by an employer.

It may include:

* one publication;
* several publication families;
* repeated advertisements;
* several positions;
* multiple related occupations.

Campaign inference is more uncertain than publication-family recognition and employer clustering.

It should therefore initially be conservative.

---

# 25. Campaign Evidence

Potential campaign evidence includes:

```text
same employer
same occupation
same recruiter
similar requirements
temporal proximity
same salary
same number of positions
same shift pattern
same recruiter reference
explicit "several positions" wording
```

Campaign inference should also account for negative evidence.

---

# 26. Multi-Position Recruitment

A publication may explicitly indicate:

```text
several technicians
multiple positions
team expansion
new maintenance team
```

Job Nearby must preserve this information.

It must not infer:

```text
one publication = one position
```

The number of positions may be represented as:

```text
known exact count
known minimum
estimated range
unknown plural
unknown
```

---

# 27. Repeated Recruitment

Repeated similar publications from one employer may indicate:

* continuing campaign;
* recurring demand;
* turnover;
* growth;
* difficult-to-fill position;
* automatic republication.

Job Nearby should initially describe the observable pattern rather than prematurely assigning a cause.

Prefer:

```text
Repeated maintenance recruitment observed
```

over:

```text
Company has high employee turnover
```

unless additional evidence supports the latter conclusion.

---

# 28. Recognition Confidence

Confidence should represent uncertainty in a particular inference.

Different inference types require separate confidence values.

Examples:

```text
publicationFamilyConfidence
clusterAssignmentConfidence
employerIdentityConfidence
campaignRelationshipConfidence
```

There should not be one universal `confidence` field describing everything.

---

# 29. Confidence Representation

The internal representation may eventually use a normalized numeric value:

```text
0.0 – 1.0
```

The user interface may translate this into understandable categories:

```text
VERY HIGH
HIGH
MEDIUM
LOW
VERY LOW
```

The numeric value must not imply mathematical precision that the underlying algorithm does not possess.

---

# 30. Confidence Is Algorithm-Version Dependent

A recognition score produced by one algorithm version may not be directly comparable with a score produced by another.

Recognition results should therefore eventually retain:

```text
algorithm
algorithmVersion
evaluatedAt
```

Example:

```text
employer-clustering
v0.3
2026-08-20
```

This allows recognition results to be recalculated as algorithms improve.

---

# 31. Recognition Explanation

Important recognition conclusions should be explainable.

Example:

```text
Probable employer:
Blue Paper

Confidence:
Very high

Supporting evidence:
+ Strasbourg location
+ paper manufacturing
+ ~160 employees
+ European customer base
+ biomass boiler
+ wastewater treatment
+ matching production infrastructure

Contradictory evidence:
none known
```

The user should not merely see:

```text
Blue Paper — 97%
```

without understanding why.

---

# 32. Human Confirmation

A user may confirm:

```text
This is the correct employer.
```

This creates strong evidence.

The confirmation should record:

```text
what was confirmed
when
which hypothesis
```

Human confirmation should not delete the algorithmic inference that preceded it.

---

# 33. Human Rejection

A user may reject a proposed identity:

```text
This is NOT Company A.
```

Negative human evidence must be preserved.

Otherwise the recognition engine may repeatedly suggest the same incorrect candidate.

---

# 34. Cluster Merge

Two employer clusters may later prove to represent the same employer/location.

Example:

```text
Cluster #17
Cluster #43
      ↓
MERGE
      ↓
Employer Cluster #17
```

The merge must preserve:

* both original cluster identities;
* observations;
* historical inference;
* merge reason;
* merge timestamp;
* confirmation source.

The implementation should avoid destructive database operations where possible.

---

# 35. Cluster Split

A cluster may later prove to contain observations from two different employers.

Example:

```text
Cluster #17
     ↓
incorrectly combined
     ↓
Cluster #17A
Cluster #17B
```

The model must support reassignment of observations.

This is another reason original evidence must remain independent of inferred cluster membership.

---

# 36. Re-Evaluation

New evidence may change previous conclusions.

Example:

```text
Day 1:
Unknown Employer #17

Day 5:
Candidate A — 60%

Day 12:
New publication reveals company domain

Day 12 result:
Company B — 99%
```

The system should be capable of re-evaluating historical observations and clusters.

Recognition is therefore an evolving process rather than a one-time transformation.

---

# 37. Recognition Events

Significant recognition changes should eventually be representable as events.

Examples:

```text
cluster-created
observation-assigned
identity-candidate-added
identity-resolved
identity-rejected
clusters-merged
cluster-split
campaign-created
user-confirmed
recognition-recalculated
```

This supports auditability and debugging.

---

# 38. Recognition Versus User History

Recognition determines:

```text
Who is this employer?
Have we seen this employer before?
```

User history determines:

```text
What have I already done with this employer?
```

These domains must remain separate.

Recognition may identify an employer without accessing private job-search actions.

---

# 39. Recognition Result for the User

The recognition layer should eventually return a result conceptually similar to:

```text
RECOGNITION RESULT

Employer cluster:
#17

Employer:
Groupe SIAT

Identity:
RESOLVED

Identity confidence:
VERY HIGH

Previously known employer:
YES

Publication:
Probably new publication family

Recruitment:
Probably related to existing
maintenance recruitment

Evidence:
5 strong supporting signals

Warnings:
None
```

Or:

```text
RECOGNITION RESULT

Employer cluster:
#31

Employer:
UNKNOWN

Identity:
UNRESOLVED

Previously known employer:
YES

Cluster confidence:
VERY HIGH

Observed characteristics:
Brumath
automated production lines
international group
international commissioning

Candidate employers:
Insufficient evidence

Action:
No need to research from zero;
continue employer identification.
```

---

# 40. Recognition Engine Architecture Principle

The recognition engine should not be one large function.

Conceptually it should consist of replaceable components:

```text
Evidence Extractor
        ↓
Normalizer
        ↓
Publication Matcher
        ↓
Fingerprint Builder
        ↓
Employer Cluster Matcher
        ↓
Identity Resolver
        ↓
Campaign Matcher
        ↓
Explanation Builder
```

Individual algorithms can therefore evolve independently.

---

# 41. Deterministic Recognition First

The first implementation should prefer understandable deterministic methods where practical.

Examples:

```text
exact source ID match
exact recruiter reference match
normalized company-name match
address match
domain match
SIRET match
location comparison
text similarity
structured fingerprint comparison
```

The project should not begin by sending every vacancy to a large language model and accepting its answer.

This provides:

* reproducibility;
* easier testing;
* lower cost;
* explainability;
* easier open-source contribution.

---

# 42. AI-Assisted Recognition

AI may later assist with tasks such as:

* extracting employer characteristics from free text;
* identifying unusual fingerprint features;
* interpreting indirect company descriptions;
* generating candidate search queries;
* comparing semantically similar descriptions;
* explaining recognition evidence.

AI output must remain evidence or inference rather than unquestioned truth.

AI-assisted recognition should use the same candidate/confidence/provenance model as deterministic recognition.

---

# 43. External Research

Some employer identities cannot be determined from the captured publication alone.

Recognition may therefore invoke external research providers.

Potential providers include:

```text
public company registers
search engines
company websites
career pages
public employment APIs
business directories
```

External research should return evidence into the recognition pipeline rather than directly mutate employer identity.

---

# 44. Recognition Cost

Not every publication deserves expensive investigation.

A future recognition strategy may use escalating effort:

```text
Stage 1
Cheap deterministic matching

        ↓ unresolved

Stage 2
Existing-database fingerprint matching

        ↓ unresolved

Stage 3
External structured sources

        ↓ unresolved

Stage 4
Web research / AI assistance

        ↓ unresolved

Stage 5
Human review
```

This aligns with the product goal of minimizing unnecessary effort.

---

# 45. Recognition Cache

External research and expensive recognition results should be reusable.

If Job Nearby has already investigated:

```text
Unknown employer
Brumath
automated production-line manufacturer
```

a similar publication should reuse the accumulated evidence rather than begin research again.

The employer cluster naturally serves as part of this persistent recognition memory.

---

# 46. False Merge Risk

Incorrectly merging two employers can seriously distort:

* hiring history;
* user interaction history;
* recruitment analytics;
* future recognition.

Therefore employer clustering should be conservative where evidence is ambiguous.

A false unresolved result is often preferable to a false merge.

---

# 47. False Split Risk

Keeping one employer represented as several clusters also has costs:

* duplicated research;
* missed previous interactions;
* distorted company counts.

The system should therefore periodically reconsider unresolved clusters when new evidence arrives.

---

# 48. Recognition Threshold Strategy

Thresholds should not initially be treated as universal truths.

Different actions may require different confidence levels.

For example:

```text
Show candidate:
medium confidence acceptable

Automatically assign observation to cluster:
high confidence required

Automatically merge clusters:
very high confidence required

Mark employer identity as resolved:
very high confidence or human confirmation
```

This is safer than one global threshold.

Recognition confidence and assignment policy are separate concerns. Matchers
estimate candidate confidence without knowing action thresholds; user-configurable
review and automatic-assignment thresholds determine whether an observation is
automatically assigned, proposed for review, or treated as having no useful match.

When no existing employer cluster reaches the review threshold, Job Nearby creates
a new unresolved employer cluster and attaches the observation to it. Assignment
confidence `1` in this case means certain membership by construction—the cluster
was created for that observation—not certainty about the employer's identity.

The in-memory workflow saves the cluster before its initial assignment and does not
simulate rollback. When recognition persistence moves to SQLite, these two writes
should occur in one database transaction.

---

# 49. Initial Recognition Features

The first prototype should concentrate on features available from the real test corpus.

Recommended initial features:

```text
source identifier
source URL
recruiter reference
displayed company
recruiter identity
title
location
description
salary
contract type
occupation
publication/capture date
text similarity
company-name similarity
known employer aliases
known employer locations
```

More sophisticated industrial fingerprint extraction can follow.

---

# 50. Initial Employer-Clustering Strategy

A first deterministic clustering strategy may approximately follow:

```text
1. Check exact known employer identifiers.

2. Check known company aliases + location.

3. Check recruiter reference and known mapping.

4. Compare strong geographic and organizational clues.

5. Compare textual/fingerprint similarity.

6. Search existing unresolved employer clusters.

7. Produce candidate cluster scores.

8. Assign only when confidence threshold is satisfied.

9. Otherwise create a new unresolved cluster
   or request human review.
```

The exact scoring formula remains intentionally unspecified in v0.1.

---

# 51. Initial Identity-Resolution Strategy

A first identity-resolution strategy may approximately follow:

```text
1. Look for explicit employer identity.

2. Validate against location and other evidence.

3. Search known employer database.

4. Query authoritative establishment sources.

5. Compare employer fingerprint.

6. Search public company sources when necessary.

7. Rank candidate identities.

8. Explain supporting and contradictory evidence.

9. Resolve only above the required threshold.

10. Otherwise preserve unresolved state.
```

---

# 52. Recognition Test Corpus

The project should maintain a test corpus derived from real recognition situations.

The corpus should avoid redistributing protected vacancy content unnecessarily.

Tests may instead retain legally appropriate structured features or synthetic equivalents.

Required scenario classes include:

### Scenario A — Direct employer

Employer explicitly named and verified.

Expected:

```text
identity = RESOLVED
```

### Scenario B — Anonymous but identifiable employer

Strong fingerprint allows identification.

Expected:

```text
cluster = MATCH_EXISTING or CREATE_NEW
identity = RESOLVED/PROBABLE
```

### Scenario C — Anonymous unresolved employer

Expected:

```text
cluster = valid
identity = UNRESOLVED
```

### Scenario D — Recruitment agency

Displayed company is recruiter rather than employer.

Expected:

```text
recruiter recognized
employer not incorrectly assigned
```

### Scenario E — Cross-site publication copies

Expected:

```text
same publication family
```

### Scenario F — Same employer, different vacancies

Expected:

```text
same employer cluster
different publication families
```

### Scenario G — Several positions

Expected:

```text
campaign recognizes plural recruitment
position count not forced to 1
```

### Scenario H — Conflicting identity evidence

Expected:

```text
CONFLICTED or REQUIRES_REVIEW
```

### Scenario I — Expired source URL

Expected:

```text
historical captured observation remains usable
```

### Scenario J — Previously rejected candidate

Expected:

```text
rejected candidate not repeatedly proposed
without new evidence
```

---

# 53. Recognition Quality Metrics

Recognition quality should eventually be evaluated independently for different tasks.

Potential metrics include:

```text
publication-family precision
publication-family recall

employer-cluster precision
employer-cluster recall

employer-identity precision
employer-identity resolution rate

false employer merges
false employer splits

human correction rate
```

For the early project, **precision is more important than maximizing automatic resolution**.

In particular:

> A confidently wrong employer identification is more harmful than an unresolved employer.

---

# 54. Recognition Feedback Loop

Human corrections can improve future recognition.

Conceptually:

```text
Algorithm inference
        ↓
User review
        ↓
Confirmation / correction
        ↓
Persistent evidence
        ↓
Future recognition
```

The first version does not require machine learning.

Simple persistent rules and corrected aliases may already provide substantial improvement.

---

# 55. Example — Groupe SIAT

Observed fingerprint:

```text
Urmatt
heavy industry
highly automated machinery
maintenance team ~20
2×8
maintenance technician
```

External evidence:

```text
Groupe SIAT career page
matching location
matching occupation
matching team structure
matching work pattern
```

Result:

```text
Employer cluster:
resolved

Identity:
Groupe SIAT

Identity confidence:
VERY HIGH
```

---

# 56. Example — Blue Paper

Observed fingerprint:

```text
Strasbourg
Alsatian SME
~160 employees
brown paper
European customers
paper machine
biomass boiler
wastewater treatment
energy production
```

External evidence matches Blue Paper.

Result:

```text
Employer cluster:
resolved

Identity:
Blue Paper

Identity confidence:
VERY HIGH
```

This example demonstrates the value of combining several individually incomplete features.

---

# 57. Example — Brumath Anonymous Employer

Observed fingerprint:

```text
Brumath
French subsidiary
international group
automated production-line equipment
mechanical/electrical installation
commissioning
international travel
six-month training
English
German advantageous
```

Multiple publications appear to concern the same employer.

Result:

```text
Employer cluster:
known

Cluster confidence:
HIGH / VERY HIGH

Identity:
UNRESOLVED
```

This is considered a successful recognition result.

---

# 58. Example — Obernai Ambiguity

Several Page Personnel publications may share:

```text
Obernai
maintenance technician
industrial leader
similar publication period
```

but contain different recruiter references and different technical requirements.

Result:

```text
Do not automatically merge
recruitment records.

Employer relationship:
possible

Campaign relationship:
uncertain

Identity:
unresolved
```

This demonstrates the need for negative and contradictory evidence.

---

# 59. Initial MVP Recognition Requirement

For the first MVP, the recognition system does **not** need to identify every employer automatically.

It must reliably support:

```text
new employer cluster

existing employer cluster

resolved employer

unresolved employer

probable employer

recruiter versus employer

same publication family

probably different publication

human confirmation

human correction
```

This is sufficient to make the application useful for everyday job-search memory.

---

# 60. Foundational Recognition Rules

The following rules are established by Recognition Model v0.1.

**R1 — Evidence precedes inference.**
Recognition conclusions must be based on preserved observations.

**R2 — Employer clustering and identity resolution are separate.**

**R3 — Anonymous employer clusters are first-class entities.**

**R4 — Confidence belongs to relationships and conclusions, not globally to an object.**

**R5 — Positive, negative, and contradictory evidence must be representable.**

**R6 — Feature specificity matters.**

**R7 — Recruiters and employers are different roles.**

**R8 — Publication families and recruitment campaigns are different entities.**

**R9 — One publication must not imply one position.**

**R10 — Recognition results must be explainable.**

**R11 — Human confirmation and rejection are persistent evidence.**

**R12 — Cluster merge and split must be supported.**

**R13 — New evidence may trigger re-evaluation of old conclusions.**

**R14 — Recognition algorithms must be replaceable and versioned.**

**R15 — Conservative recognition is preferred to false certainty.**

**R16 — Deterministic and explainable recognition should precede expensive AI-assisted recognition where practical.**

**R17 — Unknown is a valid and useful recognition state.**

Exact equality between two `UNKNOWN`-role organization values is meaningful
identity evidence, but remains weaker than equality between two explicit employers:
it produces a strong rather than very-strong signal. Exact equality across one
`EMPLOYER` role and one `UNKNOWN` role is treated at the same strong level. This
does not reinterpret unknown evidence as employer evidence.

An explicit `RECRUITMENT_AGENCY` or `STAFFING_AGENCY` classification for the same
normalized organization name suppresses this strong identity inference. Shared
intermediaries remain weak contextual evidence, and different unknown-role names
remain neutral. Publication-provider equality does not suppress unknown-role
organization comparison; suppression requires explicit intermediary-role evidence.

M3.4.4b adds conservative, benchmark-driven extraction for explicit employer,
client, business, and industrial-site characteristics, including pharmaceutical
manufacturing, lifting-equipment business, and industrial production sites. These
rules require employer/site attribution and explicitly exclude generic similarity
in maintenance duties, repair, commissioning, GMAO use, equipment installation,
and continuous-improvement work.

After M3.4 diagnosis and these targeted improvements, the original corpus is no
longer pristine unseen holdout data. Its first independent 55.6% result remains a
historical baseline; subsequent runs are regression and diagnostic measurements,
not out-of-sample accuracy estimates.

## Vacancy identity

Vacancy identity is distinct from both a captured source observation and employer
identity:

```text
SourceObservation (one immutable capture) ─┐
                                           ├─ Vacancy identity
SourceObservation (another capture) ───────┘
                                                  │
                                                  └─ concerns an EmployerCluster
```

The relationships are not one-to-one. Multiple observations may describe one
vacancy and must remain available as separate historical captures. One employer may
have many vacancies, so same employer does not imply same vacancy.

M3.5.1 establishes only one decisive vacancy-identity rule: an exact non-empty
external vacancy ID in the same provider namespace proves `SAME_VACANCY`. Provider
names are normalized conservatively by trimming, collapsing whitespace, and case
folding; no fuzzy provider matching is performed. External ID equality across
different providers, differing IDs within one provider, or missing ID evidence all
remain `UNRESOLVED`. Failure to prove sameness does not prove different vacancies.

This rule assumes an exact external ID is stable within its provider namespace.
Provider ID recycling is a known future uncertainty and is not handled in M3.5.1.
Vacancy matching does not reuse employer-match confidence and does not merge or
delete source observations.

## Durable employer-recognition state

M5.6.2a persists employer clusters and the complete historical sequence of
observation-to-cluster assignments. Effective cluster membership is derived from
an unsuperseded `ACCEPTED` or `USER_CONFIRMED` assignment. A `PROPOSED` assignment
is a current review candidate only and does not establish membership; `REJECTED`
assignments remain history without establishing membership.

Historical observations supplied to the employer matcher are derived from these
effective assignments and immutable `SourceObservation` records. There is no
second mutable cluster-membership store. Persistence prevents more than one
effective membership or more than one current proposal for an observation.

M5.6.2b makes employer processing retry-safe. An existing effective assignment
short-circuits matching, and `USER_CONFIRMED` membership is never overridden by
automatic processing. Creation of a new unresolved cluster and its initial
accepted assignment is atomic. A semantically identical review retry reuses the
current proposal; a materially changed review result atomically supersedes it and
preserves the previous proposal in history. Concurrent effective-assignment
conflicts reload and preserve the winning membership rather than reassigning the
observation. No automatic employer reassignment or acquisition-pipeline wiring is
introduced.

---

# 61. Next Document

The next project document should be:

**`DATA_MODEL.md`**

It should translate the Product Specification and Recognition Model into concrete domain entities and relationships, including:

```text
SourceObservation
Evidence
PublicationFamily
Recruiter
EmployerCluster
Employer
EmployerLocation
EmployerCandidate
IdentityResolution
RecruitmentCampaign
RecognitionResult
RecognitionEvidence
UserEmployerInteraction
DataSourceReference
```

The Data Model should define ownership, identity, cardinality, lifecycle, historical behavior, and which entities are immutable observations versus mutable or recalculable inference.

Concrete TypeScript interfaces should be designed only after those relationships are agreed.
