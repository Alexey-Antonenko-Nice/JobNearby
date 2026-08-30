import type {
  SourceObservation,
  SourceObservationId,
} from "../../domain/capture/SourceObservation.js";
import type { VacancyEvidenceExtractor } from "../../domain/evidence/VacancyEvidenceExtractor.js";
import type { VacancyEvidenceExtractionInput } from "../../domain/evidence/VacancyEvidenceInput.js";
import type { EmployerCluster } from "../../domain/recognition/EmployerCluster.js";
import type { EmployerClusterObservationProvider } from "../../domain/recognition/EmployerClusterObservationProvider.js";
import type {
  EmployerClusterMatch,
  EmployerClusterMatcher,
} from "../../domain/recognition/EmployerClusterMatcher.js";
import type { EmployerEvidenceComparison } from "../../domain/recognition/EmployerEvidenceComparison.js";
import type { EmployerMatchAssessment } from "../../domain/recognition/EmployerMatchAssessment.js";
import { assessEmployerMatchDimensions } from "../../domain/recognition/assessEmployerMatchDimensions.js";
import { calculateEmployerMatchConfidence } from "../../domain/recognition/calculateEmployerMatchConfidence.js";
import { compareEmployerEvidence } from "../../domain/recognition/compareEmployerEvidence.js";

export interface EvidenceBasedEmployerClusterMatch extends EmployerClusterMatch {
  readonly matchedObservationId: SourceObservationId;
  readonly comparison: EmployerEvidenceComparison;
  readonly assessment: EmployerMatchAssessment;
}

export interface EvidenceBasedEmployerClusterMatcherDependencies {
  readonly evidenceExtractor: VacancyEvidenceExtractor;
  readonly observationProvider: EmployerClusterObservationProvider;
}

export class EvidenceBasedEmployerClusterMatcher
  implements EmployerClusterMatcher
{
  constructor(
    private readonly dependencies: EvidenceBasedEmployerClusterMatcherDependencies,
  ) {}

  async findBestMatch(
    observation: VacancyEvidenceExtractionInput,
    candidates: readonly EmployerCluster[],
  ): Promise<EvidenceBasedEmployerClusterMatch | null> {
    if (candidates.length === 0) return null;

    const histories: Array<{
      readonly cluster: EmployerCluster;
      readonly observations: readonly SourceObservation[];
    }> = [];
    for (const cluster of candidates) {
      const observations =
        await this.dependencies.observationProvider.findObservationsByClusterId(
          cluster.id,
        );
      if (observations.length > 0) histories.push({ cluster, observations });
    }
    if (histories.length === 0) return null;

    const newEvidence =
      await this.dependencies.evidenceExtractor.extract(observation);
    let bestMatch: EvidenceBasedEmployerClusterMatch | null = null;

    for (const { cluster, observations } of histories) {
      let clusterBest: EvidenceBasedEmployerClusterMatch | null = null;
      for (const historicalObservation of observations) {
        const historicalEvidence =
          await this.dependencies.evidenceExtractor.extract(
            historicalObservation,
          );
        const comparison = compareEmployerEvidence(
          newEvidence,
          historicalEvidence,
        );
        const assessment = assessEmployerMatchDimensions(comparison);
        const confidence = calculateEmployerMatchConfidence(assessment);
        if (clusterBest === null || confidence > clusterBest.confidence) {
          clusterBest = {
            cluster,
            confidence,
            matchedObservationId: historicalObservation.id,
            comparison,
            assessment,
            explanation: `Best historical observation match: ${historicalObservation.id}.`,
          };
        }
      }

      if (
        clusterBest !== null &&
        (bestMatch === null || clusterBest.confidence > bestMatch.confidence)
      ) {
        bestMatch = clusterBest;
      }
    }

    return bestMatch;
  }
}
