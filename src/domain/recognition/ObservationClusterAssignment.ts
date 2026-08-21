import type { SourceObservationId } from "../capture/SourceObservation.js";
import type { EmployerClusterId } from "./EmployerCluster.js";

export type ObservationClusterAssignmentId = string;

export type ObservationClusterAssignmentStatus =
  | "PROPOSED"
  | "ACCEPTED"
  | "REJECTED"
  | "USER_CONFIRMED";

export interface ObservationClusterAssignment {
  readonly id: ObservationClusterAssignmentId;

  readonly sourceObservationId: SourceObservationId;
  readonly employerClusterId: EmployerClusterId;

  readonly confidence: number;
  readonly status: ObservationClusterAssignmentStatus;

  readonly algorithm: string;
  readonly algorithmVersion: string;

  readonly evaluatedAt: Date;

  readonly explanation?: string;
}
