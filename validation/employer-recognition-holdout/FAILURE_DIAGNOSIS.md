# Employer Recognition Holdout Failure Diagnosis

This forensic report separates observed pipeline facts from engineering interpretations. It does not change recognition behavior or assert that a diagnostic hypothesis is source truth.

## Preserved evaluation

- Scored result: 5 / 9 PASS
- Pass rate: 55.6%
- Diagnosed failures: `H01`, `H02`, `H07`, `H09`

## H01

- Expected: `REVIEW_REQUIRED`
- Actual: `NO_MATCH`
- Confidence: 0.24
- Earliest failure stage: `EXTRACTION`
- Failure scope: `LOCAL`

### Human-visible recognition clues

| Clue | In A | In B | Extracted A | Extracted B | Compared | Dimension contribution | Attribution |
|---|---:|---:|---|---|---|---|---|
| Pharmaceutical environment | yes | yes | No characteristic | No characteristic | No | None | `EMPLOYER_CHARACTERISTIC` |
| Strasbourg | yes | yes | DISPLAYED_LOCATION | DISPLAYED_LOCATION | Yes: WEAK location signal | Geography WEAK_POSITIVE | `LOCATION` |
| Maintenance context | yes | yes | No characteristic | No characteristic | No | None | `JOB_OR_OCCUPATION_CONTEXT` |
| Project context | yes | no | No characteristic | None | No | None | `JOB_OR_OCCUPATION_CONTEXT` |
| Utilities | yes | yes | No characteristic | No characteristic | No | None | `EMPLOYER_CHARACTERISTIC` |
| New equipment / installation | yes | yes | No characteristic | No characteristic | No | None | `JOB_OR_OCCUPATION_CONTEXT` |
| Commissioning / start-up | yes | yes | No characteristic | No characteristic | No | None | `JOB_OR_OCCUPATION_CONTEXT` |
| Industrial investment | no | no | Absent | Absent | No | None | `ABSENT` |

### Observed pipeline facts

#### Fixture A: `holdout-4454269228`

- Organization evidence: none
- Location evidence: Strasbourg / DISPLAYED_LOCATION / DIRECT_FIELD / 1.00
- Employer-characteristic evidence: none
- External-identifier evidence: 4454269228 / Indeed / DIRECT_FIELD / 1.00

#### Fixture B: `holdout-4448033515`

- Organization evidence: none
- Location evidence: Strasbourg / DISPLAYED_LOCATION / DIRECT_FIELD / 1.00
- Employer-characteristic evidence: none
- External-identifier evidence: 4448033515 / Indeed / DIRECT_FIELD / 1.00

#### Comparison

- Positive signals: [WEAK] Same displayed location: Strasbourg.
- Contradictions: none

#### Dimensions

- Identity: `UNKNOWN`
- Geography: `WEAK_POSITIVE`
- Characteristics: `UNKNOWN`
- Intermediary: `UNKNOWN`

**Observed cause:** Only the shared displayed location and provider-specific identifiers survive extraction. No organization or employer-characteristic evidence is produced from either pharmaceutical excerpt, so comparison has only one weak geographic signal.

### Engineering interpretation

The current explicit characteristic vocabulary does not cover the employer-attributed pharmaceutical, utilities, or production-environment wording in these fixtures. Maintenance, projects, equipment installation, and commissioning also mix employer context with job duties, so their overlap should not automatically be treated as employer identity.

## H02

- Expected: `AUTO_MATCH`
- Actual: `NO_MATCH`
- Confidence: 0.10
- Earliest failure stage: `COMPARISON`
- Failure scope: `ARCHITECTURAL`

### Human-visible recognition clues

| Clue | In A | In B | Extracted A | Extracted B | Compared | Dimension contribution | Attribution |
|---|---:|---:|---|---|---|---|---|
| Displayed organization LOXAM | yes | yes | LOXAM / UNKNOWN / DIRECT_FIELD / 1.00 | LOXAM / UNKNOWN / DIRECT_FIELD / 1.00 | No identity signal | Identity UNKNOWN | `ORGANIZATION` |
| Plain LOXAM in recognition-relevant text | yes | yes | Direct displayed-company field | Direct displayed-company field | Not compared as employer identity | None | `ORGANIZATION` |
| Same establishment location | no | no | Strasbourg displayed location | Haguenau displayed location | No location signal or contradiction | Geography UNKNOWN | `LOCATION` |
| LOXAM ACCESS / LOXAM RENTAL values | no | no | Absent | Absent | No literal comparison | None | `ABSENT` |

### Observed pipeline facts

#### Fixture A: `holdout-loxam-strasbourg`

- Organization evidence: LOXAM / UNKNOWN / DIRECT_FIELD / 1.00
- Location evidence: Strasbourg / DISPLAYED_LOCATION / DIRECT_FIELD / 1.00
- Employer-characteristic evidence: none
- External-identifier evidence: holdout-loxam-strasbourg / HelloWork / DIRECT_FIELD / 1.00

#### Fixture B: `holdout-loxam-haguenau`

- Organization evidence: LOXAM / UNKNOWN / DIRECT_FIELD / 1.00
- Location evidence: Haguenau / DISPLAYED_LOCATION / DIRECT_FIELD / 1.00
- Employer-characteristic evidence: none
- External-identifier evidence: holdout-loxam-haguenau / Meteojob / DIRECT_FIELD / 1.00

#### Comparison

- Positive signals: none
- Contradictions: none

#### Dimensions

- Identity: `UNKNOWN`
- Geography: `UNKNOWN`
- Characteristics: `UNKNOWN`
- Intermediary: `UNKNOWN`

**Observed cause:** Both identical LOXAM organization values survive direct-field extraction, but both retain role UNKNOWN. The comparator emits neither a positive identity signal nor a contradiction for UNKNOWN-role organizations. With every dimension UNKNOWN, confidence falls through to the 0.10 default and policy returns NO_MATCH.

### Engineering interpretation

This is primarily an organization-role/comparison-rule boundary: identical displayed organizations are deliberately not treated as employer identity when their role is UNKNOWN. It is not a normalization, alias, or parent-brand/business-unit failure in the frozen fixtures, because both extracted strings are already exactly LOXAM and no ACCESS/RENTAL relationship is represented or required by the actual data.

## H07

- Expected: `REVIEW_REQUIRED`
- Actual: `NO_MATCH`
- Confidence: 0.24
- Earliest failure stage: `EXTRACTION`
- Failure scope: `LOCAL`

### Human-visible recognition clues

| Clue | In A | In B | Extracted A | Extracted B | Compared | Dimension contribution | Attribution |
|---|---:|---:|---|---|---|---|---|
| Lifting equipment | yes | yes | No characteristic | No characteristic | No | None | `JOB_OR_OCCUPATION_CONTEXT` |
| Maintenance | yes | yes | No characteristic | No characteristic | No | None | `JOB_OR_OCCUPATION_CONTEXT` |
| Repair | yes | yes | No characteristic | No characteristic | No | None | `JOB_OR_OCCUPATION_CONTEXT` |
| Regulatory controls | yes | yes | No characteristic | No characteristic | No | None | `JOB_OR_OCCUPATION_CONTEXT` |
| Strasbourg | yes | yes | DISPLAYED_LOCATION | DISPLAYED_LOCATION | Yes: WEAK location signal | Geography WEAK_POSITIVE | `LOCATION` |
| Employer identity | yes | no | LOXAM / UNKNOWN | Only Logic Intérim / UNKNOWN; client anonymous | No identity signal | Identity UNKNOWN | `ORGANIZATION` |

### Observed pipeline facts

#### Fixture A: `holdout-loxam-strasbourg`

- Organization evidence: LOXAM / UNKNOWN / DIRECT_FIELD / 1.00
- Location evidence: Strasbourg / DISPLAYED_LOCATION / DIRECT_FIELD / 1.00
- Employer-characteristic evidence: none
- External-identifier evidence: holdout-loxam-strasbourg / HelloWork / DIRECT_FIELD / 1.00

#### Fixture B: `holdout-logic-interim-lifting-client`

- Organization evidence: Logic Intérim / UNKNOWN / DIRECT_FIELD / 1.00
- Location evidence: Strasbourg / DISPLAYED_LOCATION / DIRECT_FIELD / 1.00
- Employer-characteristic evidence: none
- External-identifier evidence: holdout-logic-lifting / Logic Intérim / DIRECT_FIELD / 1.00

#### Comparison

- Positive signals: [WEAK] Same displayed location: Strasbourg.
- Contradictions: none

#### Dimensions

- Identity: `UNKNOWN`
- Geography: `WEAK_POSITIVE`
- Characteristics: `UNKNOWN`
- Intermediary: `UNKNOWN`

**Observed cause:** The shared Strasbourg display location survives and yields a weak geographic signal. The distinctive combination of lifting-equipment work, repair, and regulatory controls produces no employer-characteristic evidence. The anonymous client is not represented as an organization.

### Engineering interpretation

The extraction gap is local to unsupported equipment/activity wording, but attribution remains important: maintenance, repair, and controls are job duties and cannot alone establish employer identity. Lifting equipment is the potentially distinctive employer fingerprint; the current extractor does not preserve it for comparison.

## H09

- Expected: `REVIEW_REQUIRED`
- Actual: `NO_MATCH`
- Confidence: 0.10
- Earliest failure stage: `EXTRACTION`
- Failure scope: `LOCAL`

### Human-visible recognition clues

| Clue | In A | In B | Extracted A | Extracted B | Compared | Dimension contribution | Attribution |
|---|---:|---:|---|---|---|---|---|
| Production site | yes | yes | No characteristic | No characteristic | No | None | `EMPLOYER_CHARACTERISTIC` |
| Shift/team organization | yes | yes | No characteristic | No characteristic | No | None | `JOB_OR_OCCUPATION_CONTEXT` |
| Explicit 5x8 organization | no | no | Absent | Absent | No | None | `ABSENT` |
| GMAO | yes | yes | No characteristic | No characteristic | No | None | `JOB_OR_OCCUPATION_CONTEXT` |
| Industrial maintenance | yes | yes | Title only; no characteristic | Title only; no characteristic | No | None | `JOB_OR_OCCUPATION_CONTEXT` |
| Reliability / improvement | yes | yes | No characteristic | No characteristic | No | None | `JOB_OR_OCCUPATION_CONTEXT` |
| Continuous improvement specifically | yes | no | No characteristic | Absent | No | None | `JOB_OR_OCCUPATION_CONTEXT` |
| Energy / boiler rounds | no | no | Absent | Absent | No | None | `ABSENT` |

### Observed pipeline facts

#### Fixture A: `holdout-cezam-anonymous-industrial-client`

- Organization evidence: Cezam / UNKNOWN / DIRECT_FIELD / 1.00
- Location evidence: Strasbourg Nord / DISPLAYED_LOCATION / DIRECT_FIELD / 1.00
- Employer-characteristic evidence: none
- External-identifier evidence: holdout-cezam-industrial / Cezam / DIRECT_FIELD / 1.00

#### Fixture B: `holdout-cerelia-hoerdt`

- Organization evidence: Cérélia / UNKNOWN / DIRECT_FIELD / 1.00
- Location evidence: Hoerdt / DISPLAYED_LOCATION / DIRECT_FIELD / 1.00
- Employer-characteristic evidence: none
- External-identifier evidence: holdout-cerelia-hoerdt / HelloWork / DIRECT_FIELD / 1.00

#### Comparison

- Positive signals: none
- Contradictions: none

#### Dimensions

- Identity: `UNKNOWN`
- Geography: `UNKNOWN`
- Characteristics: `UNKNOWN`
- Intermediary: `UNKNOWN`

**Observed cause:** Neither production-site wording nor any operational overlap becomes employer-characteristic evidence. Different displayed organizations and locations remain UNKNOWN-role/context evidence and create no signals or contradictions, leaving all dimensions UNKNOWN and confidence at 0.10.

### Engineering interpretation

The current extractor has no applicable rules for production-site context, GMAO, shift organization, or reliability wording. Most overlap describes maintenance organization or duties rather than a distinctive employer, so a future approach would need employer attribution and specificity safeguards; this diagnosis does not assert that the two clients are identical.
