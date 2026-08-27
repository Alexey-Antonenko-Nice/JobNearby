# Independent Employer Recognition Holdout Corpus

This directory is a frozen, out-of-sample holdout for independently evaluating
employer recognition. It is structurally separate from the M3.3 regression corpus
under `validation/employer-recognition/` and must not be imported by production
code or by the existing validation harness.

The human labels were established before running the Job Nearby recognition engine
against these cases. M3.4.1 records and protects the fixtures and labels only; it
does not execute recognition, reveal predictions, or use outcomes to tune behavior.

Fixtures are sanitized, minimal `SourceObservation` records preserving only source
identity, external vacancy identifier, title, displayed organization and location,
and short recognition-relevant vacancy excerpts. Candidate data, application-form
content, navigation, recommendation widgets, tracking data, and unrelated page
content are excluded.

## Labels and expected zones

- `SAME_EMPLOYER_CLUSTER` maps to an expected `AUTO_MATCH` action.
- `DIFFERENT_EMPLOYERS` maps to an expected `NO_MATCH` action.
- `POSSIBLE_SAME_EMPLOYER` maps to `REVIEW_REQUIRED`.
- `INSUFFICIENT_EVIDENCE` maps to `UNSCORED`.

These are human labels, not recognizer predictions. Human rationales explain the
evidence boundary for every pair.

## Holdout lifecycle

Once recognition results have been observed, this corpus is no longer pristine
unseen data for subsequent model changes. It may later be promoted to regression
coverage, but a new unseen holdout must then be collected for the next independent
evaluation.

Integrity tests may load the corpus to validate its shape, separation, and data
hygiene. They must not invoke extraction, comparison, matching, scoring, assignment,
the regression harness, or any other recognition implementation.
