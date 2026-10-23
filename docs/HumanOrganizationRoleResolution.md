# Human organization role resolution

Organization identity and role are separate. The review page exposes employer,
staffing agency, recruiter, client and consultancy actions for each relevant
organization. Choosing a different role never hides the other supported actions.

Recommendations are derived afresh from the bounded source observations. Explicit
vacancy evidence takes precedence over provider context; history supplies a
recommendation only when current evidence does not identify a role. Conflicting
histories produce an unknown recommendation. Recruitment-agency evidence maps to
the canonical recruiter role. Kelly's corporate-careers context recommends employer;
Crit's client/intermediary evidence recommends staffing agency. Neither is a human
confirmation. A source contradiction requires an explicit acknowledgment.

The user approved migration 010 at the schema gate. It adds only
`vacancy_organization_role_decisions`, with append-only triggers, a per-vacancy
decision chain, source/decision basis and override acknowledgment. Existing data is
not rewritten or backfilled. Each organization has a latest choice within that
vacancy, and only the latest employer choice is effective. Changing one organization
to employer does not resurrect earlier employer choices for other organizations.

Employer membership changes and the decision are committed in one transaction.
Current source membership, assignment IDs and the previous decision are checked
before writing. Employer overrides supersede assignments for this vacancy's source
observations; shared employer clusters and other vacancies are not modified.
Changing the selected employer to an intermediary creates one unresolved membership
for this vacancy. A repeated effective choice is a no-op. Reusing a request ID is
idempotent unless its vacancy, organization or role differs.

The review and inbox immediately project the human choice over stored canonical
facts. Capture processing applies the same vacancy-specific choices before canonical
reprojection, including exact recapture and later changed-content captures. Source
observations and canonical vacancy IDs remain unchanged. Automatic recommendations
are computed independently of those human overrides.

Existing agency confirmations remain authoritative for their original vacancy.
Their registry stays append-only and continues recording confirmed agency history.
They no longer force that role on unrelated vacancies. Older employer confirmations,
including superseded assignments, remain visible as supporting history. Employer and
agency histories can coexist for the same organization. Legacy role-changing routes
reject requests when the new workflow is active, preventing a bypass of the warning
and vacancy-specific decision log; legacy integrations without the new repository
retain their existing behavior.

The migration runs through the normal database initialization path. Development
validation uses temporary/in-memory databases; the live database is not migrated or
modified by these tests.

Coverage includes Kelly/Crit recommendations and overrides, all alternative actions,
selected-vacancy boundaries, history precedence, coexistence, source immutability,
recapture continuity, duplicate requests, concurrent/stale decisions, transactional
rollback, HTTP validation and additive migration.

## Employer identity is a separate decision

Confirming EMPLOYER remains vacancy-specific. To explicitly reuse a prior employer
identity, use the separate [Employer identity workflow](EmployerIdentitySelection.md).
It remains available after role confirmation and shows prior vacancies/locations.
Names and careers domains are advisory. Identity selection changes this vacancy's
assignments atomically, preserves role history, and never merges employer clusters.
