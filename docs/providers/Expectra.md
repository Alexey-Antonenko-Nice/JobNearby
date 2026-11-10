# Expectra Monaco

The validated `expectra.mc` direct vacancy layout uses
`/offre-emploi/<numeric-id>-<slug>`. The numeric route segment is the stable
identity; the title slug is not. Explicit selected-page references, application
popup IDs, saved-offer IDs, canonical URLs and associated structured identities
must agree. Missing or ambiguous boundaries, titles or conflicting identities
remain diagnostic observations and are not promoted to vacancies.

The selected context contains the unique title and the three job description,
profile and company sections. It excludes the navigation, agency sidebar,
contact details, group marketing and footer. The visible title and explicit
candidate experience and language requirements can be extracted from this
context; no CEFR language level is invented. Contract, workplace, salary and
work mode must be explicitly supported by vacancy evidence, never inferred
from the agency, market, application controls or sidebar. For the validated
vacancy these fields are unknown. Education wording remains in the context.

The site's Expectra logo identifies the displayed company. Its recruitment
sidebar supplies separate agency context and supports the `STAFFING_AGENCY`
recommendation, but is not vacancy content. References to the Randstad group
do not rename or merge Expectra and Randstad. Descriptive wording about an
unnamed client does not identify an employer. Human role alternatives remain
available.

A matching direct context and meaningful title pass the vacancy acceptance
gate. Exact recaptures reuse the observation and increment occurrences;
changed snapshots with the same ID retain the canonical vacancy and role
decisions. Other Expectra domains and layouts without the validated structure
are unsupported. Set `EXPECTRA_STORED_REPLAY=1` to replay the saved page in an
isolated in-memory database while opening the original database read-only.
