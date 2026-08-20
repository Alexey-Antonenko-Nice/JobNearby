import { randomUUID } from "node:crypto";

import type {
  SourceObservation,
  SourceObservationId,
} from "../../domain/capture/SourceObservation.js";

import type { SourceObservationRepository } from "../../domain/capture/SourceObservationRepository.js";

import type { SourceReference } from "../../domain/capture/SourceReference.js";

export interface CaptureObservationInput {
  source: SourceReference;

  publishedAt?: Date;

  title?: string;
  displayedCompanyName?: string;
  locationText?: string;
  description?: string;
  salaryText?: string;
  contractText?: string;
  contactText?: string;

  rawContent?: string;

  metadata?: Readonly<Record<string, unknown>>;
}

export interface CaptureObservationDependencies {
  repository: SourceObservationRepository;
  now?: () => Date;
  generateId?: () => SourceObservationId;
}

export async function captureObservation(
  input: CaptureObservationInput,
  dependencies: CaptureObservationDependencies,
): Promise<SourceObservation> {
  const now = dependencies.now ?? (() => new Date());
  const generateId = dependencies.generateId ?? randomUUID;

  const observation: SourceObservation = {
    id: generateId(),
    source: input.source,
    observedAt: now(),
    metadata: input.metadata ?? {},

    ...(input.publishedAt !== undefined
      ? { publishedAt: input.publishedAt }
      : {}),
    ...(input.title !== undefined ? { title: input.title } : {}),
    ...(input.displayedCompanyName !== undefined
      ? { displayedCompanyName: input.displayedCompanyName }
      : {}),
    ...(input.locationText !== undefined
      ? { locationText: input.locationText }
      : {}),
    ...(input.description !== undefined
      ? { description: input.description }
      : {}),
    ...(input.salaryText !== undefined
      ? { salaryText: input.salaryText }
      : {}),
    ...(input.contractText !== undefined
      ? { contractText: input.contractText }
      : {}),
    ...(input.contactText !== undefined
      ? { contactText: input.contactText }
      : {}),
    ...(input.rawContent !== undefined
      ? { rawContent: input.rawContent }
      : {}),
  };

  await dependencies.repository.save(observation);

  return observation;
}
