import {
  createAcquisitionContext,
  type AcquisitionContext,
} from "../acquisition/AcquisitionContext.js";
import type { SourceObservation } from "../capture/SourceObservation.js";

export type EvidenceInputContent =
  | { readonly kind: "SOURCE_OBSERVATION" }
  | {
      readonly kind: "SELECTED_VACANCY_CONTEXT";
      readonly context: AcquisitionContext;
    };

export interface VacancyEvidenceInput extends SourceObservation {
  readonly evidenceContent: EvidenceInputContent;
}

export type VacancyEvidenceExtractionInput =
  | SourceObservation
  | VacancyEvidenceInput;

export function fromSourceObservation(
  sourceObservation: SourceObservation,
): VacancyEvidenceInput {
  return { ...sourceObservation, evidenceContent: { kind: "SOURCE_OBSERVATION" } };
}

export function fromSelectedVacancyContext(
  sourceObservation: SourceObservation,
  context: AcquisitionContext,
): VacancyEvidenceInput {
  const selectedContext = createAcquisitionContext(context);
  if (selectedContext.kind !== "SELECTED_VACANCY") {
    throw new Error("Evidence input context must be SELECTED_VACANCY.");
  }
  return {
    ...sourceObservation,
    evidenceContent: {
      kind: "SELECTED_VACANCY_CONTEXT",
      context: selectedContext,
    },
  };
}

export function normalizeVacancyEvidenceInput(
  input: VacancyEvidenceExtractionInput,
): VacancyEvidenceInput {
  return "evidenceContent" in input ? input : fromSourceObservation(input);
}