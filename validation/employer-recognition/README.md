# Employer Recognition Validation Corpus

This directory contains Job Nearby's persistent, human-labelled benchmark for
employer recognition. It is validation data, not production data and not runtime
recognition truth. Production code must never inspect the expected labels.

## Purpose and provenance

The fixtures are compact synthetic/sanitized representations inspired by real
vacancies reviewed during Job Nearby research. They preserve only wording and
structured fields useful for recognition: source identity, sanitized external IDs,
job title, displayed organization, location, and short employer-relevant excerpts.

Fixtures deliberately omit full vacancy pages, navigation, recommendations,
application forms, personal candidate information, CV filenames, email addresses,
tracking content, and irrelevant page chrome. Excerpts should remain just long
enough to exercise the real extraction and recognition components.

## Labels

- `SAME_EMPLOYER_CLUSTER`: human reviewers believe both observations concern the
  same practical hiring employer/cluster.
- `DIFFERENT_EMPLOYERS`: human reviewers know the observations concern different
  employers.
- `POSSIBLE_SAME_EMPLOYER`: meaningful compatible evidence exists, but not enough
  for human certainty.
- `INSUFFICIENT_EVIDENCE`: the benchmark intentionally asserts no relationship.
  Matcher output is diagnostic and should not count as pass/fail in future scoring.

Confidence zones describe the expected product action:

- `AUTO_MATCH`: sufficiently strong for automatic assignment.
- `REVIEW_REQUIRED`: useful candidate evidence requiring human review.
- `NO_MATCH`: insufficient or contradictory evidence for a proposal.
- `UNSCORED`: deliberately excluded from pass/fail confidence-zone scoring.

Exact numeric confidence is not benchmark truth. Confidence calibration can evolve
while the human relationship and expected action remain stable.

Statuses indicate review maturity: `VERIFIED`, `NEEDS_REVIEW`, or `OPEN`.

## Structure and maintenance

- `fixtures/index.ts` contains sanitized `SourceObservation`-compatible records.
- `cases/index.ts` contains pairs, labels, rationale, and review status.
- `types.ts` contains validation-only types.

To add a case:

1. Add uniquely identified, minimal fixtures without personal data.
2. Add one case referencing exactly two existing fixture IDs.
3. Explain the human reasoning rather than a desired numeric score.
4. Use `UNSCORED` only with `INSUFFICIENT_EVIDENCE`.
5. Run type checking and the validation integrity tests.

The roadmap is:

1. M3.3.1 — corpus and integrity checks;
2. M3.3.2 — automated validation harness;
3. M3.3.3 — explainability report;
4. M3.3.4 — evidence-led recognition improvements.

## Automated execution

M3.3.1 established the human-labelled corpus and its integrity rules. M3.3.2
executes every pair through the current production extractors, evidence comparison,
dimension aggregation, confidence calculation, and default assignment policy.

The structured harness result retains extracted evidence, signals, contradictions,
dimension assessments, confidence, and expected/actual zones for diagnosis. An
`INSUFFICIENT_EVIDENCE`/`UNSCORED` case is reported but excluded from pass/fail
totals. Current failures are measurements of engine behavior; they must not be
hidden by changing labels or recognition rules during validation.
