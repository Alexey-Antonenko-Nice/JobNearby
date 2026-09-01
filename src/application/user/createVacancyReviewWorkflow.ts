import type { EmployerClusterRepository } from "../../domain/recognition/EmployerClusterRepository.js";
import type { SourceObservationRepository } from "../../domain/capture/SourceObservationRepository.js";
import type { UserVacancyInteractionRepository } from "../../domain/user/UserVacancyInteractionRepository.js";
import type { CanonicalVacancyId } from "../../domain/vacancies/CanonicalVacancy.js";
import type { CanonicalVacancyRepository } from "../../domain/vacancies/CanonicalVacancyRepository.js";
import type { EmployerMemoryPublicDataSource } from "./EmployerMemoryPublicDataSource.js";
import { getVacancyReviewView } from "./getVacancyReviewView.js";
import {
  recordUserVacancyInteraction,
  type RecordUserVacancyInteractionDependencies,
  type RecordUserVacancyInteractionInput,
} from "./recordUserVacancyInteraction.js";

export interface VacancyReviewWorkflowDependencies {
  readonly canonicalVacancyRepository: Pick<CanonicalVacancyRepository, "findById">;
  readonly sourceObservationRepository: Pick<SourceObservationRepository, "findById">;
  readonly interactionRepository: UserVacancyInteractionRepository;
  readonly employerClusterRepository: Pick<EmployerClusterRepository, "findById">;
  readonly employerMemoryPublicDataSource: EmployerMemoryPublicDataSource;
  readonly now?: RecordUserVacancyInteractionDependencies["now"];
  readonly generateId?: RecordUserVacancyInteractionDependencies["generateId"];
}

export function createVacancyReviewWorkflow(
  dependencies: VacancyReviewWorkflowDependencies,
) {
  const reviewDependencies = {
    canonicalVacancyRepository: dependencies.canonicalVacancyRepository,
    sourceObservationRepository: dependencies.sourceObservationRepository,
    interactionRepository: dependencies.interactionRepository,
    employerClusterRepository: dependencies.employerClusterRepository,
    employerMemoryPublicDataSource: dependencies.employerMemoryPublicDataSource,
  };
  return {
    getVacancyReview: (canonicalVacancyId: CanonicalVacancyId) =>
      getVacancyReviewView(canonicalVacancyId, reviewDependencies),
    recordVacancyReviewAction: async (input: RecordUserVacancyInteractionInput) => {
      const recorded = await recordUserVacancyInteraction(input, {
        canonicalVacancyRepository: dependencies.canonicalVacancyRepository,
        interactionRepository: dependencies.interactionRepository,
        ...(dependencies.now === undefined ? {} : { now: dependencies.now }),
        ...(dependencies.generateId === undefined ? {} : { generateId: dependencies.generateId }),
      });
      return {
        event: recorded.event,
        review: await getVacancyReviewView(input.canonicalVacancyId, reviewDependencies),
      };
    },
  };
}

export type VacancyReviewWorkflow = ReturnType<typeof createVacancyReviewWorkflow>;
