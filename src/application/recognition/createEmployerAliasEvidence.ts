import { createHash } from "node:crypto";
import { normalizeOrganizationEvidenceName as normalize } from "../../domain/evidence/OrganizationEvidence.js";
import type { EmployerAliasEvidence } from "../../domain/recognition/EmployerAliasEvidence.js";
import type { ObservationClusterAssignment } from "../../domain/recognition/ObservationClusterAssignment.js";
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

export function createAliasEvidence(name: string, displayLabel: string, assignment: ObservationClusterAssignment): EmployerAliasEvidence | undefined {
  if (normalize(name) === normalize(displayLabel)) return undefined;
  return {
    id: `alias:${hash([assignment.id, normalize(name)])}`, aliasName: name, normalizedAliasName: normalize(name), employerClusterId: assignment.employerClusterId,
    sourceAssignmentId: assignment.id, sourceType: "USER_CONFIRMED_ALIAS", createdAt: assignment.evaluatedAt,
    explanation: `User explicitly confirmed "${name}" as the same employer as "${displayLabel}".`,
  };
}

