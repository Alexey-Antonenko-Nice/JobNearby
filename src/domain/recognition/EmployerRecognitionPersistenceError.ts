export class EffectiveAssignmentConflictError extends Error {
  constructor(sourceObservationId: string) {
    super(
      `SourceObservation "${sourceObservationId}" already has an effective employer-cluster assignment.`,
    );
    this.name = "EffectiveAssignmentConflictError";
  }
}

export class CurrentProposalConflictError extends Error {
  constructor(sourceObservationId: string) {
    super(
      `SourceObservation "${sourceObservationId}" already has a current employer-cluster proposal.`,
    );
    this.name = "CurrentProposalConflictError";
  }
}
