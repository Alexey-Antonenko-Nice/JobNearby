import type { SourceObservationId } from "../capture/SourceObservation.js";

import type {
  ObservationClusterAssignment,
  ObservationClusterAssignmentId,
} from "./ObservationClusterAssignment.js";

export interface ObservationClusterAssignmentRepository {
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

  findCurrentProposalByObservationId(
    sourceObservationId: SourceObservationId,
  ): Promise<ObservationClusterAssignment | null>;

  replaceCurrentProposal(
    existingProposalId: ObservationClusterAssignmentId,
    replacement: ObservationClusterAssignment,
    supersededAt: Date,
  ): Promise<void>;
}
