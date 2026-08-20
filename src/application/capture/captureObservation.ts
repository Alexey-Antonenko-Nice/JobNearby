import { randomUUID } from "node:crypto";

import type {
  SourceObservation,
  SourceObservationId,
} from "../../domain/capture/SourceObservation.js";

import type { SourceObservationRepository } from "../../domain/capture/SourceObservationRepository.js";

import { captureObservationInputSchema } from "./CaptureObservationSchema.js";

import type { SourceReference } from "../../domain/capture/SourceReference.js";

export interface CaptureObservationDependencies {
  repository: SourceObservationRepository;
  now?: () => Date;
  generateId?: () => SourceObservationId;
}

export async function captureObservation(
  input: unknown,
  dependencies: CaptureObservationDependencies,
): Promise<SourceObservation> {
  const validatedInput = captureObservationInputSchema.parse(input);

	const source: SourceReference = {
		sourceType: validatedInput.source.sourceType,
		sourceName: validatedInput.source.sourceName,

		...(validatedInput.source.sourceUrl !== undefined
			? { sourceUrl: validatedInput.source.sourceUrl }
			: {}),

		...(validatedInput.source.externalId !== undefined
			? { externalId: validatedInput.source.externalId }
			: {}),

		...(validatedInput.source.providerMetadata !== undefined
			? { providerMetadata: validatedInput.source.providerMetadata }
			: {}),
	};

  const now = dependencies.now ?? (() => new Date());
  const generateId = dependencies.generateId ?? randomUUID;

  const observation: SourceObservation = {
    id: generateId(),
  	source,
    observedAt: now(),
    metadata: validatedInput.metadata ?? {},

    ...(validatedInput.publishedAt !== undefined
      ? { publishedAt: validatedInput.publishedAt }
      : {}),
    ...(validatedInput.title !== undefined
      ? { title: validatedInput.title }
      : {}),
    ...(validatedInput.displayedCompanyName !== undefined
      ? { displayedCompanyName: validatedInput.displayedCompanyName }
      : {}),
    ...(validatedInput.locationText !== undefined
      ? { locationText: validatedInput.locationText }
      : {}),
    ...(validatedInput.description !== undefined
      ? { description: validatedInput.description }
      : {}),
    ...(validatedInput.salaryText !== undefined
      ? { salaryText: validatedInput.salaryText }
      : {}),
    ...(validatedInput.contractText !== undefined
      ? { contractText: validatedInput.contractText }
      : {}),
    ...(validatedInput.contactText !== undefined
      ? { contactText: validatedInput.contactText }
      : {}),
    ...(validatedInput.rawContent !== undefined
      ? { rawContent: validatedInput.rawContent }
      : {}),
  };

  await dependencies.repository.save(observation);

  return observation;
}
