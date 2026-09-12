import { validateEmployerAliasEvidence, type EmployerAliasEvidence, type EmployerAliasEvidenceRepository } from "../../domain/recognition/EmployerAliasEvidence.js";
import type { ObservationClusterAssignmentRepository } from "../../domain/recognition/ObservationClusterAssignmentRepository.js";

export class InMemoryEmployerAliasEvidenceRepository implements EmployerAliasEvidenceRepository {
  private readonly evidence = new Map<string, EmployerAliasEvidence>();
  constructor(private readonly assignments: ObservationClusterAssignmentRepository) {}
  async save(value: EmployerAliasEvidence): Promise<void> {
    validateEmployerAliasEvidence(value);
    const proof = await this.assignments.findById(value.sourceAssignmentId);
    if (proof?.status !== "USER_CONFIRMED" || proof.employerClusterId !== value.employerClusterId) throw new Error("Alias evidence requires a matching human-confirmed assignment.");
    if ([...this.evidence.values()].some((e) => e.employerClusterId === value.employerClusterId && e.normalizedAliasName === value.normalizedAliasName && e.sourceAssignmentId === value.sourceAssignmentId)) return;
    if (this.evidence.has(value.id)) throw new Error("Alias evidence ID already exists.");
    this.evidence.set(value.id, structuredClone(value));
  }
  async findActiveByNormalizedName(name: string): Promise<readonly EmployerAliasEvidence[]> {
    const result: EmployerAliasEvidence[] = [];
    for (const evidence of this.evidence.values()) {
      if (evidence.normalizedAliasName !== name) continue;
      const proof = await this.assignments.findById(evidence.sourceAssignmentId);
      if (proof?.status !== "USER_CONFIRMED" || proof.employerClusterId !== evidence.employerClusterId) continue;
      if ((await this.assignments.findEffectiveByObservationId(proof.sourceObservationId))?.id === proof.id) result.push(evidence);
    }
    return structuredClone(result.sort(compare));
  }
  async findByClusterId(id: string): Promise<readonly EmployerAliasEvidence[]> {
    return structuredClone([...this.evidence.values()].filter((e) => e.employerClusterId === id).sort(compare));
  }
}
function compare(a: EmployerAliasEvidence, b: EmployerAliasEvidence): number {
  return a.employerClusterId.localeCompare(b.employerClusterId) || a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id);
}
