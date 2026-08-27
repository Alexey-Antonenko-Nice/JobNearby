import type { ExtractedVacancyEvidence } from "../../src/domain/evidence/ExtractedVacancyEvidence.js";
import type { EmployerRecognitionHoldoutResult, EmployerRecognitionHoldoutRun } from "./runEvaluation.js";
import { diagnoseHoldoutFailures, type HoldoutFailureDiagnosis } from "./failureDiagnosis.js";

export function renderHoldoutFailureDiagnosisReport(
  run: EmployerRecognitionHoldoutRun,
): string {
  const resultsById = new Map(run.results.map((result) => [result.caseId, result]));
  const diagnoses = diagnoseHoldoutFailures(run.results);
  const lines = [
    "# Employer Recognition Holdout Failure Diagnosis",
    "",
    "This forensic report separates observed pipeline facts from engineering interpretations. It does not change recognition behavior or assert that a diagnostic hypothesis is source truth.",
    "",
    "## Preserved evaluation",
    "",
    `- Scored result: ${run.summary.passedCases} / ${run.summary.scoredCases} PASS`,
    `- Pass rate: ${(run.summary.passRate * 100).toFixed(1)}%`,
    `- Diagnosed failures: ${diagnoses.map(({ caseId }) => `\`${caseId}\``).join(", ")}`,
  ];

  for (const diagnosis of diagnoses) {
    const result = resultsById.get(diagnosis.caseId);
    if (result === undefined) throw new Error(`Missing holdout result ${diagnosis.caseId}.`);
    lines.push("", ...renderDiagnosis(result, diagnosis));
  }
  return `${lines.join("\n")}\n`;
}

function renderDiagnosis(
  result: EmployerRecognitionHoldoutResult,
  diagnosis: HoldoutFailureDiagnosis,
): string[] {
  return [
    `## ${diagnosis.caseId}`,
    "",
    `- Expected: \`${result.expectedConfidenceZone}\``,
    `- Actual: \`${result.actualConfidenceZone}\``,
    `- Confidence: ${result.confidence.toFixed(2)}`,
    `- Earliest failure stage: \`${diagnosis.earliestFailureStage}\``,
    `- Failure scope: \`${diagnosis.scope}\``,
    "",
    "### Human-visible recognition clues",
    "",
    "| Clue | In A | In B | Extracted A | Extracted B | Compared | Dimension contribution | Attribution |",
    "|---|---:|---:|---|---|---|---|---|",
    ...diagnosis.humanSignals.map((signal) =>
      `| ${escapeCell(signal.clue)} | ${yesNo(signal.presentInA)} | ${yesNo(signal.presentInB)} | ${escapeCell(signal.extractedFromA)} | ${escapeCell(signal.extractedFromB)} | ${escapeCell(signal.compared)} | ${escapeCell(signal.dimensionContribution)} | \`${signal.attribution}\` |`,
    ),
    "",
    "### Observed pipeline facts",
    "",
    ...renderEvidence("Fixture A", result.leftEvidence),
    "",
    ...renderEvidence("Fixture B", result.rightEvidence),
    "",
    "#### Comparison",
    "",
    `- Positive signals: ${renderSignals(result)}`,
    `- Contradictions: ${renderContradictions(result)}`,
    "",
    "#### Dimensions",
    "",
    `- Identity: \`${result.assessment.identity.assessment}\``,
    `- Geography: \`${result.assessment.geography.assessment}\``,
    `- Characteristics: \`${result.assessment.characteristics.assessment}\``,
    `- Intermediary: \`${result.assessment.intermediary.assessment}\``,
    "",
    `**Observed cause:** ${diagnosis.observedCause}`,
    "",
    "### Engineering interpretation",
    "",
    diagnosis.engineeringHypothesis,
  ];
}

function renderEvidence(label: string, evidence: ExtractedVacancyEvidence): string[] {
  const organizations = evidence.organizations.length === 0
    ? "none"
    : evidence.organizations.map((item) => `${item.value} / ${item.role} / ${item.provenance.extractionMethod} / ${item.provenance.confidence.toFixed(2)}`).join("; ");
  const locations = evidence.locations.length === 0
    ? "none"
    : evidence.locations.map((item) => `${item.value} / ${item.role} / ${item.provenance.extractionMethod} / ${item.provenance.confidence.toFixed(2)}`).join("; ");
  const characteristics = evidence.employerCharacteristics.length === 0
    ? "none"
    : evidence.employerCharacteristics.map((item) => `${item.value} / ${item.category} / ${item.specificity}`).join("; ");
  const externalIdentifiers = evidence.externalIdentifiers.length === 0
    ? "none"
    : evidence.externalIdentifiers.map((item) => `${item.value} / ${item.provider} / ${item.provenance.extractionMethod} / ${item.provenance.confidence.toFixed(2)}`).join("; ");
  return [
    `#### ${label}: \`${evidence.sourceObservationId}\``,
    "",
    `- Organization evidence: ${organizations}`,
    `- Location evidence: ${locations}`,
    `- Employer-characteristic evidence: ${characteristics}`,
    `- External-identifier evidence: ${externalIdentifiers}`,
  ];
}

function renderSignals(result: EmployerRecognitionHoldoutResult): string {
  return result.comparison.positiveSignals.length === 0
    ? "none"
    : result.comparison.positiveSignals.map(({ strength, explanation }) => `[${strength}] ${explanation}`).join("; ");
}

function renderContradictions(result: EmployerRecognitionHoldoutResult): string {
  return result.comparison.contradictions.length === 0
    ? "none"
    : result.comparison.contradictions.map(({ strength, explanation }) => `[${strength}] ${explanation}`).join("; ");
}

function escapeCell(value: string): string {
  return value.replaceAll("|", "\\|").replace(/\s+/gu, " ").trim();
}

function yesNo(value: boolean): string {
  return value ? "yes" : "no";
}
