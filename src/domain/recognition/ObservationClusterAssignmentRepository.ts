import type { SourceObservationId } from "../capture/SourceObservation.js";

import type {
  ObservationClusterAssignment,
  ObservationClusterAssignmentId,
} from "./ObservationClusterAssignment.js";
import type { EmployerClusterId } from "./EmployerCluster.js";

export interface ObservationClusterAssignmentRepository {
  findConfirmedClusterIds?(): Promise<readonly string[]>;
  save(
    assignment: ObservationClusterAssignment,
  ): Promise<void>;

  findById(
    id: ObservationClusterAssignmentId,
  ): Promise<ObservationClusterAssignment | null>;

  findByObservationId(
    sourceObservationId: SourceObservationId,
  ): Promise<readonly ObservationClusterAssignment[]>;

  findEffectiveByObservationId(
    sourceObservationId: SourceObservationId,
  ): Promise<ObservationClusterAssignment | null>;

  findEffectiveByClusterId?(
    employerClusterId: EmployerClusterId,
  ): Promise<readonly ObservationClusterAssignment[]>;

  findCurrentProposalByObservationId(
    sourceObservationId: SourceObservationId,
  ): Promise<ObservationClusterAssignment | null>;

  replaceCurrentProposal(
    existingProposalId: ObservationClusterAssignmentId,
    replacement: ObservationClusterAssignment,
    supersededAt: Date,
  ): Promise<void>;

  supersedeEffectiveAssignment?(
    existingAssignmentId: ObservationClusterAssignmentId,
    replacement: ObservationClusterAssignment,
    supersededAt: Date,
  ): Promise<void>;
}
