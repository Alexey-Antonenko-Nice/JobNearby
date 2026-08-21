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
}
