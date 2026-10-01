import type { EmployerActionContext } from "../../domain/user/EmployerActionContext.js";
import type { EmployerMemoryView } from "../../domain/user/EmployerMemoryView.js";

/** Takes the M12.5 previous-only history. No identity inference or additional reads. */
export function deriveEmployerActionContext(history: EmployerMemoryView | null): EmployerActionContext | null {
  if (history === null || !["PROBABLY_RESOLVED", "RESOLVED"].includes(history.employerCluster.status)) return null;
  const summary = history.summary;
  return {
    knownEmployer: true,
    appliedBefore: summary.everAppliedCount > 0,
    applicationCount: summary.everAppliedCount,
    contactedBefore: summary.everContactedCount > 0,
    contactCount: summary.everContactedCount,
    interviewedBefore: summary.everInterviewedCount > 0,
    interviewCount: summary.everInterviewedCount,
    offeredBefore: summary.everOfferedCount > 0,
    offerCount: summary.everOfferedCount,
    rejectedBefore: summary.everRejectedCount > 0,
    rejectionCount: summary.everRejectedCount,
    withdrawnBefore: summary.everWithdrawnCount > 0,
    withdrawalCount: summary.everWithdrawnCount,
    lastApplicationAt: summary.latestApplicationAt,
    lastInteractionAt: summary.latestUserInteractionAt,
    lastInteractionType: summary.latestUserInteractionType,
  };
}
