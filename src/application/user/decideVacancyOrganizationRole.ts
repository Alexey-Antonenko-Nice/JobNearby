import { randomUUID } from "node:crypto";
import type { CanonicalVacancyRepository } from "../../domain/vacancies/CanonicalVacancyRepository.js";
import type { SourceObservationRepository } from "../../domain/capture/SourceObservationRepository.js";
import type { HumanOrganizationRole } from "../../domain/organizations/VacancyOrganizationRoleDecision.js";
import { humanOrganizationRoles } from "../../domain/organizations/VacancyOrganizationRoleDecision.js";
import { normalizeOrganizationEvidenceName as normalize } from "../../domain/evidence/OrganizationEvidence.js";
import { createEmployerCluster } from "../recognition/createEmployerCluster.js";
import { createObservationClusterAssignment } from "../recognition/createObservationClusterAssignment.js";
import { buildOrganizationRoleReview, type OrganizationRoleReviewDependencies } from "./vacancyOrganizationRoles.js";
export interface OrganizationRoleDecisionInput {
  readonly canonicalVacancyId: string;
  readonly requestId: string;
  readonly identityKey: string;
  readonly role: HumanOrganizationRole;
  readonly candidateToken: string;
  readonly acknowledgeContradiction: boolean;
}
export async function decideVacancyOrganizationRole(input: OrganizationRoleDecisionInput, deps: OrganizationRoleReviewDependencies & {
  readonly canonicalVacancyRepository: Pick<CanonicalVacancyRepository, "findById">;
  readonly sourceObservationRepository: Pick<SourceObservationRepository, "findById">;
  readonly now?: (() => Date) | undefined;
  readonly generateId?: (() => string) | undefined;
}) {
  if (!humanOrganizationRoles.includes(input.role) || !input.requestId.trim() || !input.identityKey.trim()) throw Error("Invalid organization role decision.");
  const prior = await deps.organizationRoleDecisionRepository.findById(input.requestId);
  if (prior) {
    if (prior.canonicalVacancyId !== input.canonicalVacancyId || prior.identityKey !== input.identityKey || prior.role !== input.role) throw Error("Organization role request ID was already used.");
    return;
  }
  const vacancy = await deps.canonicalVacancyRepository.findById(input.canonicalVacancyId);
  if (!vacancy) throw Error(`CanonicalVacancy "${input.canonicalVacancyId}" does not exist.`);
  const observations = await Promise.all(vacancy.sourceObservationIds.map(async id => {
    const o = await deps.sourceObservationRepository.findById(id);
    if (!o) throw Error("Organization role source observation is missing.");
    return o;
  }));
  if (!deps.assignmentRepository) throw Error("Organization role assignment service is unavailable.");
  // Capture the transaction's comparison basis before building the review token.
  // A concurrent decision must not be silently incorporated after token validation.
  const decisions = await deps.organizationRoleDecisionRepository.listForVacancy(vacancy.id);
  const assignments = await Promise.all(observations.map(o => deps.assignmentRepository!.findEffectiveByObservationId(o.id)));
  const cards = await buildOrganizationRoleReview(vacancy, observations, deps);
  const card = cards.find(c => c.identityKey === input.identityKey);
  if (!card || card.candidateToken !== input.candidateToken) throw Error("Organization role review is stale. Refresh the vacancy.");
  const warning = card.actions.find(a => a.role === input.role)?.warning;
  if (warning && !input.acknowledgeContradiction) throw Error("Organization role override requires confirmation.");
  const effective = assignments.filter(a => a !== null);
  const current = effective.find(a => a.status === "USER_CONFIRMED") ?? effective.at(-1) ?? null;
  const currentCluster = current ? await deps.employerClusterRepository.findById(current.employerClusterId) : null;
  const now = deps.now?.() ?? new Date(),
    generateId = deps.generateId ?? randomUUID;
  const aliases = await deps.aliasRepository?.findActiveByNormalizedName(normalize(card.name)) ?? [];
  const matchesIdentity = currentCluster?.displayLabel && (normalize(currentCluster.displayLabel) === normalize(card.name) || aliases.some(alias => alias.employerClusterId === currentCluster.id));
  const alreadyEmployer = matchesIdentity && currentCluster && (currentCluster.status === "PROBABLY_RESOLVED" || currentCluster.status === "RESOLVED");
  const detach = input.role !== "EMPLOYER" && alreadyEmployer;
  if (card.confirmedRole === input.role && !detach && (input.role !== "EMPLOYER" || alreadyEmployer)) return;
  const newCluster = input.role === "EMPLOYER" && !alreadyEmployer ? createEmployerCluster({
    status: "PROBABLY_RESOLVED",
    displayLabel: card.name
  }, {
    now: () => now,
    generateId
  }) : detach ? createEmployerCluster({
    status: "UNRESOLVED"
  }, {
    now: () => now,
    generateId
  }) : undefined;
  const target = newCluster ?? (input.role === "EMPLOYER" ? currentCluster : null);
  const assignmentChanges = target ? observations.flatMap((o, index) => {
    const existing = assignments[index];
    if (existing?.employerClusterId === target.id && existing.status === "USER_CONFIRMED") return [];
    return [{
      expectedId: existing?.id ?? null,
      replacement: createObservationClusterAssignment({
        sourceObservationId: o.id,
        employerClusterId: target.id,
        status: "USER_CONFIRMED",
        confidence: 1,
        algorithm: "user-vacancy-organization-role",
        algorithmVersion: "1",
        explanation: `User selected ${input.role} for ${card.name} on this vacancy.`
      }, {
        now: () => now,
        generateId
      })
    }];
  }) : [];
  const agencyEvidenceIds = [...new Set(vacancy.organizationRelationships.filter(r => r.rawName && normalize(r.rawName) === normalize(card.name)).flatMap(r => r.supportingEvidenceIds))];
  await deps.organizationRoleDecisionRepository.commit({
    decision: {
      id: input.requestId,
      canonicalVacancyId: vacancy.id,
      identityKey: card.identityKey,
      organizationName: card.name,
      normalizedName: normalize(card.name),
      role: input.role,
      previousDecisionId: decisions.at(-1)?.id ?? null,
      basis: {
        recommendedRole: card.recommendedRole,
        confidence: card.confidence,
        reasons: card.reasons,
        observationIds: vacancy.sourceObservationIds,
        candidateToken: card.candidateToken
      },
      overrideAcknowledged: input.acknowledgeContradiction,
      createdAt: now
    },
    expectedObservationIds: vacancy.sourceObservationIds,
    expectedAssignments: observations.map((o, index) => ({
      observationId: o.id,
      assignmentId: assignments[index]?.id ?? null
    })),
    assignmentChanges,
    ...(newCluster ? {
      newCluster
    } : {}),
    agencyEvidenceIds
  });
}
