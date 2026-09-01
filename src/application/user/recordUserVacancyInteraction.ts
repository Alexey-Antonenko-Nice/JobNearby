import { randomUUID } from "node:crypto";

import type { UserVacancyInteractionMetadataByType, UserVacancyInteractionEvent, UserVacancyInteractionType } from "../../domain/user/UserVacancyInteractionEvent.js";
import { createUserVacancyInteractionEvent } from "../../domain/user/UserVacancyInteractionEvent.js";
import type { UserVacancyInteractionRepository } from "../../domain/user/UserVacancyInteractionRepository.js";
import type { CanonicalVacancyId } from "../../domain/vacancies/CanonicalVacancy.js";
import type { CanonicalVacancyRepository } from "../../domain/vacancies/CanonicalVacancyRepository.js";
import { getUserVacancyHistory, type UserVacancyHistory } from "./getUserVacancyHistory.js";

type RecordInputFor<T extends UserVacancyInteractionType> = {
  readonly canonicalVacancyId: CanonicalVacancyId;
  readonly type: T;
  readonly occurredAt?: Date;
} & (UserVacancyInteractionMetadataByType[T] extends never
  ? { readonly metadata?: never }
  : { readonly metadata?: UserVacancyInteractionMetadataByType[T] });

export type RecordUserVacancyInteractionInput = {
  [T in UserVacancyInteractionType]: RecordInputFor<T>
}[UserVacancyInteractionType];

export interface RecordUserVacancyInteractionDependencies {
  readonly canonicalVacancyRepository: Pick<CanonicalVacancyRepository, "findById">;
  readonly interactionRepository: UserVacancyInteractionRepository;
  readonly now?: () => Date;
  readonly generateId?: () => string;
}

export interface RecordUserVacancyInteractionResult {
  readonly event: UserVacancyInteractionEvent;
  readonly history: UserVacancyHistory;
}

export async function recordUserVacancyInteraction(
  input: RecordUserVacancyInteractionInput,
  dependencies: RecordUserVacancyInteractionDependencies,
): Promise<RecordUserVacancyInteractionResult> {
  const vacancy = await dependencies.canonicalVacancyRepository.findById(input.canonicalVacancyId);
  if (vacancy === null) {
    throw new Error(`CanonicalVacancy "${input.canonicalVacancyId}" does not exist.`);
  }
  const recordedAt = new Date((dependencies.now ?? (() => new Date()))());
  const event = createUserVacancyInteractionEvent({
    id: (dependencies.generateId ?? randomUUID)(),
    canonicalVacancyId: input.canonicalVacancyId,
    type: input.type,
    occurredAt: new Date(input.occurredAt ?? recordedAt),
    recordedAt,
    ...(input.metadata === undefined ? {} : { metadata: input.metadata }),
  } as UserVacancyInteractionEvent);
  await dependencies.interactionRepository.append(event);
  return {
    event,
    history: await getUserVacancyHistory(input.canonicalVacancyId, dependencies.interactionRepository),
  };
}
