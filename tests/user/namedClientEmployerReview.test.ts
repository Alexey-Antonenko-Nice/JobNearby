import { describe, expect, it } from "vitest";
import { namedClientFixture, namedClientVacancy } from "./namedClientReviewFixture.js";
import { createObservationClusterAssignment } from "../../src/application/recognition/createObservationClusterAssignment.js";

describe("named-client employer review", () => {
  it("offers HEUFT from explicit CLIENT evidence without changing assignments, clusters or ACTUA roles", async () => {
    const f = await namedClientFixture();
    const original = structuredClone(f.vacancy);
    expect(await f.candidate()).toMatchObject({ type: "NAMED_CLIENT", name: "HEUFT France", sourceRelationship: "CLIENT", reasonCode: "NAMED_CLIENT_POSSIBLE_EMPLOYER", sourceObservationIds: ["current"], employerClusterId: null });
    expect((await f.workflow.getVacancyReview(f.vacancy.id)).employer.confirmationCandidate).toBeNull();
    expect(await f.candidate()).toEqual(await f.candidate());
    expect(await f.clusters.findCandidates({})).toHaveLength(1);
    expect(await f.assignments.findByObservationId("current")).toEqual([f.accepted]);
    expect(f.vacancy).toEqual(original);
  });

  it.each([false, true])("confirms with existing cluster = %s, with concurrent and sequential retries", async (existing) => {
    const f = await namedClientFixture(); if (existing) await f.addHistory();
    const original = structuredClone(f.vacancy);
    const c = (await f.candidate())!;
    const input = { canonicalVacancyId: f.vacancy.id, type: "NAMED_CLIENT" as const, candidateId: c.candidateId, decision: "CONFIRM" as const };
    await Promise.all([f.workflow.decideEmployerReview(input), f.workflow.decideEmployerReview(input)]);
    await f.workflow.decideEmployerReview(input);
    const effective = await f.assignments.findEffectiveByObservationId("current");
    expect(effective).toMatchObject({ status: "USER_CONFIRMED", algorithm: "user-named-client-employer-review" });
    if (existing) expect(effective?.employerClusterId).toBe("heuft");
    expect(await f.clusters.findById(effective!.employerClusterId)).toMatchObject({ status: "PROBABLY_RESOLVED", displayLabel: "HEUFT France" });
    expect((await f.clusters.findById(effective!.employerClusterId))?.resolvedEmployerId).toBeUndefined();
    expect(await f.clusters.findCandidates({})).toHaveLength(2);
    expect(await f.assignments.findByObservationId("current")).toHaveLength(2);
    expect((await f.workflow.getVacancyReview(f.vacancy.id)).employer.employerClusterId).toBe(effective!.employerClusterId);
    expect(await f.candidate()).toBeUndefined();
    expect(f.vacancy).toEqual(original);
  });

  it("rejects against the unresolved anchor without creating a client cluster, and preserves history", async () => {
    const f = await namedClientFixture(); const original = structuredClone(f.vacancy); const c = (await f.candidate())!;
    const input = { canonicalVacancyId: f.vacancy.id, type: "NAMED_CLIENT" as const, candidateId: c.candidateId, decision: "REJECT" as const };
    await Promise.all([f.workflow.decideEmployerReview(input), f.workflow.decideEmployerReview(input)]);
    await f.workflow.decideEmployerReview(input);
    expect(await f.candidate()).toBeUndefined();
    expect(await f.assignments.findEffectiveByObservationId("current")).toEqual(f.accepted);
    expect(await f.assignments.findByObservationId("current")).toEqual(expect.arrayContaining([f.accepted, expect.objectContaining({ status: "REJECTED", employerClusterId: "anonymous", algorithm: "user-named-client-employer-review" })]));
    expect(await f.assignments.findByObservationId("current")).toHaveLength(2);
    expect(await f.clusters.findCandidates({})).toHaveLength(1);
    expect(f.vacancy).toEqual(original);
    await expect(f.workflow.decideEmployerReview({ ...input, decision: "CONFIRM" })).rejects.toThrow("no longer eligible");
  });

  it("converges competing confirm/reject decisions without orphan clusters", async () => {
    const f = await namedClientFixture(); const c = (await f.candidate())!;
    const base = { canonicalVacancyId: f.vacancy.id, type: "NAMED_CLIENT" as const, candidateId: c.candidateId };
    const results = await Promise.allSettled([f.workflow.decideEmployerReview({ ...base, decision: "REJECT" }), f.workflow.decideEmployerReview({ ...base, decision: "CONFIRM" })]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const effective = await f.assignments.findEffectiveByObservationId("current");
    expect(await f.clusters.findCandidates({})).toHaveLength(effective?.status === "USER_CONFIRMED" ? 2 : 1);
    expect(await f.assignments.findByObservationId("current")).toHaveLength(2);
  });

  it.each(["notre client", "son client", "un client", "Client Confidentiel", "Entreprise Industrielle", "Industrie Automobile", "HEUFT de", "Saverne", "Paris", "67300", ""])("suppresses unusable client %s", async (name) => {
    const base = namedClientVacancy();
    const f = await namedClientFixture({ ...base, location: { ...base.location, status: "RESOLVED", value: { city: "Saverne" } }, organizationRelationships: base.organizationRelationships.map((r) => r.role === "CLIENT" ? (name ? { ...r, rawName: name } : (({ rawName: unused, ...rest }) => rest)(r)) : r) });
    expect(await f.candidate()).toBeUndefined();
  });
  it.each(["RECRUITER", "STAFFING_AGENCY", "CONSULTANCY", "EMPLOYER", "CLIENT"] as const)("suppresses contradictory %s", async (role) => {
    const base = namedClientVacancy();
    const added = { ...base.organizationRelationships[2]!, role, rawName: role === "EMPLOYER" || role === "CLIENT" ? "Other Company" : "HEUFT France" };
    const f = await namedClientFixture({ ...base, organizationRelationships: [...base.organizationRelationships, added] });
    expect(await f.candidate()).toBeUndefined();
  });
  it.each([0.6, undefined])("requires strong explicit source confidence (%s)", async (confidence) => {
    const base = namedClientVacancy();
    const f = await namedClientFixture({ ...base, organizationRelationships: base.organizationRelationships.map((r) => { if (r.role !== "CLIENT") return r; const { confidence: unused, ...rest } = r; return confidence === undefined ? rest : { ...rest, confidence }; }) });
    expect(await f.candidate()).toBeUndefined();
  });
  it("requires current organization evidence references and an identified displayed intermediary", async () => {
    const base = namedClientVacancy();
    for (const vacancy of [{ ...base, evidenceReferences: [] }, { ...base, organizationRelationships: base.organizationRelationships.filter((r) => r.role !== "RECRUITER") }]) {
      expect(await (await namedClientFixture(vacancy)).candidate()).toBeUndefined();
    }
  });
  it("suppresses candidates after an existing human employer decision", async () => {
    const f = await namedClientFixture(); await f.addHistory("other", "PROBABLY_RESOLVED", "Company B");
    await f.assignments.supersedeEffectiveAssignment(f.accepted.id, createObservationClusterAssignment({ sourceObservationId: "current", employerClusterId: "other", status: "USER_CONFIRMED", confidence: 1, algorithm: "user", algorithmVersion: "1" }), new Date());
    expect(await f.candidate()).toBeUndefined();
  });
  it("shows confirmed memory but still requires human client review", async () => {
    const f = await namedClientFixture(); await f.addHistory();
    expect(await f.candidate()).toMatchObject({ employerClusterId: "heuft", priorConfirmationCount: 1 });
    expect(await f.assignments.findEffectiveByObservationId("current")).toEqual(f.accepted);
  });
  it("does not work around an existing conflicted same-name cluster", async () => {
    const f = await namedClientFixture(); await f.addHistory("conflicted", "CONFLICTED");
    expect(await f.candidate()).toBeUndefined();
  });
  it("reuses a stronger existing cluster without changing its legal identity", async () => {
    const f = await namedClientFixture(); await f.addHistory("heuft", "RESOLVED");
    const candidate = (await f.candidate())!;
    await f.workflow.decideEmployerReview({ canonicalVacancyId: f.vacancy.id, type: "NAMED_CLIENT", candidateId: candidate.candidateId, decision: "CONFIRM" });
    expect(await f.clusters.findById("heuft")).toMatchObject({ status: "RESOLVED", resolvedEmployerId: "existing-legal-id" });
  });
  it("fails closed for multiple suitable same-name clusters", async () => {
    const f = await namedClientFixture(); await f.addHistory("one"); await f.addHistory("two");
    expect(await f.candidate()).toBeUndefined();
  });
  it("rejects stale candidate tokens after source evidence changes", async () => {
    const f = await namedClientFixture(); const candidate = (await f.candidate())!;
    const changed = { ...f.vacancy, organizationRelationships: f.vacancy.organizationRelationships.filter((r) => r.role !== "CLIENT") };
    const { decideNamedClientEmployer } = await import("../../src/application/user/namedClientEmployerReview.js");
    await expect(decideNamedClientEmployer(changed, candidate.candidateId, "CONFIRM", f.deps)).rejects.toThrow("no longer eligible");
    expect(await f.assignments.findEffectiveByObservationId("current")).toEqual(f.accepted);
    expect(await f.clusters.findCandidates({})).toHaveLength(1);
  });
});
