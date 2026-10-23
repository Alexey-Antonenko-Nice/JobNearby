import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BrowserCaptureAcquisitionAdapter } from "../../src/application/acquisition/BrowserCaptureAcquisitionAdapter.js";
import { DeterministicAcquisitionCaptureMapper } from "../../src/application/acquisition/DeterministicAcquisitionCaptureMapper.js";
import { alstomPostingId, AlstomSelectedVacancyContextLocator } from "../../src/application/acquisition/AlstomVacancy.js";
import { createVacancyEvidenceExtractor } from "../../src/application/evidence/createVacancyEvidenceExtractor.js";
import { ExistingPipelineCanonicalVacancyAdapter } from "../../src/application/vacancies/ExistingPipelineCanonicalVacancyAdapter.js";
import { DeterministicCanonicalVacancyCanonicalizer } from "../../src/application/vacancies/DeterministicCanonicalVacancyCanonicalizer.js";
import { createDatabase } from "../../src/infrastructure/database/createDatabase.js";
import { createCaptureProcessingRuntime } from "../../src/infrastructure/runtime/createCaptureProcessingRuntime.js";
import { SqliteSourceObservationRepository } from "../../src/infrastructure/persistence/SqliteSourceObservationRepository.js";
import { SqliteCanonicalVacancyRepository } from "../../src/infrastructure/persistence/SqliteCanonicalVacancyRepository.js";
import { SqliteEmployerClusterRepository } from "../../src/infrastructure/persistence/SqliteEmployerClusterRepository.js";
import { SqliteObservationClusterAssignmentRepository } from "../../src/infrastructure/persistence/SqliteObservationClusterAssignmentRepository.js";
import { SqliteUserVacancyInteractionRepository } from "../../src/infrastructure/persistence/SqliteUserVacancyInteractionRepository.js";
import { SqliteEmployerMemoryPublicDataSource } from "../../src/infrastructure/persistence/SqliteEmployerMemoryPublicDataSource.js";
import { SqliteVacancyOrganizationRoleDecisionRepository } from "../../src/infrastructure/persistence/SqliteVacancyOrganizationRoleDecisionRepository.js";
import { SqliteConfirmedOrganizationRoleRepository } from "../../src/infrastructure/persistence/SqliteConfirmedOrganizationRoleRepository.js";
import { createVacancyReviewWorkflow } from "../../src/application/user/createVacancyReviewWorkflow.js";
import { createEmployerCluster } from "../../src/application/recognition/createEmployerCluster.js";
import { createObservationClusterAssignment } from "../../src/application/recognition/createObservationClusterAssignment.js";
import type { SourceObservation } from "../../src/domain/capture/SourceObservation.js";
import { describeEmployerProjection } from "../../src/infrastructure/database/EmployerProjectionDiagnostic.js";
const url = "https://jobsearch.alstom.com/job/Charleroi-Software-Developer/1440956933/";
const html = readFileSync("tests/fixtures/alstomSelectedVacancy.html", "utf8");
const capturedAt = new Date("2026-10-24T10:00:00Z");
const payload = {
  pageUrl: url,
  pageTitle: "Software Developer Job Details | Alstom",
  visibleText: "Log in Create Alert Remote Other Company 999999 EUR / YEAR",
  html,
  capturedAt
};
function capture(content = html, pageUrl = url) {
  const acquisition = new BrowserCaptureAcquisitionAdapter().toAcquisitionPackage({
    ...payload,
    html: content,
    pageUrl
  }, "acquisition");
  return {
    acquisition,
    observation: new DeterministicAcquisitionCaptureMapper().toSourceObservation(acquisition, "observation")
  };
}
async function project(content = html) {
  const {
    acquisition,
    observation
  } = capture(content);
  const evidence = await createVacancyEvidenceExtractor().extract(observation);
  const canonical = new ExistingPipelineCanonicalVacancyAdapter(new DeterministicCanonicalVacancyCanonicalizer()).canonicalize({
    canonicalVacancyId: "canonical",
    observations: [observation],
    extractedEvidence: [evidence],
    derivation: {
      algorithm: "test",
      algorithmVersion: "1",
      derivedAt: capturedAt
    }
  });
  return {
    acquisition,
    observation,
    evidence,
    canonical
  };
}
describe("bounded Alstom careers capture", () => {
  it.each([url, url.slice(0, -1), url + "?utm_source=control#detail"])("validates the detail route: %s", value => expect(alstomPostingId(value)).toBe("1440956933"));
  it.each([url.replace("jobsearch.alstom.com", "alstom.com"), url.replace("jobsearch.alstom.com", "jobsearch.alstom.com.evil.test"), url.replace("/job/", "/search/"), url.replace("1440956933", "not-an-id"), "https://jobsearch.alstom.com/search/?q=1440956933", "javascript:1440956933"])("rejects unsupported routes: %s", value => expect(alstomPostingId(value)).toBeUndefined());
  it("captures the header and complete table description while excluding surrounding modules", async () => {
    const {
      acquisition,
      canonical
    } = await project();
    const context = acquisition.contexts![0]!;
    expect(context).toMatchObject({
      providerKey: "ALSTOM",
      providerExternalId: "1440956933",
      metadata: {
        requisitionId: "521407"
      }
    });
    expect(context.html?.match(/<table\b/giu)).toHaveLength(1);
    expect(context.html).toContain("</table>");
    expect(context.text).toContain("JOB TITLE & PURPOSE");
    expect(context.text).toContain("Behavioural Skills");
    expect(context.text).toContain("equal-opportunity employer");
    expect(context.html).not.toMatch(/<form|<nav|<aside|<input|Create Alert|Apply now|999999|Other Company/iu);
    expect(canonical.role).toMatchObject({
      status: "RESOLVED",
      value: {
        title: "Software Developer"
      }
    });
    expect(canonical.location).toMatchObject({
      status: "RESOLVED",
      value: {
        rawText: "Charleroi, BE"
      }
    });
    for (const field of [canonical.compensation, canonical.engagement, canonical.workMode]) expect(field.status).toBe("UNKNOWN");
  });
  it("keeps posting and requisition identifiers in separate namespaces without conflict", async () => {
    const {
      observation,
      evidence,
      canonical
    } = await project();
    expect(observation.source.externalId).toBe("1440956933");
    expect(evidence.externalIdentifiers).toContainEqual(expect.objectContaining({
      value: "1440956933",
      identifierType: "URL_POSTING_ID"
    }));
    expect(evidence.externalIdentifiers).toContainEqual(expect.objectContaining({
      value: "521407",
      identifierType: "REQUISITION_ID"
    }));
    expect(canonical.canonicalizationStatus).not.toBe("CONFLICTED");
  });
  it("uses optional fields only when explicitly labelled inside the selected description", async () => {
    const {
      canonical
    } = await project(html.replace("Req ID:", "</p><p>Work mode: Remote</p><p>Employment type: Full time</p><p>Salary: 50000–60000 EUR/year</p><p>Req ID:"));
    expect(canonical.workMode.value).toBe("REMOTE");
    expect(canonical.engagement.value?.normalizedTerms).toEqual(["FULL_TIME"]);
    expect(canonical.compensation.value).toMatchObject({
      minimum: 50000,
      maximum: 60000,
      currency: "EUR",
      period: "YEAR"
    });
  });
  it("does not infer salary periods or resolve contradictory work-mode labels", async () => {
    const {
      canonical
    } = await project(html.replace("Req ID:", "</p><p>Work mode: Remote</p><p>Work mode: On-site</p><p>Salary: 50000 EUR</p><p>Req ID:"));
    expect(canonical.workMode.status).toBe("UNKNOWN");
    expect(canonical.compensation.value).toMatchObject({
      minimum: 50000,
      currency: "EUR"
    });
    expect(canonical.compensation.value?.period).toBeUndefined();
  });
  it("uses the explicitly labelled publication day rather than microdata time or capture date", async () => {
    expect((await project()).observation.publishedAt?.toISOString()).toBe("2026-10-23T00:00:00.000Z");
  });
  it.each([html.replace("23 Oct 2026", "31 Feb 2026"), html.replace("Date: ", "Updated: ")])("does not invent a publication date for invalid/unlabelled dates", async content => expect((await project(content)).observation.publishedAt).toBeUndefined());
  it("recommends employer from first-person company/employer evidence, without human confirmation", async () => {
    const {
      evidence
    } = await project();
    expect(evidence.organizations).toContainEqual(expect.objectContaining({
      value: "Alstom",
      role: "DISPLAYED_COMPANY"
    }));
    expect(evidence.organizations).toContainEqual(expect.objectContaining({
      value: "Alstom",
      role: "EMPLOYER",
      provenance: expect.objectContaining({
        confidence: .98
      })
    }));
  });
  it("does not infer employer from the hostname or displayed company alone", async () => {
    const {
      evidence
    } = await project(html.replace("At Alstom, we", "At our business, we").replace("equal-opportunity employer", "inclusive business"));
    expect(evidence.organizations.map(o => o.role)).toEqual(["DISPLAYED_COMPANY"]);
  });
  it.each([html.replace('/talentcommunity/apply/1440956933/', '/talentcommunity/apply/1440956934/'), html.replace('rel="canonical" href="' + url, 'rel="canonical" href="' + url.replace('1440956933', '1440956934')), html.replace('id="job-title"', 'id="unknown-title"'), html.replace('class="jobdescription"', 'class="unknown-description"'), html.replace('Req ID:', 'Missing ID:'), html.replace('Req ID:', 'Req ID: 123456. Req ID:'), html.replace('class="jobDisplayShell"', 'class="jobDisplayShell" hidden'), html.replace('id="job-title"', 'id="job-title" style="display:none"'), html.replace('id="job-company"', 'id="unknown-company"'), html.replace('<h1 id="job-title"', '<h1 id="job-title">Wrong role</h1><h1 id="job-title"')])("fails closed on missing/ambiguous selected facts or conflicting posting identity", async content => {
    const {
      acquisition,
      evidence
    } = await project(content);
    expect(acquisition.contexts).toBeUndefined();
    for (const values of [evidence.vacancyTitles, evidence.locations, evidence.organizations, evidence.compensations, evidence.engagements, evidence.workModes]) expect(values).toEqual([]);
  });
  it("checks supplied posting identity and never compares it against the requisition", () => {
    const locator = new AlstomSelectedVacancyContextLocator();
    expect(locator.locate({
      providerKey: "ALSTOM",
      sourceUrl: url,
      html,
      externalId: "521407"
    })).toBeUndefined();
    expect(locator.locate({
      providerKey: "ALSTOM",
      sourceUrl: url,
      html,
      externalId: "1440956933"
    })).toBeDefined();
  });
  it("revalidates legacy HTML and strips stale whole-page fields without changing the source", async () => {
    const {
      observation
    } = capture();
    const stale = {
      ...observation,
      title: "Create Alert",
      displayedCompanyName: "Wrong",
      locationText: "Remote",
      salaryText: "999999 EUR / YEAR",
      contractText: "Full time",
      rawContent: payload.visibleText
    };
    const before = structuredClone(stale),
      evidence = await createVacancyEvidenceExtractor().extract(stale);
    expect(evidence.vacancyTitles.map(t => t.value)).toEqual(["Software Developer"]);
    expect(evidence.compensations).toEqual([]);
    expect(evidence.workModes).toEqual([]);
    expect(evidence.engagements).toEqual([]);
    expect(stale).toEqual(before);
  });
});
function fixture() {
  const db = createDatabase(":memory:");
  const deps = {
    canonicalVacancyRepository: new SqliteCanonicalVacancyRepository(db),
    sourceObservationRepository: new SqliteSourceObservationRepository(db),
    employerClusterRepository: new SqliteEmployerClusterRepository(db),
    assignmentRepository: new SqliteObservationClusterAssignmentRepository(db),
    interactionRepository: new SqliteUserVacancyInteractionRepository(db),
    employerMemoryPublicDataSource: new SqliteEmployerMemoryPublicDataSource(db),
    organizationRoleDecisionRepository: new SqliteVacancyOrganizationRoleDecisionRepository(db),
    agencyMemoryRepository: new SqliteConfirmedOrganizationRoleRepository(db)
  };
  const workflow = createVacancyReviewWorkflow(deps),
    runtime = createCaptureProcessingRuntime(db);
  async function legacy(id = "de0183ea-1779-412c-a581-281272772f27", canonicalId = "ac370925-2f6f-4f7f-9bef-bf3dcec97235", content = html, pageUrl = url) {
    const observation: SourceObservation = {
      id,
      source: {
        sourceType: "BROWSER_CAPTURE",
        sourceName: "jobsearch.alstom.com",
        sourceUrl: pageUrl
      },
      observedAt: new Date("2026-10-23T20:08:42Z"),
      rawContent: payload.visibleText,
      metadata: {
        acquisition: {
          html: content
        }
      }
    };
    await deps.sourceObservationRepository.save(observation);
    const cluster = createEmployerCluster({
      status: "UNRESOLVED"
    });
    await deps.employerClusterRepository.save(cluster);
    await deps.assignmentRepository.save(createObservationClusterAssignment({
      sourceObservationId: id,
      employerClusterId: cluster.id,
      status: "ACCEPTED",
      confidence: 1,
      algorithm: "legacy",
      algorithmVersion: "1"
    }));
    await deps.canonicalVacancyRepository.save(new DeterministicCanonicalVacancyCanonicalizer().canonicalize({
      id: canonicalId,
      sourceObservationIds: [id],
      evidenceReferences: [],
      organizationRelationships: [],
      derivation: {
        algorithm: "legacy",
        algorithmVersion: "1",
        derivedAt: capturedAt
      }
    }));
    return {
      observation,
      canonicalId,
      cluster
    };
  }
  return {
    db,
    deps,
    workflow,
    runtime,
    legacy
  };
}
describe("Alstom legacy continuity and recapture", () => {
  it("distinguishes a stale stored employer projection from the human assignment and safely refreshes it on exact recapture", async () => {
    const f = fixture();
    try {
      const { canonicalId } = await f.legacy();
      const first = await f.runtime.captureAndProcessBrowserVacancy(payload);
      const storedBefore = (await f.deps.canonicalVacancyRepository.findById(canonicalId))!;
      const oldClusterId = storedBefore.organizationRelationships.find(r => r.employerClusterId)?.employerClusterId;
      expect(oldClusterId).toBeTruthy();
      const card = (await f.workflow.getVacancyReview(canonicalId)).organizationRoleReview![0]!;
      const view = await f.workflow.decideVacancyOrganizationRole({ canonicalVacancyId: canonicalId, requestId: "confirm-alstom-employer", identityKey: card.identityKey, role: "EMPLOYER", candidateToken: card.candidateToken, acknowledgeContradiction: false });
      const confirmedId = view.employer.employerClusterId!;
      expect(confirmedId).not.toBe(oldClusterId);
      expect(view.organizations.employerRelationships.filter(r => r.employerClusterId).map(r => r.employerClusterId)).toEqual([confirmedId]);
      expect((await f.workflow.getVacancyInbox()).find(v => v.canonicalVacancyId === canonicalId)?.employer.employerClusterId).toBe(confirmedId);
      expect((await f.deps.employerMemoryPublicDataSource.findByEmployerClusterId(oldClusterId!)).some(v => v.canonicalVacancyId === canonicalId)).toBe(false);
      expect((await f.deps.employerMemoryPublicDataSource.findByEmployerClusterId(confirmedId)).some(v => v.canonicalVacancyId === canonicalId)).toBe(true);
      const storedAfterConfirmation = (await f.deps.canonicalVacancyRepository.findById(canonicalId))!;
      expect(storedAfterConfirmation).toEqual(storedBefore);
      const diagnose = (relationships: typeof storedBefore.organizationRelationships) => describeEmployerProjection(relationships.map(r => ({ role: r.role, employer_cluster_id: r.employerClusterId ?? null })), { clusterId: confirmedId, status: "USER_CONFIRMED" });
      expect(diagnose(storedAfterConfirmation.organizationRelationships)).toMatchObject({ source: "STORED_CAPTURE_PROJECTION", storedClusterIds: [oldClusterId], effectiveObservationAssignmentClusterId: confirmedId, matchesEffectiveObservationAssignment: false });
      const snapshot = () => JSON.stringify(["vacancy_organization_role_decisions", "observation_cluster_assignments", "employer_clusters", "source_observations"].map(table => [table, f.db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]));
      const before = snapshot();
      const repeated = await f.runtime.captureAndProcessBrowserVacancy(payload);
      expect(repeated.capture.observationId).toBe(first.capture.observationId);
      expect(repeated.processing).toMatchObject({ canonicalVacancyId: canonicalId, observationAdded: false });
      const refreshed = (await f.deps.canonicalVacancyRepository.findById(canonicalId))!;
      expect(diagnose(refreshed.organizationRelationships)).toMatchObject({ storedClusterIds: [confirmedId], matchesEffectiveObservationAssignment: true });
      expect(snapshot()).toBe(before);
    } finally { f.db.close(); }
  });
  it.each(["EMPLOYER", "STAFFING_AGENCY"] as const)("preserves the original canonical, immutable source and human %s decision", async role => {
    const f = fixture();
    try {
      const {
        observation,
        canonicalId
      } = await f.legacy();
      await f.workflow.recordVacancyReviewAction({
        canonicalVacancyId: canonicalId,
        type: "REVIEWED"
      });
      const card = (await f.workflow.getVacancyReview(canonicalId)).organizationRoleReview![0]!;
      expect(card.recommendedRole).toBe("EMPLOYER");
      const confirmed = await f.workflow.decideVacancyOrganizationRole({
        canonicalVacancyId: canonicalId,
        requestId: "human-role",
        identityKey: card.identityKey,
        role,
        candidateToken: card.candidateToken,
        acknowledgeContradiction: true
      });
      const decisions = f.db.prepare("SELECT * FROM vacancy_organization_role_decisions").all();
      const original = await f.deps.sourceObservationRepository.findById(observation.id);
      const result = await f.runtime.captureAndProcessBrowserVacancy(payload);
      expect(result.processing).toMatchObject({
        status: "PROCESSED",
        canonicalVacancyId: canonicalId,
        observationAdded: true
      });
      const rows = () => f.db.prepare("SELECT * FROM observation_cluster_assignments ORDER BY rowid").all();
      const assignments = rows();
      const repeated = await f.runtime.captureAndProcessBrowserVacancy({
        ...payload,
        capturedAt: new Date("2026-10-24T11:00:00Z")
      });
      expect(repeated.capture.observationId).toBe(result.capture.observationId);
      expect(repeated.processing).toMatchObject({
        canonicalVacancyId: canonicalId,
        observationAdded: false
      });
      expect(await f.deps.sourceObservationRepository.countCaptureOccurrences([result.capture.observationId])).toBe(2);
      expect(rows()).toEqual(assignments);
      const changed = await f.runtime.captureAndProcessBrowserVacancy({
        ...payload,
        html: html.replace("Software Developer</h1>", "Software Developer II</h1>")
      });
      expect(changed.capture.observationId).not.toBe(result.capture.observationId);
      expect(changed.processing).toMatchObject({
        canonicalVacancyId: canonicalId,
        observationAdded: true
      });
      const view = await f.workflow.getVacancyReview(canonicalId);
      expect(view.organizationRoleReview![0]).toMatchObject({
        recommendedRole: "EMPLOYER",
        confirmedRole: role
      });
      expect(view.user.currentState).toBe("REVIEWED");
      expect(view.employer.employerClusterId).toBe(confirmed.employer.employerClusterId);
      expect(f.db.prepare("SELECT * FROM vacancy_organization_role_decisions").all()).toEqual(decisions);
      expect(await f.deps.sourceObservationRepository.findById(observation.id)).toEqual(original);
      expect((await f.deps.sourceObservationRepository.findById(observation.id))!.source.externalId).toBeUndefined();
      expect(await f.deps.canonicalVacancyRepository.findAll()).toHaveLength(1);
    } finally {
      f.db.close();
    }
  });
  it.each([html.replace("521407", "999999"), html.replace('class="jobdescription"', 'class="unknown-description"')])("does not merge from URL or title similarity when legacy selected evidence fails validation", async legacyHtml => {
    const f = fixture();
    try {
      const {
        canonicalId
      } = await f.legacy(undefined, undefined, legacyHtml);
      const result = await f.runtime.captureAndProcessBrowserVacancy(payload);
      expect(result.processing.status).toBe("PROCESSED");
      if (result.processing.status !== "PROCESSED") throw Error("failed");
      expect(result.processing.canonicalVacancyId).not.toBe(canonicalId);
    } finally {
      f.db.close();
    }
  });
  it("does not arbitrarily choose between two validated legacy canonical vacancies", async () => {
    const f = fixture();
    try {
      await f.legacy("legacy1", "canonical1");
      await f.legacy("legacy2", "canonical2");
      const result = await f.runtime.captureAndProcessBrowserVacancy(payload);
      expect(result.processing.status).toBe("PROCESSED");
      if (result.processing.status !== "PROCESSED") throw Error("failed");
      expect(["canonical1", "canonical2"]).not.toContain(result.processing.canonicalVacancyId);
    } finally {
      f.db.close();
    }
  });
  it("accepts validated legacy URL variants without relying on a trailing slash", async () => {
    const f = fixture();
    try {
      const {
        canonicalId
      } = await f.legacy(undefined, undefined, html, url.slice(0, -1) + "?tracking=old");
      const result = await f.runtime.captureAndProcessBrowserVacancy(payload);
      expect(result.processing).toMatchObject({
        canonicalVacancyId: canonicalId
      });
    } finally {
      f.db.close();
    }
  });
});
