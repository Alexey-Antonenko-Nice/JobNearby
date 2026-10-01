import { describe, expect, it, vi } from "vitest";

import { getVacancyReviewView } from "../../src/application/user/getVacancyReviewView.js";
import type { SourceObservation } from "../../src/domain/capture/SourceObservation.js";
import { createDatabase } from "../../src/infrastructure/database/createDatabase.js";
import { SqliteCanonicalVacancyRepository } from "../../src/infrastructure/persistence/SqliteCanonicalVacancyRepository.js";
import { SqliteEmployerClusterRepository } from "../../src/infrastructure/persistence/SqliteEmployerClusterRepository.js";
import { SqliteEmployerMemoryPublicDataSource } from "../../src/infrastructure/persistence/SqliteEmployerMemoryPublicDataSource.js";
import { SqliteSourceObservationRepository } from "../../src/infrastructure/persistence/SqliteSourceObservationRepository.js";
import { SqliteUserVacancyInteractionRepository } from "../../src/infrastructure/persistence/SqliteUserVacancyInteractionRepository.js";
import { heuftVacancy } from "../vacancies/CanonicalVacancyRepository.contract.js";

describe("VacancyReviewView SQLite composition", () => {
  it("summarizes cross-provider observations without mutating public or private persistence", async () => {
    const db = createDatabase(":memory:");
    const sources = new SqliteSourceObservationRepository(db);
    await sources.save(observation("heuft-a", "linkedin.com", "2026-09-01T00:00:00Z"));
    await sources.save(observation("heuft-b", "candidat.francetravail.fr", "2026-09-02T00:00:00Z"));
    const clusters = new SqliteEmployerClusterRepository(db);
    await clusters.save({
      id: "cluster-heuft", status: "UNRESOLVED",
      createdAt: new Date("2026-09-01T00:00:00Z"), updatedAt: new Date("2026-09-01T00:00:00Z"),
    });
    db.prepare(`INSERT INTO observation_cluster_assignments (
      id, source_observation_id, employer_cluster_id, confidence, status,
      algorithm, algorithm_version, evaluated_at
    ) VALUES ('assignment-heuft', 'heuft-a', 'cluster-heuft', 0.99, 'ACCEPTED',
      'test', '1', '2026-09-01T00:00:00Z')`).run();
    const original = heuftVacancy();
    const vacancy = {
      ...original,
      organizationRelationships: original.organizationRelationships.map((relationship) => ({
        ...relationship, employerClusterId: "cluster-heuft",
      })),
    };
    const canonical = new SqliteCanonicalVacancyRepository(db);
    await canonical.save(vacancy);
    const interactions = new SqliteUserVacancyInteractionRepository(db);
    const before = snapshot(db);
    const batch = vi.spyOn(sources, "findByIds");
    const single = vi.spyOn(sources, "findById");

    const view = await getVacancyReviewView(vacancy.id, {
      canonicalVacancyRepository: canonical,
      sourceObservationRepository: sources,
      interactionRepository: interactions,
      employerClusterRepository: clusters,
      employerMemoryPublicDataSource: new SqliteEmployerMemoryPublicDataSource(db),
    });

    expect(view.vacancy).toMatchObject({
      canonicalVacancyId: vacancy.id, title: "Service technician",
      engagement: { rawTerms: ["CDI"], normalizedTerms: ["PERMANENT_EMPLOYMENT"] },
      sourceObservationCount: 2, latestObservedAt: new Date("2026-09-02T00:00:00Z"),
    });
    expect(view.reviewSignals).toMatchObject({
      isNewVacancy: true, hasMultipleSourceObservations: true,
    });
    expect(view.organizations.employerRelationships).toEqual([
      expect.objectContaining({ rawName: "HEUFT France", employerClusterId: "cluster-heuft", role: "EMPLOYER" }),
    ]);
    expect(view.vacancyContext).toMatchObject({
      currentCanonicalVacancyId: vacancy.id, seenBefore: true, observationCount: 2, sourceCount: 2,
      sourceProviders: ["candidat.francetravail.fr", "linkedin.com"],
      firstSeenAt: new Date("2026-09-01"), lastSeenAt: new Date("2026-09-02"),
      currentSourceProvider: null, appliedBefore: false, rejectedBefore: false,
    });
    expect(batch).toHaveBeenCalledTimes(1);
    expect(single).not.toHaveBeenCalled();
    expect(JSON.parse(JSON.stringify(view)).vacancyContext.firstSeenAt).toBe("2026-09-01T00:00:00.000Z");
    expect(snapshot(db)).toEqual(before);
    await interactions.append({ id: "applied", canonicalVacancyId: vacancy.id, type: "APPLIED",
      occurredAt: new Date("2026-09-03"), recordedAt: new Date("2026-09-03"), metadata: { sourceObservationId: "heuft-a" } });
    db.prepare("UPDATE observation_cluster_assignments SET status = 'REJECTED'").run();
    const acted = await getVacancyReviewView(vacancy.id, {
      canonicalVacancyRepository: canonical, sourceObservationRepository: sources,
      interactionRepository: interactions, employerClusterRepository: clusters,
      employerMemoryPublicDataSource: new SqliteEmployerMemoryPublicDataSource(db),
    });
    expect(acted.vacancyContext).toMatchObject({ appliedBefore: true, rejectedBefore: false, appliedViaProvider: "linkedin.com", latestInteractionType: "APPLIED" });
    expect(await interactions.findByCanonicalVacancyId(vacancy.id)).toHaveLength(1);
    db.close();
  });
});

function observation(id: string, provider: string, observedAt: string): SourceObservation {
  return {
    id, source: { sourceType: "JOB_BOARD", sourceName: provider, externalId: `${provider}-${id}` },
    observedAt: new Date(observedAt), metadata: {},
  };
}

function snapshot(db: ReturnType<typeof createDatabase>): string {
  const tables = [
    "source_observations", "canonical_vacancies", "canonical_vacancy_source_observations",
    "canonical_vacancy_fields", "canonical_vacancy_organization_relationships",
    "employer_clusters", "observation_cluster_assignments", "user_vacancy_interaction_events",
  ];
  return JSON.stringify(Object.fromEntries(tables.map((table) => [
    table, db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all(),
  ])));
}
