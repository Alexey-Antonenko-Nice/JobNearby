# Vacancy Identity Exact-ID Validation

This validation-only dataset contains two sanitized pairs of independent
`SourceObservation` captures known to represent the same market vacancy. Matching
them does not delete, collapse, or mutate either observation.

M3.5.1 proves vacancy sameness only when direct evidence contains the exact same
non-empty external ID within the same conservatively normalized provider namespace.
All other outcomes remain unresolved; they do not prove different vacancies.

The fixtures contain only the minimum source ID, title, displayed organization, and
location fields needed to preserve the confirmed examples. No full page content,
candidate information, or application data is included.
