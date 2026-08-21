import { randomUUID } from "node:crypto";

import type { SourceObservationId } from "../../domain/capture/SourceObservation.js";
import type { EmployerClusterId } from "../../domain/recognition/EmployerCluster.js";

import type {
  ObservationClusterAssignment,
  ObservationClusterAssignmentId,
  ObservationClusterAssignmentStatus,
} from "../../domain/recognition/ObservationClusterAssignment.js";

export interface CreateObservationClusterAssignmentInput {
  sourceObservationId: SourceObservationId;
  employerClusterId: EmployerClusterId;

  confidence: number;
  status: ObservationClusterAssignmentStatus;

  algorithm: string;
  algorithmVersion: string;

  explanation?: string;
}

export interface CreateObservationClusterAssignmentDependencies {
  now?: () => Date;
  generateId?: () => ObservationClusterAssignmentId;
}

export function createObservationClusterAssignment(
  input: CreateObservationClusterAssignmentInput,
  dependencies: CreateObservationClusterAssignmentDependencies = {},
): ObservationClusterAssignment {
  if (
    !Number.isFinite(input.confidence) ||
    input.confidence < 0 ||
    input.confidence > 1
  ) {
    throw new Error(
      "Observation-cluster assignment confidence must be between 0 and 1.",
    );
  }

  if (input.algorithm.trim().length === 0) {
    throw new Error("Recognition algorithm is required.");
  }

  if (input.algorithmVersion.trim().length === 0) {
    throw new Error("Recognition algorithm version is required.");
  }

  const now = dependencies.now ?? (() => new Date());
  const generateId = dependencies.generateId ?? randomUUID;

  return {
    id: generateId(),
    sourceObservationId: input.sourceObservationId,
    employerClusterId: input.employerClusterId,

    confidence: input.confidence,
    status: input.status,

    algorithm: input.algorithm.trim(),
    algorithmVersion: input.algorithmVersion.trim(),

    evaluatedAt: now(),

    ...(input.explanation !== undefined &&
    input.explanation.trim().length > 0
      ? { explanation: input.explanation.trim() }
      : {}),
  };
}
