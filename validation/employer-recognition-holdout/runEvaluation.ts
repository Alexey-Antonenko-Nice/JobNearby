import type {
  RecognitionValidationRun,
  RecognitionValidationResult,
} from "../employer-recognition/runValidation.js";
import { runEmployerRecognitionValidation } from "../employer-recognition/runValidation.js";
import { employerRecognitionHoldoutCases } from "./cases/index.js";
import { employerRecognitionHoldoutFixtures } from "./fixtures/index.js";

export type EmployerRecognitionHoldoutResult = RecognitionValidationResult;
export type EmployerRecognitionHoldoutRun = RecognitionValidationRun;

/**
 * Evaluates only the frozen holdout data. The reusable runner supplies the same
 * production pipeline used by regression validation; no regression fixture or
 * human label is read by this entry point.
 */
export async function runEmployerRecognitionHoldoutEvaluation(): Promise<EmployerRecognitionHoldoutRun> {
  return runEmployerRecognitionValidation(
    employerRecognitionHoldoutCases,
    employerRecognitionHoldoutFixtures,
  );
}
