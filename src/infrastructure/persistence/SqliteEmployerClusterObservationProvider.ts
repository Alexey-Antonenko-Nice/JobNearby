import type Database from "better-sqlite3";

import type { SourceObservation } from "../../domain/capture/SourceObservation.js";
import type { EmployerClusterId } from "../../domain/recognition/EmployerCluster.js";
import type { EmployerClusterObservationProvider } from "../../domain/recognition/EmployerClusterObservationProvider.js";
import { SqliteSourceObservationRepository } from "./SqliteSourceObservationRepository.js";

export class SqliteEmployerClusterObservationProvider
  implements EmployerClusterObservationProvider
{
  private readonly sourceObservations: SqliteSourceObservationRepository;

  constructor(private readonly db: Database.Database) {
    this.sourceObservations = new SqliteSourceObservationRepository(db);
  }

  async findObservationsByClusterId(
    clusterId: EmployerClusterId,
  ): Promise<readonly SourceObservation[]> {
    const rows = this.db.prepare(`
      SELECT DISTINCT source_observation_id
      FROM observation_cluster_assignments
      WHERE employer_cluster_id = ?
        AND superseded_at IS NULL
        AND status IN ('ACCEPTED', 'USER_CONFIRMED')
      ORDER BY source_observation_id
    `).all(clusterId) as Array<{ source_observation_id: string }>;
    const observations: SourceObservation[] = [];
    for (const { source_observation_id } of rows) {
      const observation = await this.sourceObservations.findById(source_observation_id);
      if (observation === null) {
        throw new Error(
          `Employer-cluster observation integrity error: SourceObservation "${source_observation_id}" could not be reconstructed.`,
        );
      }
      observations.push(observation);
    }
    return observations;
  }
}
