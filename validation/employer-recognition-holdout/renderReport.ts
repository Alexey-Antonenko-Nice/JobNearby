import {
  classifyValidationDiagnostic,
  renderEmployerRecognitionValidationReport,
  type ValidationDiagnostic,
  type ValidationDiagnosticCategory,
} from "../employer-recognition/renderReport.js";
import type {
  EmployerRecognitionHoldoutResult,
  EmployerRecognitionHoldoutRun,
} from "./runEvaluation.js";

export type HoldoutDiagnostic = ValidationDiagnostic;
export type HoldoutDiagnosticCategory = ValidationDiagnosticCategory;

export function classifyHoldoutDiagnostic(
  result: EmployerRecognitionHoldoutResult,
): HoldoutDiagnostic {
  return classifyValidationDiagnostic(result);
}

export function renderEmployerRecognitionHoldoutReport(
  run: EmployerRecognitionHoldoutRun,
): string {
  return renderEmployerRecognitionValidationReport(run).replace(
    "# Employer Recognition Validation Report",
    "# Independent Employer Recognition Holdout Evaluation",
  );
}
