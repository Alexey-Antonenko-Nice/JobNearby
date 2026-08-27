# Independent Employer Recognition Holdout Evaluation

## Summary

- Total cases: 10
- Scored cases: 9
- Passed: 5
- Failed: 4
- Unscored: 1
- Pass rate: 55.6%
- Failed case IDs: `H01`, `H02`, `H07`, `H09`

## Case: `H01`

- Human-labelled relationship: `POSSIBLE_SAME_EMPLOYER`
- Expected confidence zone: `REVIEW_REQUIRED`
- Actual confidence zone: `NO_MATCH`
- Numeric confidence: 0.24
- Outcome: `FAIL`
- Human explanation: Both anonymous vacancies describe Strasbourg pharmaceutical industrial work with substantial overlap around maintenance, projects, utilities, new equipment, and commissioning. This is meaningful circumstantial evidence but does not establish client identity.

### Observed facts

#### Observation A: `holdout-4454269228`

##### Organizations

None extracted.

##### Locations

- Strasbourg — role: `DISPLAYED_LOCATION`; method: `DIRECT_FIELD`; confidence: 1.00

##### People

None extracted.

##### Employer characteristics

None extracted.

##### External identifiers

- 4454269228 — provider: `Indeed`; type: `SOURCE_EXTERNAL_ID`; method: `DIRECT_FIELD`; confidence: 1.00

#### Observation B: `holdout-4448033515`

##### Organizations

None extracted.

##### Locations

- Strasbourg — role: `DISPLAYED_LOCATION`; method: `DIRECT_FIELD`; confidence: 1.00

##### People

None extracted.

##### Employer characteristics

None extracted.

##### External identifiers

- 4448033515 — provider: `Indeed`; type: `SOURCE_EXTERNAL_ID`; method: `DIRECT_FIELD`; confidence: 1.00

### Evidence comparison

#### Positive signals

- [WEAK] Same displayed location: Strasbourg.

#### Contradictions

None produced.

### Dimension assessments

- Identity: `UNKNOWN`
- Geography: `WEAK_POSITIVE`
- Characteristics: `UNKNOWN`
- Intermediary: `UNKNOWN`

### Diagnostic hypothesis

- Category: `LIKELY_EXTRACTION_GAP`
- Interpretation: The expected-review case produced no identity or characteristic assessment and very little employer-relevant extracted evidence.

The diagnostic hypothesis is an engineering interpretation of observed output, not human-labelled benchmark truth.

## Case: `H02`

- Human-labelled relationship: `SAME_EMPLOYER_CLUSTER`
- Expected confidence zone: `AUTO_MATCH`
- Actual confidence zone: `NO_MATCH`
- Numeric confidence: 0.10
- Outcome: `FAIL`
- Human explanation: Both publications explicitly identify LOXAM. They concern different locations and business branches, but belong to the explicitly named LOXAM employer organization. This benchmark concerns employer clustering rather than establishment equality.

### Observed facts

#### Observation A: `holdout-loxam-strasbourg`

##### Organizations

- LOXAM — role: `UNKNOWN`; method: `DIRECT_FIELD`; confidence: 1.00

##### Locations

- Strasbourg — role: `DISPLAYED_LOCATION`; method: `DIRECT_FIELD`; confidence: 1.00

##### People

None extracted.

##### Employer characteristics

None extracted.

##### External identifiers

- holdout-loxam-strasbourg — provider: `HelloWork`; type: `SOURCE_EXTERNAL_ID`; method: `DIRECT_FIELD`; confidence: 1.00

#### Observation B: `holdout-loxam-haguenau`

##### Organizations

- LOXAM — role: `UNKNOWN`; method: `DIRECT_FIELD`; confidence: 1.00

##### Locations

- Haguenau — role: `DISPLAYED_LOCATION`; method: `DIRECT_FIELD`; confidence: 1.00

##### People

None extracted.

##### Employer characteristics

None extracted.

##### External identifiers

- holdout-loxam-haguenau — provider: `Meteojob`; type: `SOURCE_EXTERNAL_ID`; method: `DIRECT_FIELD`; confidence: 1.00

### Evidence comparison

#### Positive signals

None produced.

#### Contradictions

None produced.

### Dimension assessments

- Identity: `UNKNOWN`
- Geography: `UNKNOWN`
- Characteristics: `UNKNOWN`
- Intermediary: `UNKNOWN`

### Diagnostic hypothesis

- Category: `UNDERCONFIDENT`
- Interpretation: The engine did not automatically match a case labelled for automatic matching.

The diagnostic hypothesis is an engineering interpretation of observed output, not human-labelled benchmark truth.

## Case: `H03`

- Human-labelled relationship: `DIFFERENT_EMPLOYERS`
- Expected confidence zone: `NO_MATCH`
- Actual confidence zone: `NO_MATCH`
- Numeric confidence: 0.24
- Outcome: `PASS`
- Human explanation: Anonymous pharmaceutical manufacturing versus anonymous printing, dematerialization, and reprography activity supports different employers.

### Observed facts

#### Observation A: `holdout-4454269228`

##### Organizations

None extracted.

##### Locations

- Strasbourg — role: `DISPLAYED_LOCATION`; method: `DIRECT_FIELD`; confidence: 1.00

##### People

None extracted.

##### Employer characteristics

None extracted.

##### External identifiers

- 4454269228 — provider: `Indeed`; type: `SOURCE_EXTERNAL_ID`; method: `DIRECT_FIELD`; confidence: 1.00

#### Observation B: `holdout-4445142611`

##### Organizations

None extracted.

##### Locations

- Strasbourg — role: `DISPLAYED_LOCATION`; method: `DIRECT_FIELD`; confidence: 1.00

##### People

None extracted.

##### Employer characteristics

None extracted.

##### External identifiers

- 4445142611 — provider: `Indeed`; type: `SOURCE_EXTERNAL_ID`; method: `DIRECT_FIELD`; confidence: 1.00

### Evidence comparison

#### Positive signals

- [WEAK] Same displayed location: Strasbourg.

#### Contradictions

None produced.

### Dimension assessments

- Identity: `UNKNOWN`
- Geography: `WEAK_POSITIVE`
- Characteristics: `UNKNOWN`
- Intermediary: `UNKNOWN`

### Diagnostic hypothesis

- Category: `EXPECTED_BEHAVIOR`
- Interpretation: The observed confidence zone matches the benchmark expectation.

The diagnostic hypothesis is an engineering interpretation of observed output, not human-labelled benchmark truth.

## Case: `H04`

- Human-labelled relationship: `DIFFERENT_EMPLOYERS`
- Expected confidence zone: `NO_MATCH`
- Actual confidence zone: `NO_MATCH`
- Numeric confidence: 0.10
- Outcome: `PASS`
- Human explanation: The observations explicitly name different organizations and describe strongly different activities: food manufacturing versus solar-protection and closure manufacturing.

### Observed facts

#### Observation A: `holdout-cerelia-hoerdt`

##### Organizations

- Cérélia — role: `UNKNOWN`; method: `DIRECT_FIELD`; confidence: 1.00

##### Locations

- Hoerdt — role: `DISPLAYED_LOCATION`; method: `DIRECT_FIELD`; confidence: 1.00

##### People

None extracted.

##### Employer characteristics

None extracted.

##### External identifiers

- holdout-cerelia-hoerdt — provider: `HelloWork`; type: `SOURCE_EXTERNAL_ID`; method: `DIRECT_FIELD`; confidence: 1.00

#### Observation B: `holdout-tir-technologies-kilstett`

##### Organizations

- TIR Technologies — role: `UNKNOWN`; method: `DIRECT_FIELD`; confidence: 1.00

##### Locations

- Kilstett — role: `DISPLAYED_LOCATION`; method: `DIRECT_FIELD`; confidence: 1.00

##### People

None extracted.

##### Employer characteristics

None extracted.

##### External identifiers

- holdout-tir-kilstett — provider: `TIR Technologies`; type: `SOURCE_EXTERNAL_ID`; method: `DIRECT_FIELD`; confidence: 1.00

### Evidence comparison

#### Positive signals

None produced.

#### Contradictions

None produced.

### Dimension assessments

- Identity: `UNKNOWN`
- Geography: `UNKNOWN`
- Characteristics: `UNKNOWN`
- Intermediary: `UNKNOWN`

### Diagnostic hypothesis

- Category: `EXPECTED_BEHAVIOR`
- Interpretation: The observed confidence zone matches the benchmark expectation.

The diagnostic hypothesis is an engineering interpretation of observed output, not human-labelled benchmark truth.

## Case: `H05`

- Human-labelled relationship: `DIFFERENT_EMPLOYERS`
- Expected confidence zone: `NO_MATCH`
- Actual confidence zone: `NO_MATCH`
- Numeric confidence: 0.24
- Outcome: `PASS`
- Human explanation: The observations explicitly identify different organizations despite overlapping industrial-machine and technical vocabulary.

### Observed facts

#### Observation A: `holdout-apave-strasbourg`

##### Organizations

- Apave — role: `UNKNOWN`; method: `DIRECT_FIELD`; confidence: 1.00

##### Locations

- Strasbourg — role: `DISPLAYED_LOCATION`; method: `DIRECT_FIELD`; confidence: 1.00

##### People

None extracted.

##### Employer characteristics

None extracted.

##### External identifiers

- holdout-apave-strasbourg — provider: `Apave`; type: `SOURCE_EXTERNAL_ID`; method: `DIRECT_FIELD`; confidence: 1.00

#### Observation B: `holdout-loxam-strasbourg`

##### Organizations

- LOXAM — role: `UNKNOWN`; method: `DIRECT_FIELD`; confidence: 1.00

##### Locations

- Strasbourg — role: `DISPLAYED_LOCATION`; method: `DIRECT_FIELD`; confidence: 1.00

##### People

None extracted.

##### Employer characteristics

None extracted.

##### External identifiers

- holdout-loxam-strasbourg — provider: `HelloWork`; type: `SOURCE_EXTERNAL_ID`; method: `DIRECT_FIELD`; confidence: 1.00

### Evidence comparison

#### Positive signals

- [WEAK] Same displayed location: Strasbourg.

#### Contradictions

None produced.

### Dimension assessments

- Identity: `UNKNOWN`
- Geography: `WEAK_POSITIVE`
- Characteristics: `UNKNOWN`
- Intermediary: `UNKNOWN`

### Diagnostic hypothesis

- Category: `EXPECTED_BEHAVIOR`
- Interpretation: The observed confidence zone matches the benchmark expectation.

The diagnostic hypothesis is an engineering interpretation of observed output, not human-labelled benchmark truth.

## Case: `H06`

- Human-labelled relationship: `DIFFERENT_EMPLOYERS`
- Expected confidence zone: `NO_MATCH`
- Actual confidence zone: `NO_MATCH`
- Numeric confidence: 0.10
- Outcome: `PASS`
- Human explanation: The observations explicitly identify different organizations; their shared industrial context must not override employer identity.

### Observed facts

#### Observation A: `holdout-cerelia-hoerdt`

##### Organizations

- Cérélia — role: `UNKNOWN`; method: `DIRECT_FIELD`; confidence: 1.00

##### Locations

- Hoerdt — role: `DISPLAYED_LOCATION`; method: `DIRECT_FIELD`; confidence: 1.00

##### People

None extracted.

##### Employer characteristics

None extracted.

##### External identifiers

- holdout-cerelia-hoerdt — provider: `HelloWork`; type: `SOURCE_EXTERNAL_ID`; method: `DIRECT_FIELD`; confidence: 1.00

#### Observation B: `holdout-apave-strasbourg`

##### Organizations

- Apave — role: `UNKNOWN`; method: `DIRECT_FIELD`; confidence: 1.00

##### Locations

- Strasbourg — role: `DISPLAYED_LOCATION`; method: `DIRECT_FIELD`; confidence: 1.00

##### People

None extracted.

##### Employer characteristics

None extracted.

##### External identifiers

- holdout-apave-strasbourg — provider: `Apave`; type: `SOURCE_EXTERNAL_ID`; method: `DIRECT_FIELD`; confidence: 1.00

### Evidence comparison

#### Positive signals

None produced.

#### Contradictions

None produced.

### Dimension assessments

- Identity: `UNKNOWN`
- Geography: `UNKNOWN`
- Characteristics: `UNKNOWN`
- Intermediary: `UNKNOWN`

### Diagnostic hypothesis

- Category: `EXPECTED_BEHAVIOR`
- Interpretation: The observed confidence zone matches the benchmark expectation.

The diagnostic hypothesis is an engineering interpretation of observed output, not human-labelled benchmark truth.

## Case: `H07`

- Human-labelled relationship: `POSSIBLE_SAME_EMPLOYER`
- Expected confidence zone: `REVIEW_REQUIRED`
- Actual confidence zone: `NO_MATCH`
- Numeric confidence: 0.24
- Outcome: `FAIL`
- Human explanation: LOXAM and the anonymous Logic Intérim client both involve Strasbourg-area lifting equipment, maintenance, repairs, and regulatory controls. This makes common identity plausible but not established.

### Observed facts

#### Observation A: `holdout-loxam-strasbourg`

##### Organizations

- LOXAM — role: `UNKNOWN`; method: `DIRECT_FIELD`; confidence: 1.00

##### Locations

- Strasbourg — role: `DISPLAYED_LOCATION`; method: `DIRECT_FIELD`; confidence: 1.00

##### People

None extracted.

##### Employer characteristics

None extracted.

##### External identifiers

- holdout-loxam-strasbourg — provider: `HelloWork`; type: `SOURCE_EXTERNAL_ID`; method: `DIRECT_FIELD`; confidence: 1.00

#### Observation B: `holdout-logic-interim-lifting-client`

##### Organizations

- Logic Intérim — role: `UNKNOWN`; method: `DIRECT_FIELD`; confidence: 1.00

##### Locations

- Strasbourg — role: `DISPLAYED_LOCATION`; method: `DIRECT_FIELD`; confidence: 1.00

##### People

None extracted.

##### Employer characteristics

None extracted.

##### External identifiers

- holdout-logic-lifting — provider: `Logic Intérim`; type: `SOURCE_EXTERNAL_ID`; method: `DIRECT_FIELD`; confidence: 1.00

### Evidence comparison

#### Positive signals

- [WEAK] Same displayed location: Strasbourg.

#### Contradictions

None produced.

### Dimension assessments

- Identity: `UNKNOWN`
- Geography: `WEAK_POSITIVE`
- Characteristics: `UNKNOWN`
- Intermediary: `UNKNOWN`

### Diagnostic hypothesis

- Category: `LIKELY_EXTRACTION_GAP`
- Interpretation: The expected-review case produced no identity or characteristic assessment and very little employer-relevant extracted evidence.

The diagnostic hypothesis is an engineering interpretation of observed output, not human-labelled benchmark truth.

## Case: `H08`

- Human-labelled relationship: `INSUFFICIENT_EVIDENCE`
- Expected confidence zone: `UNSCORED`
- Actual confidence zone: `NO_MATCH`
- Numeric confidence: 0.10
- Outcome: `UNSCORED`
- Human explanation: The same recruiter and broadly similar industrial-maintenance vocabulary do not provide sufficient client-specific evidence. Different locations alone do not establish different employers.

### Observed facts

#### Observation A: `holdout-hays-anonymous-erstein`

##### Organizations

- Hays — role: `UNKNOWN`; method: `DIRECT_FIELD`; confidence: 1.00

##### Locations

- Erstein — role: `DISPLAYED_LOCATION`; method: `DIRECT_FIELD`; confidence: 1.00

##### People

None extracted.

##### Employer characteristics

None extracted.

##### External identifiers

- holdout-hays-erstein — provider: `Hays`; type: `SOURCE_EXTERNAL_ID`; method: `DIRECT_FIELD`; confidence: 1.00

#### Observation B: `holdout-hays-anonymous-saverne`

##### Organizations

- Hays — role: `UNKNOWN`; method: `DIRECT_FIELD`; confidence: 1.00

##### Locations

- Saverne — role: `DISPLAYED_LOCATION`; method: `DIRECT_FIELD`; confidence: 1.00

##### People

None extracted.

##### Employer characteristics

None extracted.

##### External identifiers

- holdout-hays-saverne — provider: `Hays`; type: `SOURCE_EXTERNAL_ID`; method: `DIRECT_FIELD`; confidence: 1.00

### Evidence comparison

#### Positive signals

None produced.

#### Contradictions

None produced.

### Dimension assessments

- Identity: `UNKNOWN`
- Geography: `UNKNOWN`
- Characteristics: `UNKNOWN`
- Intermediary: `UNKNOWN`

### Diagnostic hypothesis

- Category: `UNSCORED`
- Interpretation: This case intentionally has insufficient human-labelled evidence and is excluded from pass/fail scoring.

The diagnostic hypothesis is an engineering interpretation of observed output, not human-labelled benchmark truth.

## Case: `H09`

- Human-labelled relationship: `POSSIBLE_SAME_EMPLOYER`
- Expected confidence zone: `REVIEW_REQUIRED`
- Actual confidence zone: `NO_MATCH`
- Numeric confidence: 0.10
- Outcome: `FAIL`
- Human explanation: The anonymous Cezam client and Cérélia both present production-site maintenance fingerprints including shift work, GMAO, and industrial reliability and improvement context. Similarity is suggestive but does not establish identity.

### Observed facts

#### Observation A: `holdout-cezam-anonymous-industrial-client`

##### Organizations

- Cezam — role: `UNKNOWN`; method: `DIRECT_FIELD`; confidence: 1.00

##### Locations

- Strasbourg Nord — role: `DISPLAYED_LOCATION`; method: `DIRECT_FIELD`; confidence: 1.00

##### People

None extracted.

##### Employer characteristics

None extracted.

##### External identifiers

- holdout-cezam-industrial — provider: `Cezam`; type: `SOURCE_EXTERNAL_ID`; method: `DIRECT_FIELD`; confidence: 1.00

#### Observation B: `holdout-cerelia-hoerdt`

##### Organizations

- Cérélia — role: `UNKNOWN`; method: `DIRECT_FIELD`; confidence: 1.00

##### Locations

- Hoerdt — role: `DISPLAYED_LOCATION`; method: `DIRECT_FIELD`; confidence: 1.00

##### People

None extracted.

##### Employer characteristics

None extracted.

##### External identifiers

- holdout-cerelia-hoerdt — provider: `HelloWork`; type: `SOURCE_EXTERNAL_ID`; method: `DIRECT_FIELD`; confidence: 1.00

### Evidence comparison

#### Positive signals

None produced.

#### Contradictions

None produced.

### Dimension assessments

- Identity: `UNKNOWN`
- Geography: `UNKNOWN`
- Characteristics: `UNKNOWN`
- Intermediary: `UNKNOWN`

### Diagnostic hypothesis

- Category: `LIKELY_EXTRACTION_GAP`
- Interpretation: The expected-review case produced no identity or characteristic assessment and very little employer-relevant extracted evidence.

The diagnostic hypothesis is an engineering interpretation of observed output, not human-labelled benchmark truth.

## Case: `H10`

- Human-labelled relationship: `DIFFERENT_EMPLOYERS`
- Expected confidence zone: `NO_MATCH`
- Actual confidence zone: `NO_MATCH`
- Numeric confidence: 0.10
- Outcome: `PASS`
- Human explanation: Industrial production-site maintenance and mobile reprography installation and service have substantially different employer and activity fingerprints.

### Observed facts

#### Observation A: `holdout-cezam-anonymous-industrial-client`

##### Organizations

- Cezam — role: `UNKNOWN`; method: `DIRECT_FIELD`; confidence: 1.00

##### Locations

- Strasbourg Nord — role: `DISPLAYED_LOCATION`; method: `DIRECT_FIELD`; confidence: 1.00

##### People

None extracted.

##### Employer characteristics

None extracted.

##### External identifiers

- holdout-cezam-industrial — provider: `Cezam`; type: `SOURCE_EXTERNAL_ID`; method: `DIRECT_FIELD`; confidence: 1.00

#### Observation B: `holdout-4445142611`

##### Organizations

None extracted.

##### Locations

- Strasbourg — role: `DISPLAYED_LOCATION`; method: `DIRECT_FIELD`; confidence: 1.00

##### People

None extracted.

##### Employer characteristics

None extracted.

##### External identifiers

- 4445142611 — provider: `Indeed`; type: `SOURCE_EXTERNAL_ID`; method: `DIRECT_FIELD`; confidence: 1.00

### Evidence comparison

#### Positive signals

None produced.

#### Contradictions

None produced.

### Dimension assessments

- Identity: `UNKNOWN`
- Geography: `UNKNOWN`
- Characteristics: `UNKNOWN`
- Intermediary: `UNKNOWN`

### Diagnostic hypothesis

- Category: `EXPECTED_BEHAVIOR`
- Interpretation: The observed confidence zone matches the benchmark expectation.

The diagnostic hypothesis is an engineering interpretation of observed output, not human-labelled benchmark truth.
