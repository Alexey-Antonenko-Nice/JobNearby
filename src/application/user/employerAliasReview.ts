import { createAliasEvidence } from "../recognition/createEmployerAliasEvidence.js";
import type { EmployerCluster } from "../../domain/recognition/EmployerCluster.js";
import { createHash } from "node:crypto";
import { normalizeOrganizationEvidenceName as normalize } from "../../domain/evidence/OrganizationEvidence.js";
import type { CanonicalVacancy } from "../../domain/vacancies/CanonicalVacancy.js";
import type { EmployerAliasSelection } from "../../domain/user/EmployerReviewCandidate.js";
import type { EmployerRecognitionPersistence } from "../../domain/recognition/EmployerRecognitionPersistence.js";
import { createObservationClusterAssignment } from "../recognition/createObservationClusterAssignment.js";
import { employerConfirmationCandidate } from "./employerConfirmation.js";
import { EMPLOYER_REVIEW_STALE, getNamedClientEmployerCandidate } from "./namedClientEmployerReview.js";
import type { MemoryReviewDependencies } from "./employerMemoryReview.js";

const algorithm = "user-employer-alias-review";
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const decisionId = (vacancyId: string, name: string, clusterId: string) => `alias-decision:${hash([vacancyId, normalize(name), clusterId])}`;

export async function getEmployerAliasSelection(vacancy: CanonicalVacancy, deps: MemoryReviewDependencies): Promise<EmployerAliasSelection | null> {
  const repository = deps.assignmentRepository;
  if (!deps.aliasRepository || !repository?.findConfirmedClusterIds) return null;
  const current = await repository.findEffectiveByObservationId(vacancy.sourceObservationIds.at(-1) ?? "");
  if (!current || current.status !== "ACCEPTED") return null;
  for (const id of vacancy.sourceObservationIds) {
    const effective = await repository.findEffectiveByObservationId(id);
    if (effective?.status === "USER_CONFIRMED") return null;
    if (effective) {
      const cluster = await deps.employerClusterRepository.findById(effective.employerClusterId);
      if (cluster?.status !== "UNRESOLVED" || (cluster.displayLabel?.trim() && !/^unknown(?:\s+employer)?(?:\s|$)/iu.test(cluster.displayLabel))) return null;
    }
  }
  for (const r of vacancy.organizationRelationships.filter((r) => r.role === "EMPLOYER" && r.employerClusterId)) {
    const cluster = await deps.employerClusterRepository.findById(r.employerClusterId!);
    if (cluster?.status !== "UNRESOLVED" || (cluster.displayLabel?.trim() && !/^unknown(?:\s+employer)?(?:\s|$)/iu.test(cluster.displayLabel))) return null;
  }
  const client = vacancy.organizationRelationships.some((r) => r.role === "CLIENT") ? await getNamedClientEmployerCandidate(vacancy, deps) : null;
  let name: string | null;
  if (vacancy.organizationRelationships.some((r) => r.role === "CLIENT")) {
    if (!client || client.employerClusterId !== null) return null;
    name = client.name;
  } else {
    if (vacancy.organizationRelationships.some((r) => ["RECRUITER", "STAFFING_AGENCY", "CONSULTANCY"].includes(r.role))) return null;
    name = employerConfirmationCandidate(vacancy.organizationRelationships);
  }
  if (!name) return null;
  const sourceRelationship = client ? "CLIENT" as const : "DISPLAYED_COMPANY" as const;
  const ids = await repository.findConfirmedClusterIds();
  const known = (await Promise.all(ids.map((id) => deps.employerClusterRepository.findById(id)))).filter((c): c is EmployerCluster => c !== null && ["PROBABLY_RESOLVED", "RESOLVED"].includes(c.status) && Boolean(c.displayLabel?.trim()));
  // An already proven match belongs to M12.1/M12.2/M12.3, not new alias creation.
  if (known.some((c) => normalize(c.displayLabel!) === normalize(name!)) || (await deps.aliasRepository.findActiveByNormalizedName(normalize(name))).length > 0) return null;
  const options: { employerClusterId: string; displayLabel: string }[] = [];
  const intermediaryIds = new Set<string>();
  const intermediaries = vacancy.organizationRelationships.filter((r) => ["RECRUITER", "STAFFING_AGENCY", "CONSULTANCY"].includes(r.role));
  for (const r of intermediaries) {
    if (r.rawName?.trim()) for (const alias of await deps.aliasRepository.findActiveByNormalizedName(normalize(r.rawName))) intermediaryIds.add(alias.employerClusterId);
  }
  const history = (await Promise.all(vacancy.sourceObservationIds.map((id) => repository.findByObservationId(id)))).flat();
  for (const cluster of known) {
    if (intermediaryIds.has(cluster.id) || intermediaries.some((r) => r.rawName?.trim() && normalize(r.rawName) === normalize(cluster.displayLabel!))) continue;
    if (history.some((a) => a.status === "REJECTED" && a.employerClusterId === cluster.id && [algorithm, "user-employer-memory-review"].includes(a.algorithm))) continue;
    options.push({ employerClusterId: cluster.id, displayLabel: cluster.displayLabel! });
  }
  if (options.length === 0) return null;
  options.sort((a, b) => a.displayLabel.localeCompare(b.displayLabel) || a.employerClusterId.localeCompare(b.employerClusterId));
  return { type: "ALIAS_SELECTION", candidateId: hash([vacancy.id, normalize(name), sourceRelationship, current.id]), name, sourceRelationship, options,
    explanation: "Only select an employer if you know these names refer to the same employer. No name similarity has been inferred." };
}

export async function decideEmployerAlias(vacancy: CanonicalVacancy, candidateId: string, employerClusterId: string, decision: "CONFIRM" | "REJECT", deps: MemoryReviewDependencies & { readonly recognitionPersistence?: EmployerRecognitionPersistence }): Promise<void> {
  const repository = deps.assignmentRepository;
  if (!repository || !deps.aliasRepository || !deps.recognitionPersistence?.saveEmployerReviewDecision) throw new Error("Employer alias review is unavailable.");
  const history = (await Promise.all(vacancy.sourceObservationIds.map((id) => repository.findByObservationId(id)))).flat();
  const previous = history.find((a) => a.algorithm === algorithm && a.employerClusterId === employerClusterId && metadata(a.explanation)?.candidateId === candidateId);
  if (previous) {
    if ((decision === "CONFIRM" && previous.status === "USER_CONFIRMED") || (decision === "REJECT" && previous.status === "REJECTED")) return;
    throw new Error(EMPLOYER_REVIEW_STALE);
  }
  const selection = await getEmployerAliasSelection(vacancy, deps);
  const option = selection?.options.find((o) => o.employerClusterId === employerClusterId);
  if (!selection || selection.candidateId !== candidateId || !option) throw new Error(EMPLOYER_REVIEW_STALE);
  const observationId = vacancy.sourceObservationIds.at(-1)!;
  const current = await repository.findEffectiveByObservationId(observationId);
  if (!current || hash([vacancy.id, normalize(selection.name), selection.sourceRelationship, current.id]) !== candidateId) throw new Error(EMPLOYER_REVIEW_STALE);
  const assignment = createObservationClusterAssignment({ sourceObservationId: observationId, employerClusterId, status: decision === "CONFIRM" ? "USER_CONFIRMED" : "REJECTED", confidence: 1, algorithm, algorithmVersion: "1.0.0", explanation: JSON.stringify({ candidateId, name: selection.name, sourceRelationship: selection.sourceRelationship, decision, explanation: `User chose to ${decision === "CONFIRM" ? "treat as the same employer" : "keep separate"}: "${selection.name}" and "${option.displayLabel}".` }) }, { generateId: () => decisionId(vacancy.id, selection.name, employerClusterId) });
  const evidence = decision === "CONFIRM" ? createAliasEvidence(selection.name, option.displayLabel, assignment) : undefined;
  try {
    await deps.recognitionPersistence.saveEmployerReviewDecision(assignment, current.id, undefined, evidence);
  } catch (error) {
    const saved = await repository.findById(assignment.id);
    if (saved?.status === assignment.status && saved.algorithm === algorithm && metadata(saved.explanation)?.candidateId === candidateId) return;
    if (saved || (await repository.findEffectiveByObservationId(observationId))?.id !== current.id) throw new Error(EMPLOYER_REVIEW_STALE);
    throw error;
  }
}
function metadata(value: string | undefined): { candidateId?: string } | null {
  try { return JSON.parse(value ?? "null") as { candidateId?: string } | null; } catch { return null; }
}
