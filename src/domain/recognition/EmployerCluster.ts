export type EmployerClusterId = string;

export type EmployerClusterStatus =
  | "UNRESOLVED"
  | "PROBABLY_RESOLVED"
  | "RESOLVED"
  | "CONFLICTED";

export interface EmployerCluster {
  readonly id: EmployerClusterId;

  readonly status: EmployerClusterStatus;

  readonly createdAt: Date;
  readonly updatedAt: Date;

  readonly resolvedEmployerId?: string;

  readonly primaryLocationHint?: string;
  readonly displayLabel?: string;
}
