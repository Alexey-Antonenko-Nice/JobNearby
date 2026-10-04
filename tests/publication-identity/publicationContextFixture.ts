import { createDatabase } from "../../src/infrastructure/database/createDatabase.js";
import { InMemorySourceObservationRepository } from "../../src/infrastructure/persistence/InMemorySourceObservationRepository.js";
import { SqliteSourceObservationRepository } from "../../src/infrastructure/persistence/SqliteSourceObservationRepository.js";
import { InMemoryEmployerClusterRepository } from "../../src/infrastructure/persistence/InMemoryEmployerClusterRepository.js";
import { SqliteEmployerClusterRepository } from "../../src/infrastructure/persistence/SqliteEmployerClusterRepository.js";
import { InMemoryPublicationFamilyRepository } from "../../src/infrastructure/persistence/InMemoryPublicationFamilyRepository.js";
import { SqlitePublicationFamilyRepository } from "../../src/infrastructure/persistence/SqlitePublicationFamilyRepository.js";
import { InMemoryRecruitmentCampaignRepository } from "../../src/infrastructure/persistence/InMemoryRecruitmentCampaignRepository.js";
import { SqliteRecruitmentCampaignRepository } from "../../src/infrastructure/persistence/SqliteRecruitmentCampaignRepository.js";
import { InMemoryPublicationCampaignContextSource } from "../../src/infrastructure/persistence/InMemoryPublicationCampaignContextSource.js";
import { SqlitePublicationCampaignContextSource } from "../../src/infrastructure/persistence/SqlitePublicationCampaignContextSource.js";
import { InMemoryCanonicalVacancyRepository } from "../../src/infrastructure/persistence/InMemoryCanonicalVacancyRepository.js";
import { SqliteCanonicalVacancyRepository } from "../../src/infrastructure/persistence/SqliteCanonicalVacancyRepository.js";
import { InMemoryUserVacancyInteractionRepository } from "../../src/infrastructure/persistence/InMemoryUserVacancyInteractionRepository.js";
import { SqliteUserVacancyInteractionRepository } from "../../src/infrastructure/persistence/SqliteUserVacancyInteractionRepository.js";
import { createVacancyReviewWorkflow } from "../../src/application/user/createVacancyReviewWorkflow.js";
import { DeterministicCanonicalVacancyCanonicalizer } from "../../src/application/vacancies/DeterministicCanonicalVacancyCanonicalizer.js";
import type { PublicationFamilyMembership } from "../../src/domain/publication-identity/PublicationFamily.js";
import type { RecruitmentCampaignMembership } from "../../src/domain/publication-identity/RecruitmentCampaign.js";
import type { MembershipDecision } from "../../src/domain/publication-identity/MembershipDecision.js";

export const at = new Date("2026-10-01T00:00:00Z");
export const later = new Date("2026-10-02T00:00:00Z");
export function decision(id: string): MembershipDecision { return {
  id, confidence: 0.87, status: "USER_CONFIRMED", algorithm: "manual-review", algorithmVersion: "1", sourceType: "USER_CONFIRMED", evaluatedAt: at, createdAt: at, explanation: "Explicitly confirmed",
}; }
export const fm = (id: string, sourceObservationId: string, publicationFamilyId = "f1", extra: Partial<PublicationFamilyMembership> = {}): PublicationFamilyMembership => ({ ...decision(id), sourceObservationId, publicationFamilyId, ...extra });
export const cm = (id: string, recruitmentCampaignId: string, target: { publicationFamilyId: string } | { sourceObservationId: string }, extra: Partial<MembershipDecision> = {}): RecruitmentCampaignMembership => ({ ...decision(id), recruitmentCampaignId, ...target, ...extra });
export async function contextFixture(kind: "memory" | "sqlite", employerStatus: "UNRESOLVED" | "CONFLICTED" = "UNRESOLVED", databasePath = ":memory:") {
  const db = kind === "sqlite" ? createDatabase(databasePath) : null;
  const observations = db ? new SqliteSourceObservationRepository(db) : new InMemorySourceObservationRepository();
  const employers = db ? new SqliteEmployerClusterRepository(db) : new InMemoryEmployerClusterRepository();
  const obs = [["a", "Indeed.com", "2026-09-12"], ["b", "hellowork.com", "2026-09-28"], ["c", "indeed.com", "2026-09-20"], ["outside", "LINKEDIN.COM", "2026-09-01"], ["inactive", "excluded.com", "2020-01-01"]] as const;
  for (const [id, sourceName, date] of obs) await observations.save({ id, source: { sourceName, sourceType: "JOB_BOARD" }, observedAt: new Date(date), publishedAt: new Date("2000-01-01"), metadata: {} });
  for (const id of ["current-employer", "campaign-employer"]) await employers.save({ id, status: employerStatus, createdAt: at, updatedAt: at });
  const memoryFamilies = new InMemoryPublicationFamilyRepository(observations);
  const families = db ? new SqlitePublicationFamilyRepository(db) : memoryFamilies;
  const memoryCampaigns = new InMemoryRecruitmentCampaignRepository(observations, employers, memoryFamilies);
  const campaigns = db ? new SqliteRecruitmentCampaignRepository(db) : memoryCampaigns;
  for (const id of ["f1", "f2"]) await families.save({ id, createdAt: at, updatedAt: at, representativeTitle: `Title ${id}` });
  for (const id of ["c1", "c2"]) await campaigns.save({ id, employerClusterId: "campaign-employer", status: id === "c1" ? "ENDED" : "PROBABLY_ACTIVE", firstObservedAt: new Date("2025-01-01"), lastObservedAt: at, createdAt: at, updatedAt: at });
  const source = db ? new SqlitePublicationCampaignContextSource(db) : new InMemoryPublicationCampaignContextSource(memoryFamilies, memoryCampaigns, observations);
  const canonical = db ? new SqliteCanonicalVacancyRepository(db) : new InMemoryCanonicalVacancyRepository(observations);
  const derivation = { algorithm: "fixture", algorithmVersion: "1", derivedAt: at };
  const builder = new DeterministicCanonicalVacancyCanonicalizer();
  for (const [id, ids] of [["current", ["a", "b", "c"]], ["other", ["outside"]]] as const) await canonical.save(builder.canonicalize({ id, sourceObservationIds: ids, evidenceReferences: [{ id: `evidence-${id}`, sourceObservationId: ids[0], kind: "TEST" }], derivation,
    organizationRelationships: [{ role: "EMPLOYER", employerClusterId: "current-employer", supportingEvidenceIds: [`evidence-${id}`], derivation }],
  }));
  const interactions = db ? new SqliteUserVacancyInteractionRepository(db) : new InMemoryUserVacancyInteractionRepository();
  const workflow = createVacancyReviewWorkflow({ canonicalVacancyRepository: canonical, sourceObservationRepository: observations, interactionRepository: interactions,
    employerClusterRepository: employers, employerMemoryPublicDataSource: { findByEmployerClusterId: async () => [] }, publicationCampaignContextSource: source,
    now: () => later, generateId: () => "action-current",
  });
  return { db, observations, employers, families, campaigns, source, canonical, interactions, workflow, close: () => db?.close() };
}
export async function seedPaths(f: Awaited<ReturnType<typeof contextFixture>>) {
  // Record direct paths before observations join a family; these decisions stay active.
  await f.campaigns.addMembership(cm("direct-c1", "c1", { sourceObservationId: "c" }));
  await f.campaigns.addMembership(cm("direct-c2", "c2", { sourceObservationId: "a" }));
  await f.families.addMembership(fm("f1-a", "a"));
  await f.families.addMembership(fm("f1-b", "b"));
  await f.families.addMembership(fm("f1-outside", "outside"));
  await f.families.addMembership(fm("f2-c", "c", "f2"));
  await f.campaigns.addMembership(cm("via-f1", "c1", { publicationFamilyId: "f1" }));
  await f.campaigns.addMembership(cm("via-f2", "c1", { publicationFamilyId: "f2" }));
  await f.campaigns.addMembership(cm("via-f1-c2", "c2", { publicationFamilyId: "f1" }));
}
