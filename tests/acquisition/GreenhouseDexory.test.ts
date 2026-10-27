import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import Database from "better-sqlite3";
import { BrowserCaptureAcquisitionAdapter } from "../../src/application/acquisition/BrowserCaptureAcquisitionAdapter.js";
import { DeterministicAcquisitionCaptureMapper } from "../../src/application/acquisition/DeterministicAcquisitionCaptureMapper.js";
import { createVacancyEvidenceExtractor } from "../../src/application/evidence/createVacancyEvidenceExtractor.js";
import { createCaptureProcessingRuntime } from "../../src/infrastructure/runtime/createCaptureProcessingRuntime.js";
import { createDatabase } from "../../src/infrastructure/database/createDatabase.js";
import { getVacancyReviewView } from "../../src/application/user/getVacancyReviewView.js";
import { SqliteCanonicalVacancyRepository } from "../../src/infrastructure/persistence/SqliteCanonicalVacancyRepository.js";
import { SqliteSourceObservationRepository } from "../../src/infrastructure/persistence/SqliteSourceObservationRepository.js";
import { SqliteUserVacancyInteractionRepository } from "../../src/infrastructure/persistence/SqliteUserVacancyInteractionRepository.js";
import { SqliteEmployerClusterRepository } from "../../src/infrastructure/persistence/SqliteEmployerClusterRepository.js";
import { SqliteObservationClusterAssignmentRepository } from "../../src/infrastructure/persistence/SqliteObservationClusterAssignmentRepository.js";
import { SqliteEmployerMemoryPublicDataSource } from "../../src/infrastructure/persistence/SqliteEmployerMemoryPublicDataSource.js";
// @ts-expect-error Browser extension is plain JavaScript.
import { captureFeedback } from "../../browser-extension/popup.js";
const html = readFileSync("tests/fixtures/greenhouseDexory.html", "utf8");
const payload = { pageUrl: "https://job-boards.eu.greenhouse.io/dexory/jobs/5017487101", pageTitle: "Dexory", html, visibleText: "unrelated", capturedAt: "2026-10-27T23:00:00Z" };
const qualification = "A technical degree in engineering, robotics, computer science or similar, or equivalent hands-on experience; robotics exposure welcome but not essential.";
async function extract(page = html) {
  const a = new BrowserCaptureAcquisitionAdapter().toAcquisitionPackage({ ...payload, html: page }, "a");
  return createVacancyEvidenceExtractor().extract(new DeterministicAcquisitionCaptureMapper().toSourceObservation(a, "o"));
}
function review(db: Database.Database, id: string) {
  return getVacancyReviewView(id, { canonicalVacancyRepository: new SqliteCanonicalVacancyRepository(db), sourceObservationRepository: new SqliteSourceObservationRepository(db), interactionRepository: new SqliteUserVacancyInteractionRepository(db), employerClusterRepository: new SqliteEmployerClusterRepository(db), assignmentRepository: new SqliteObservationClusterAssignmentRepository(db), employerMemoryPublicDataSource: new SqliteEmployerMemoryPublicDataSource(db) });
}
describe("Dexory saved requirements and company", () => {
  it("retains qualification alternatives, optional robotics and technical responsibility wording", async () => {
    const e = await extract();
    expect(e.educationRequirements?.map(e => e.rawText)).toEqual([qualification]);
    const text = e.skillRequirements?.map(e => e.rawText).join("\n");
    for (const term of ["Linux", "willingness to learn ROS", "triage", "logs", "CAN", "configuration", "connectivity", "mapping", "annotation", "deployment failures"]) expect(text).toContain(term);
    expect(e.experienceRequirements).toEqual([]);
    expect(e.organizations).toContainEqual(expect.objectContaining({ value: "Dexory", role: "DISPLAYED_COMPANY" }));
    expect(e.organizations.some(e => e.role === "EMPLOYER" || e.role === "STAFFING_AGENCY")).toBe(false);
  });
  it("does not infer company from tenant, a client mention or outside text", async () => {
    for (const introduction of ["At our client Dexory, we're", "At Another Company, we're", "Dexory is"]) {
      const e = await extract(html.replace("At Dexory, we're", introduction) + '<footer>At Dexory, we are hiring. You\'ll need a degree.</footer>');
      expect(e.organizations.filter(e => e.value === "Dexory")).toEqual([]);
    }
  });
  it("projects qualifications and technical wording to the existing review fields", async () => {
    const db = createDatabase(":memory:");
    try {
      const result = await createCaptureProcessingRuntime(db).captureAndProcessBrowserVacancy(payload);
      if (result.processing.status !== "PROCESSED") throw Error("Capture failed");
      const r = await review(db, result.processing.canonicalVacancyId);
      expect(r.vacancy.educationRequirements?.[0]?.rawText).toBe(qualification);
      expect(r.vacancy.skillRequirements?.some(e => e.rawText?.includes("CAN"))).toBe(true);
    } finally { db.close(); }
  });
});
it.skipIf(!process.env.DEXORY_STORED_REPLAY || !existsSync("job-nearby.sqlite"))("reuses actual Dexory observation/canonical and preserves decisions and unresolved assignments", async () => {
  const disk = new Database("job-nearby.sqlite", { readonly: true, fileMustExist: true });
  const db = new Database(disk.serialize()); disk.close();
  try {
    const id = "de66bfac-b42a-4f4a-b785-aaf0f2ded9bf", canonical = "ee30d9a8-b024-4d6c-9865-0714deb3c3cb";
    const repo = new SqliteSourceObservationRepository(db), original = (await repo.findById(id))!;
    const a = original.metadata.acquisition as { html: string; pageTitle: string };
    db.prepare(`INSERT INTO user_vacancy_interaction_events (id,canonical_vacancy_id,event_type,occurred_at,recorded_at,metadata_json) VALUES ('dexory-test-interest',?,'INTERESTED','2026-10-27T23:00:00Z','2026-10-27T23:00:00Z',NULL)`).run(canonical);
    db.prepare(`INSERT INTO vacancy_organization_role_decisions (id,canonical_vacancy_id,identity_key,organization_name,normalized_name,role,previous_decision_id,basis_json,override_acknowledged,created_at) VALUES ('dexory-test-role',?,'name:dexory','Dexory','dexory','CLIENT',NULL,'{}',1,'2026-10-27T23:00:00Z')`).run(canonical);
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND (name LIKE '%decision%' OR name LIKE '%interaction%' OR name='observation_cluster_assignments' OR name='confirmed_organization_roles')").all() as { name: string }[];
    const snapshot = () => tables.map(({ name }) => [name, db.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all()]);
    const before = snapshot();
    const runtime = createCaptureProcessingRuntime(db);
    for (const capturedAt of ["2026-10-27T23:01:00Z", "2026-10-27T23:02:00Z"]) {
      const result = await runtime.captureAndProcessBrowserVacancy({ pageUrl: original.source.sourceUrl!, pageTitle: a.pageTitle, html: a.html, visibleText: original.rawContent!, capturedAt });
      expect(result.capture.observationId).toBe(id);
      expect(result.processing).toMatchObject({ status: "PROCESSED", canonicalVacancyId: canonical, observationAdded: false, employerStatus: "UNRESOLVED_EXISTING_RECORD" });
      const r = await review(db, canonical);
      expect(r.employer.status).toBe("UNRESOLVED");
      expect(captureFeedback(result)).toContain("Employer not identified yet.");
      expect(captureFeedback(result)).not.toContain("Linked to an existing employer record");
      expect(r.vacancy.educationRequirements?.[0]?.rawText).toBe(qualification);
      expect(r.vacancy.skillRequirements?.some(e => e.rawText?.includes("CAN"))).toBe(true);
      expect(snapshot()).toEqual(before);
    }
    expect(await repo.findById(id)).toEqual(original);
  } finally { db.close(); }
}, 20_000);
