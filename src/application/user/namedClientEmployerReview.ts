import { createAliasEvidence } from "../recognition/createEmployerAliasEvidence.js";
import { createHash } from "node:crypto";
import { normalizeOrganizationEvidenceName as normalize } from "../../domain/evidence/OrganizationEvidence.js";
import type { CanonicalVacancy } from "../../domain/vacancies/CanonicalVacancy.js";
import type { NamedClientEmployerCandidate } from "../../domain/user/EmployerReviewCandidate.js";
import type { EmployerRecognitionPersistence } from "../../domain/recognition/EmployerRecognitionPersistence.js";
import { isUsableOrganizationName } from "../evidence/ExplicitTextVacancyEvidenceExtractor.js";
import { createEmployerCluster } from "../recognition/createEmployerCluster.js";
import { createObservationClusterAssignment } from "../recognition/createObservationClusterAssignment.js";
import type { MemoryReviewDependencies } from "./employerMemoryReview.js";

const algorithm = "user-named-client-employer-review";
export const EMPLOYER_REVIEW_STALE = "Employer review candidate is no longer eligible.";
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const decisionId = (vacancyId: string, name: string) => `named-client-decision:${hash([vacancyId, normalize(name)])}`;

export async function getNamedClientEmployerCandidate(vacancy: CanonicalVacancy, deps: MemoryReviewDependencies): Promise<NamedClientEmployerCandidate | null> {
  const assignments = deps.assignmentRepository;
  if (!assignments || !deps.employerClusterRepository.findCandidates) return null;
  const observationId = vacancy.sourceObservationIds.at(-1);
  if (!observationId) return null;
  const effective = await Promise.all(vacancy.sourceObservationIds.map((id) => assignments.findEffectiveByObservationId(id)));
  if (effective.some((a) => a?.status === "USER_CONFIRMED")) return null;
  const current = effective.at(-1);
  // A durable unresolved membership is the audit anchor for a rejection. No
  // cluster is manufactured just to display or reject a possible employer.
  if (!current || current.status !== "ACCEPTED") return null;
  const clusterIds = new Set([...effective.flatMap((a) => a ? [a.employerClusterId] : []), ...vacancy.organizationRelationships.flatMap((r) => r.role === "EMPLOYER" && r.employerClusterId ? [r.employerClusterId] : [])]);
  for (const id of clusterIds) {
    const cluster = await deps.employerClusterRepository.findById(id);
    if (!cluster || cluster.status !== "UNRESOLVED" || (cluster.displayLabel?.trim() && !/^unknown(?:\s+employer)?(?:\s|$)/iu.test(cluster.displayLabel))) return null;
  }
  const clients = vacancy.organizationRelationships.filter((r) => r.role === "CLIENT");
  if (clients.length === 0 || clients.some((r) => !usableClientName(r.rawName, vacancy))) return null;
  const names = new Set(clients.map((r) => normalize(r.rawName!)));
  if (names.size !== 1) return null;
  const name = clients.map((r) => r.rawName!.trim()).sort()[0]!;
  const key = normalize(name);
  const intermediaries = vacancy.organizationRelationships.filter((r) => ["RECRUITER", "STAFFING_AGENCY", "CONSULTANCY"].includes(r.role));
  if (intermediaries.some((r) => r.rawName?.trim() && normalize(r.rawName) === key)) return null;
  if (vacancy.organizationRelationships.some((r) => r.role === "EMPLOYER" && r.rawName?.trim() && !/^unknown(?:\s+employer)?(?:\s|$)/iu.test(r.rawName) && normalize(r.rawName) !== key)) return null;
  const displayed = vacancy.organizationRelationships.filter((r) => r.role === "DISPLAYED_COMPANY");
  const recruiter = intermediaries.find((r) => r.rawName?.trim() && displayed.some((d) => d.rawName?.trim() && normalize(d.rawName) === normalize(r.rawName!)));
  if (!recruiter) return null;

  // Use the canonical explicit relationship and its source references. Do not
  // independently extract an employer from raw vacancy text.
  const strong = clients.filter((r) => r.confidence !== undefined && r.confidence >= 0.98 && r.supportingEvidenceIds.some((id) => vacancy.evidenceReferences.some((e) => e.id === id && e.kind === "ORGANIZATION_EVIDENCE" && vacancy.sourceObservationIds.includes(e.sourceObservationId))));
  if (strong.length === 0) return null;
  const evidenceIds = [...new Set(strong.flatMap((r) => r.supportingEvidenceIds).filter((id) => vacancy.evidenceReferences.some((e) => e.id === id && e.kind === "ORGANIZATION_EVIDENCE" && vacancy.sourceObservationIds.includes(e.sourceObservationId))))].sort();
  const sourceIds = [...new Set(vacancy.evidenceReferences.filter((e) => evidenceIds.includes(e.id)).map((e) => e.sourceObservationId))].sort();
  if ((await assignments.findById(decisionId(vacancy.id, name)))?.status === "REJECTED") return null;
  const aliases = deps.aliasRepository ? await deps.aliasRepository.findActiveByNormalizedName(key) : [];
  const sameNameClusters = (await deps.employerClusterRepository.findCandidates({})).filter((c) => c.displayLabel?.trim() && (normalize(c.displayLabel) === key || aliases.some((a) => a.employerClusterId === c.id)));
  if (sameNameClusters.some((c) => c.status === "CONFLICTED")) return null;
  const matches = sameNameClusters.filter((c) => ["PROBABLY_RESOLVED", "RESOLVED"].includes(c.status));
  // Multiple same-name clusters require a separate identity choice, not an
  // arbitrary reuse or a duplicate created through this one-client workflow.
  if (matches.length > 1) return null;
  const cluster = matches[0];
  if (cluster) {
    for (const intermediary of intermediaries) {
      if (!intermediary.rawName?.trim()) continue;
      const intermediaryKey = normalize(intermediary.rawName);
      if (normalize(cluster.displayLabel!) === intermediaryKey) return null;
      if ((await deps.aliasRepository?.findActiveByNormalizedName(intermediaryKey))?.some((e) => e.employerClusterId === cluster.id)) return null;
    }
  }
  const prior = cluster && assignments.findEffectiveByClusterId ? (await assignments.findEffectiveByClusterId(cluster.id)).filter((a) => a.status === "USER_CONFIRMED" && !vacancy.sourceObservationIds.includes(a.sourceObservationId)) : [];
  return {
    ...(aliases.length === 0 ? {} : { aliasEvidence: aliases.filter((a) => a.employerClusterId === cluster?.id) }),
    type: "NAMED_CLIENT", candidateId: hash([vacancy.id, key, observationId, current.id, evidenceIds, cluster?.id ?? null]),
    name, sourceRelationship: "CLIENT", canonicalVacancyId: vacancy.id, sourceObservationIds: sourceIds, supportingEvidenceIds: evidenceIds,
    reasonCode: "NAMED_CLIENT_POSSIBLE_EMPLOYER", explanation: `${recruiter.rawName!.trim()} is recruiting for the named client ${name}. Confirm whether this client is the employer.${cluster && normalize(cluster.displayLabel!) !== key ? ` This name was explicitly confirmed as an alias of "${cluster.displayLabel}".` : ""}`,
    employerClusterId: cluster?.id ?? null, clusterStatus: cluster?.status ?? null,
    priorConfirmationCount: new Set(prior.map((a) => a.sourceObservationId)).size,
  };
}

function usableClientName(name: string | undefined, vacancy: CanonicalVacancy): boolean {
  if (!name?.trim() || !isUsableOrganizationName(name) || !/\p{L}/u.test(name)) return false;
  const key = normalize(name);
  if (/^(?:(?:notre|son|un|une|le|la|nos|ses|our|their|a)\s+|client\b|confidentiel\b|confidential\b|unknown\b|inconnu\b|entreprise\b|soci[eé]t[eé]\b|groupe\b|secteur\b|industrie\b|leader\b|acteur\b|bas[eé]\b|situ[eé]\b)/iu.test(key)) return false;
  if (/\b(?:de|du|des|pour|dans|en|au|[àa]|et)$/iu.test(key)) return false;
  // A lone title-case word may be a place; keep acronym-style single names only.
  if (!/\s/u.test(name.trim()) && !/^[\p{Lu}\d&]+$/u.test(name.trim())) return false;
  const locations = [vacancy.location.value, ...(vacancy.location.alternatives?.map((a) => a.value) ?? [])];
  return !locations.some((l) => [l?.city, l?.region, l?.rawText, l?.countryCode].some((value) => value?.trim() && normalize(value) === key));
}

export async function decideNamedClientEmployer(vacancy: CanonicalVacancy, candidateId: string, decision: "CONFIRM" | "REJECT", deps: MemoryReviewDependencies & { readonly recognitionPersistence?: EmployerRecognitionPersistence }): Promise<void> {
  const repository = deps.assignmentRepository;
  const persistence = deps.recognitionPersistence;
  if (!repository || !persistence?.saveEmployerReviewDecision) throw new Error("Named-client employer review is unavailable.");
  const histories = (await Promise.all(vacancy.sourceObservationIds.map((id) => repository.findByObservationId(id)))).flat();
  const completed = histories.find((a) => a.algorithm === algorithm && decisionMetadata(a.explanation)?.candidateId === candidateId);
  if (completed) {
    if ((decision === "CONFIRM" && completed.status === "USER_CONFIRMED") || (decision === "REJECT" && completed.status === "REJECTED")) return;
    throw new Error(EMPLOYER_REVIEW_STALE);
  }
  const candidate = await getNamedClientEmployerCandidate(vacancy, deps);
  if (!candidate || candidate.candidateId !== candidateId) throw new Error(EMPLOYER_REVIEW_STALE);
  const observationId = vacancy.sourceObservationIds.at(-1)!;
  const current = await repository.findEffectiveByObservationId(observationId);
  if (!current || current.status !== "ACCEPTED" || hash([vacancy.id, normalize(candidate.name), observationId, current.id, candidate.supportingEvidenceIds, candidate.employerClusterId]) !== candidateId) throw new Error(EMPLOYER_REVIEW_STALE);
  const cluster = decision === "CONFIRM" && candidate.employerClusterId === null ? createEmployerCluster({ status: "PROBABLY_RESOLVED", displayLabel: candidate.name }, { generateId: () => `named-client-employer:${hash(normalize(candidate.name))}` }) : undefined;
  const assignment = createObservationClusterAssignment({
    sourceObservationId: observationId,
    // Rejection references the existing unresolved anchor, never an invented
    // HEUFT cluster. The name/token in the audit record identify the suggestion.
    employerClusterId: decision === "REJECT" ? current.employerClusterId : candidate.employerClusterId ?? cluster!.id,
    status: decision === "CONFIRM" ? "USER_CONFIRMED" : "REJECTED", confidence: 1, algorithm, algorithmVersion: "1.0.0",
    explanation: JSON.stringify({ candidateId, name: candidate.name, sourceRelationship: "CLIENT", decision, explanation: candidate.explanation }),
  }, { generateId: () => decisionId(vacancy.id, candidate.name) });
  const target = decision === "CONFIRM" && candidate.employerClusterId ? await deps.employerClusterRepository.findById(candidate.employerClusterId) : null;
  const aliasEvidence = deps.aliasRepository && target?.displayLabel ? createAliasEvidence(candidate.name, target.displayLabel, assignment) : undefined;
  try {
    await persistence.saveEmployerReviewDecision(assignment, current.id, cluster, aliasEvidence);
  } catch (error) {
    const saved = await repository.findById(assignment.id);
    if (saved?.algorithm === algorithm && saved.status === assignment.status && decisionMetadata(saved.explanation)?.candidateId === candidateId) return;
    if (saved || (await repository.findEffectiveByObservationId(observationId))?.id !== current.id) throw new Error(EMPLOYER_REVIEW_STALE);
    throw error;
  }
}

function decisionMetadata(explanation: string | undefined): { candidateId?: string } | null {
  try { return JSON.parse(explanation ?? "null") as { candidateId?: string } | null; } catch { return null; }
}
