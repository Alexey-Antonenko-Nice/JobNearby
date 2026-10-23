import { createHash } from "node:crypto";
import { normalizeOrganizationEvidenceName as normalize } from "../../domain/evidence/OrganizationEvidence.js";
import { EMPLOYER_IDENTITY_ALGORITHM, EMPLOYER_IDENTITY_STALE, type EmployerIdentityReview, type EmployerIdentityDecisionInput, type EmployerIdentityDecisionStore } from "../../domain/user/EmployerIdentityReview.js";
import type { CanonicalVacancyRepository } from "../../domain/vacancies/CanonicalVacancyRepository.js";
import type { SourceObservationRepository } from "../../domain/capture/SourceObservationRepository.js";
import type { EmployerMemoryPublicDataSource } from "./EmployerMemoryPublicDataSource.js";
import { buildOrganizationRoleReview, type OrganizationRoleReviewDependencies } from "./vacancyOrganizationRoles.js";
import { createObservationClusterAssignment } from "../recognition/createObservationClusterAssignment.js";

export interface EmployerIdentityDependencies extends OrganizationRoleReviewDependencies {
  readonly canonicalVacancyRepository: Pick<CanonicalVacancyRepository, "findById">;
  readonly sourceObservationRepository: Pick<SourceObservationRepository, "findById">;
  readonly employerMemoryPublicDataSource: EmployerMemoryPublicDataSource;
}
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const hostname = (url: string | undefined) => { try { return new URL(url ?? "").hostname; } catch { return undefined; } };

type IdentityCandidate = EmployerIdentityReview["candidates"][number];
const GENERIC_REASON = "Previously confirmed employer identity. Confirm that it is the same employer before using it.";

/** Suggested candidates carry explicit evidence (name, known alias or source domain); advisory only. */
export async function getEmployerIdentityReview(id: string, deps: EmployerIdentityDependencies): Promise<EmployerIdentityReview | null> {
  const found = await discoverEmployerIdentityCandidates(id, deps);
  return found && { currentClusterId: found.currentClusterId, employerName: found.employerName, candidates: found.candidates.filter(c => c.suggested).map(({ suggested: _s, ...c }) => c) };
}

/** Explicit user-initiated search over all confirmed identities by name; never selects anything. */
export async function searchEmployerIdentityCandidates(id: string, query: string, deps: EmployerIdentityDependencies): Promise<EmployerIdentityReview | null> {
  const needle = normalize(query);
  if (needle.length < 2) throw Error("Enter at least two characters to search employer identities.");
  const found = await discoverEmployerIdentityCandidates(id, deps);
  return found && { currentClusterId: found.currentClusterId, employerName: found.employerName,
    candidates: found.candidates.filter(c => normalize(c.displayLabel).includes(needle)).map(({ suggested: _s, ...c }) => c) };
}

async function discoverEmployerIdentityCandidates(id: string, deps: EmployerIdentityDependencies): Promise<{ currentClusterId: string; employerName: string; candidates: (IdentityCandidate & { suggested: boolean })[] } | null> {
  const vacancy = await deps.canonicalVacancyRepository.findById(id);
  const repo = deps.assignmentRepository;
  if (!vacancy || !repo?.findConfirmedClusterIds || !repo.findEffectiveByClusterId) return null;
  const observations = await Promise.all(vacancy.sourceObservationIds.map(o => deps.sourceObservationRepository.findById(o)));
  if (observations.some(o => !o)) return null;
  const cards = await buildOrganizationRoleReview(vacancy, observations.filter(o => o !== null), deps);
  const employer = cards.find(c => c.confirmedRole === "EMPLOYER");
  if (!employer) return null;
  const assignments = await Promise.all(vacancy.sourceObservationIds.map(o => repo.findEffectiveByObservationId(o)));
  if (assignments.some(a => !a)) return null;
  const current = assignments.find(a => a?.status === "USER_CONFIRMED") ?? assignments.at(-1);
  if (!current || assignments.some(a => a?.employerClusterId !== current.employerClusterId)) return null;
  const decisions = await deps.organizationRoleDecisionRepository.listForVacancy(id);
  const history = (await Promise.all(vacancy.sourceObservationIds.map(o => repo.findByObservationId(o)))).flat();
  const domains = new Set(observations.map(o => hostname(o?.source.sourceUrl)).filter(Boolean));
  const aliasClusters = new Set((await deps.aliasRepository?.findActiveByNormalizedName(normalize(employer.name)) ?? []).map(a => a.employerClusterId));
  const candidates: (IdentityCandidate & { suggested: boolean })[] = [];
  for (const clusterId of await repo.findConfirmedClusterIds()) {
    if (clusterId === current.employerClusterId) continue;
    const cluster = await deps.employerClusterRepository.findById(clusterId);
    if (!cluster?.displayLabel || !["PROBABLY_RESOLVED", "RESOLVED"].includes(cluster.status)) continue;
    const prior = (await deps.employerMemoryPublicDataSource.findByEmployerClusterId(clusterId)).filter(v => v.canonicalVacancyId !== id);
    if (!prior.length) continue;
    const targetAssignments = await repo.findEffectiveByClusterId(clusterId);
    const related = history.filter(a => a.algorithm === EMPLOYER_IDENTITY_ALGORITHM && a.employerClusterId === clusterId);
    const advisoryReasons = [GENERIC_REASON];
    if (normalize(cluster.displayLabel) === normalize(employer.name)) advisoryReasons.push("Matching organization name (advisory only).");
    if (aliasClusters.has(clusterId)) advisoryReasons.push("Known alias of this identity (advisory only).");
    let sharedDomain = false;
    for (const v of prior) {
      const stored = await deps.canonicalVacancyRepository.findById(v.canonicalVacancyId);
      for (const oid of stored?.sourceObservationIds ?? []) {
        const o = await deps.sourceObservationRepository.findById(oid);
        const domain = hostname(o?.source.sourceUrl);
        if (domain && domains.has(domain)) sharedDomain = true;
      }
    }
    if (sharedDomain) advisoryReasons.push("Shared source domain (advisory only; a careers site can serve several employers).");
    candidates.push({ suggested: advisoryReasons.length > 1, employerClusterId: clusterId, displayLabel: cluster.displayLabel,
      candidateToken: hash([id, vacancy.sourceObservationIds, assignments.map(a => a!.id), decisions.at(-1)?.id ?? null, cluster, targetAssignments.map(a => a.id).sort(), related.map(a => a.id).sort()]),
      keptSeparate: related.some(a => a.status === "REJECTED"), advisoryReasons,
      priorVacancies: prior.map(v => ({ canonicalVacancyId: v.canonicalVacancyId, title: v.title,
        location: v.location?.rawText ?? ([v.location?.city, v.location?.region, v.location?.countryCode].filter(Boolean).join(", ") || null) })) });
  }
  candidates.sort((a,b) => b.advisoryReasons.length - a.advisoryReasons.length || a.displayLabel.localeCompare(b.displayLabel) || a.employerClusterId.localeCompare(b.employerClusterId));
  return {currentClusterId: current.employerClusterId, employerName: employer.name, candidates};
}

export async function decideEmployerIdentity(input: EmployerIdentityDecisionInput, deps: EmployerIdentityDependencies & { readonly employerIdentityDecisionStore: EmployerIdentityDecisionStore; readonly now?: (() => Date) | undefined }) {
  if (!input.requestId.trim() || input.requestId.length > 200 || !["USE_EXISTING", "KEEP_SEPARATE"].includes(input.decision)) throw Error("Invalid employer identity decision.");
  const repo = deps.assignmentRepository;
  if (!repo?.findEffectiveByClusterId) throw Error("Employer identity review is unavailable.");
  const requestAssignmentId = `employer-identity:${input.requestId}`;
  const previous = await repo.findById(requestAssignmentId);
  if (previous) {
    const recorded = JSON.parse(previous.explanation ?? "null") as EmployerIdentityDecisionInput | null;
    if (previous.algorithm === EMPLOYER_IDENTITY_ALGORITHM && recorded && ["canonicalVacancyId", "requestId", "employerClusterId", "decision", "candidateToken"].every(k => recorded[k as keyof EmployerIdentityDecisionInput] === input[k as keyof EmployerIdentityDecisionInput])) return;
    throw Error(EMPLOYER_IDENTITY_STALE);
  }
  try {
  const review = await discoverEmployerIdentityCandidates(input.canonicalVacancyId, deps);
  const candidate = review?.candidates.find(c => c.employerClusterId === input.employerClusterId);
  if (!candidate || candidate.candidateToken !== input.candidateToken) throw Error(EMPLOYER_IDENTITY_STALE);
  const vacancy = (await deps.canonicalVacancyRepository.findById(input.canonicalVacancyId))!;
  const assignments = await Promise.all(vacancy.sourceObservationIds.map(o => repo.findEffectiveByObservationId(o)));
  const targetAssignments = await repo.findEffectiveByClusterId(input.employerClusterId);
  const decisions = await deps.organizationRoleDecisionRepository.listForVacancy(vacancy.id);
  const identityHistory = (await Promise.all(vacancy.sourceObservationIds.map(o => repo.findByObservationId(o)))).flat().filter(a => a.algorithm === EMPLOYER_IDENTITY_ALGORITHM);
  // Rebuild after loading the comparison basis so concurrent changes cannot be incorporated silently.
  const fresh = await discoverEmployerIdentityCandidates(input.canonicalVacancyId, deps);
  if (fresh?.candidates.find(c => c.employerClusterId === input.employerClusterId)?.candidateToken !== input.candidateToken || assignments.some(a => !a)) throw Error(EMPLOYER_IDENTITY_STALE);
  const now = deps.now?.() ?? new Date();
  await deps.employerIdentityDecisionStore.commit({ canonicalVacancyId: vacancy.id,
    expectedRoleDecisionId: decisions.at(-1)?.id ?? null,
    expectedIdentityHistoryIds:identityHistory.map(a=>a.id),
    expectedAssignments: vacancy.sourceObservationIds.map((o,i) => ({observationId:o, assignmentId:assignments[i]!.id})),
    expectedTargetAssignmentIds: targetAssignments.map(a => a.id), targetClusterId: input.employerClusterId, decision:input.decision,
    assignments: vacancy.sourceObservationIds.map((o,i) => createObservationClusterAssignment({ sourceObservationId:o, employerClusterId:input.employerClusterId,
      status:input.decision === "USE_EXISTING" ? "USER_CONFIRMED" : "REJECTED", confidence:1, algorithm:EMPLOYER_IDENTITY_ALGORITHM, algorithmVersion:"1",
      explanation:JSON.stringify({...input, previousClusterId:review!.currentClusterId, explanation:input.decision === "USE_EXISTING" ? "User selected this existing employer identity for this vacancy only." : "User kept this vacancy separate from this employer identity."})
    }, {now:()=>now, generateId:()=>i===0?requestAssignmentId:`${requestAssignmentId}:${o}`})) });
  } catch (error) {
    const saved = await repo.findById(requestAssignmentId);
    const recorded = saved?.algorithm === EMPLOYER_IDENTITY_ALGORITHM ? JSON.parse(saved.explanation ?? "null") as EmployerIdentityDecisionInput | null : null;
    if (recorded && ["canonicalVacancyId","requestId","employerClusterId","candidateToken","decision"].every(k => recorded[k as keyof EmployerIdentityDecisionInput] === input[k as keyof EmployerIdentityDecisionInput])) return;
    throw error;
  }
}
