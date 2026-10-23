/** Raw canonical relationships are a capture-time projection, not the assignment
 * audit log. Compare them explicitly without presenting either as the other. */
export function describeEmployerProjection(
  relationships: readonly { readonly role: string; readonly employer_cluster_id: string | null }[],
  assignment: { readonly clusterId: string; readonly status: string | null } | null,
) {
  const storedClusterIds = [...new Set(relationships.flatMap(r =>
    r.role === "EMPLOYER" && r.employer_cluster_id !== null ? [r.employer_cluster_id] : []))].sort();
  return {
    source: "STORED_CAPTURE_PROJECTION",
    storedClusterIds,
    effectiveObservationAssignmentClusterId: assignment?.clusterId ?? null,
    effectiveObservationAssignmentStatus: assignment?.status ?? null,
    matchesEffectiveObservationAssignment: assignment === null ? null
      : storedClusterIds.length === 1 && storedClusterIds[0] === assignment.clusterId,
    explanation: "Effective assignments take precedence over this stored projection. Canonical reprocessing refreshes it; superseded assignments preserve historical decisions.",
  };
}
