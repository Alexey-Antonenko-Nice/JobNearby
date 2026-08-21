import { randomUUID } from "node:crypto";

import type {
  EmployerCluster,
  EmployerClusterId,
  EmployerClusterStatus,
} from "../../domain/recognition/EmployerCluster.js";

export interface CreateEmployerClusterInput {
  status?: EmployerClusterStatus;
  resolvedEmployerId?: string;
  primaryLocationHint?: string;
  displayLabel?: string;
}

export interface CreateEmployerClusterDependencies {
  now?: () => Date;
  generateId?: () => EmployerClusterId;
}

export function createEmployerCluster(
  input: CreateEmployerClusterInput,
  dependencies: CreateEmployerClusterDependencies = {},
): EmployerCluster {
  const status = input.status ?? "UNRESOLVED";

  if (status === "RESOLVED" && input.resolvedEmployerId === undefined) {
    throw new Error(
      "A RESOLVED employer cluster requires resolvedEmployerId.",
    );
  }

  if (
    status === "UNRESOLVED" &&
    input.resolvedEmployerId !== undefined
  ) {
    throw new Error(
      "An UNRESOLVED employer cluster cannot have resolvedEmployerId.",
    );
  }

  const now = dependencies.now ?? (() => new Date());
  const generateId = dependencies.generateId ?? randomUUID;

  const timestamp = now();

  return {
    id: generateId(),
    status,
    createdAt: timestamp,
    updatedAt: timestamp,

    ...(input.resolvedEmployerId !== undefined
      ? { resolvedEmployerId: input.resolvedEmployerId }
      : {}),

    ...(input.primaryLocationHint !== undefined
      ? { primaryLocationHint: input.primaryLocationHint }
      : {}),

    ...(input.displayLabel !== undefined
      ? { displayLabel: input.displayLabel }
      : {}),
  };
}
