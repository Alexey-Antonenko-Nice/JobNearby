import type {
  SourceObservationId,
} from "../capture/SourceObservation.js";
import type { VacancyEvidenceExtractionInput } from "../evidence/VacancyEvidenceInput.js";
import type { EmployerCluster } from "./EmployerCluster.js";
import type { EmployerEvidenceComparison } from "./EmployerEvidenceComparison.js";
import type { EmployerMatchAssessment } from "./EmployerMatchAssessment.js";

export interface EmployerClusterMatch {
  readonly cluster: EmployerCluster;
  readonly confidence: number;
  readonly matchedObservationId?: SourceObservationId;
  readonly comparison?: EmployerEvidenceComparison;
  readonly assessment?: EmployerMatchAssessment;
  readonly explanation?: string;
}

export interface EmployerClusterMatcher {
  findBestMatch(
    observation: VacancyEvidenceExtractionInput,
    candidates: readonly EmployerCluster[],
  ): Promise<EmployerClusterMatch | null>;
}
