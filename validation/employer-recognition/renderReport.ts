import type { EmployerCharacteristicEvidence } from "../../src/domain/evidence/EmployerCharacteristicEvidence.js";
import type { EvidenceProvenance } from "../../src/domain/evidence/EvidenceProvenance.js";
import type { ExternalIdentifierEvidence } from "../../src/domain/evidence/ExternalIdentifierEvidence.js";
import type { ExtractedVacancyEvidence } from "../../src/domain/evidence/ExtractedVacancyEvidence.js";
import type { LocationEvidence } from "../../src/domain/evidence/LocationEvidence.js";
import type { OrganizationEvidence } from "../../src/domain/evidence/OrganizationEvidence.js";
import type { PersonEvidence } from "../../src/domain/evidence/PersonEvidence.js";
import type {
  RecognitionValidationResult,
  RecognitionValidationRun,
} from "./runValidation.js";

export type ValidationDiagnosticCategory =
  | "EXPECTED_BEHAVIOR"
  | "LIKELY_EXTRACTION_GAP"
  | "LIKELY_COMPARISON_GAP"
  | "LIKELY_AGGREGATION_GAP"
  | "LIKELY_CALIBRATION_GAP"
  | "OVERCONFIDENT"
  | "UNDERCONFIDENT"
  | "UNEXPLAINED_FAILURE"
  | "UNSCORED";

export interface ValidationDiagnostic {
  readonly category: ValidationDiagnosticCategory;
  readonly explanation: string;
}

export function renderEmployerRecognitionValidationReport(
  run: RecognitionValidationRun,
): string {
  const failedCaseIds = run.results
    .filter(({ outcome }) => outcome === "FAIL")
    .map(({ caseId }) => caseId);
  const lines: string[] = [
    "# Employer Recognition Validation Report",
    "",
    "## Summary",
    "",
    `- Total cases: ${run.summary.totalCases}`,
    `- Scored cases: ${run.summary.scoredCases}`,
    `- Passed: ${run.summary.passedCases}`,
    `- Failed: ${run.summary.failedCases}`,
    `- Unscored: ${run.summary.unscoredCases}`,
    `- Pass rate: ${(run.summary.passRate * 100).toFixed(1)}%`,
    `- Failed case IDs: ${
      failedCaseIds.length === 0
        ? "None."
        : failedCaseIds.map(inlineCode).join(", ")
    }`,
  ];

  for (const result of run.results) {
    lines.push("", ...renderCase(result));
  }

  return `${lines.join("\n")}\n`;
}

export function classifyValidationDiagnostic(
  result: RecognitionValidationResult,
): ValidationDiagnostic {
  if (result.outcome === "UNSCORED") {
    return {
      category: "UNSCORED",
      explanation:
        "This case intentionally has insufficient human-labelled evidence and is excluded from pass/fail scoring.",
    };
  }
  if (result.outcome === "PASS") {
    return {
      category: "EXPECTED_BEHAVIOR",
      explanation: "The observed confidence zone matches the benchmark expectation.",
    };
  }
  if (
    result.actualConfidenceZone === "AUTO_MATCH" &&
    result.expectedConfidenceZone !== "AUTO_MATCH"
  ) {
    return {
      category: "OVERCONFIDENT",
      explanation:
        "The engine automatically matched a case whose benchmark expected review or no match.",
    };
  }
  if (
    result.expectedConfidenceZone === "AUTO_MATCH" &&
    result.actualConfidenceZone !== "AUTO_MATCH"
  ) {
    return {
      category: "UNDERCONFIDENT",
      explanation:
        "The engine did not automatically match a case labelled for automatic matching.",
    };
  }
  if (
    result.expectedRelationship === "POSSIBLE_SAME_EMPLOYER" &&
    result.expectedConfidenceZone === "REVIEW_REQUIRED" &&
    result.assessment.identity.assessment === "UNKNOWN" &&
    result.assessment.characteristics.assessment === "UNKNOWN" &&
    countEmployerRelevantEvidence(result.leftEvidence) <= 2 &&
    countEmployerRelevantEvidence(result.rightEvidence) <= 2
  ) {
    return {
      category: "LIKELY_EXTRACTION_GAP",
      explanation:
        "The expected-review case produced no identity or characteristic assessment and very little employer-relevant extracted evidence.",
    };
  }

  return {
    category: "UNEXPLAINED_FAILURE",
    explanation:
      "The structured output does not support a conservative attribution to extraction, comparison, aggregation, or calibration.",
  };
}

function renderCase(result: RecognitionValidationResult): string[] {
  const diagnostic = classifyValidationDiagnostic(result);
  return [
    `## Case: ${inlineCode(result.caseId)}`,
    "",
    `- Human-labelled relationship: ${inlineCode(result.expectedRelationship)}`,
    `- Expected confidence zone: ${inlineCode(result.expectedConfidenceZone)}`,
    `- Actual confidence zone: ${inlineCode(result.actualConfidenceZone)}`,
    `- Numeric confidence: ${result.confidence.toFixed(2)}`,
    `- Outcome: ${inlineCode(result.outcome)}`,
    `- Human explanation: ${escapeMarkdown(result.humanExplanation)}`,
    "",
    "### Observed facts",
    "",
    ...renderObservation("Observation A", result.leftEvidence),
    "",
    ...renderObservation("Observation B", result.rightEvidence),
    "",
    "### Evidence comparison",
    "",
    "#### Positive signals",
    "",
    ...renderSignals(result),
    "",
    "#### Contradictions",
    "",
    ...renderContradictions(result),
    "",
    "### Dimension assessments",
    "",
    `- Identity: ${inlineCode(result.assessment.identity.assessment)}`,
    `- Geography: ${inlineCode(result.assessment.geography.assessment)}`,
    `- Characteristics: ${inlineCode(result.assessment.characteristics.assessment)}`,
    `- Intermediary: ${inlineCode(result.assessment.intermediary.assessment)}`,
    "",
    "### Diagnostic hypothesis",
    "",
    `- Category: ${inlineCode(diagnostic.category)}`,
    `- Interpretation: ${escapeMarkdown(diagnostic.explanation)}`,
    "",
    "The diagnostic hypothesis is an engineering interpretation of observed output, not human-labelled benchmark truth.",
  ];
}

function renderObservation(
  label: string,
  evidence: ExtractedVacancyEvidence,
): string[] {
  return [
    `#### ${label}: ${inlineCode(evidence.sourceObservationId)}`,
    "",
    "##### Organizations",
    "",
    ...renderItems(evidence.organizations, renderOrganization),
    "",
    "##### Locations",
    "",
    ...renderItems(evidence.locations, renderLocation),
    "",
    "##### People",
    "",
    ...renderItems(evidence.people, renderPerson),
    "",
    "##### Employer characteristics",
    "",
    ...renderItems(evidence.employerCharacteristics, renderCharacteristic),
    "",
    "##### External identifiers",
    "",
    ...renderItems(evidence.externalIdentifiers, renderExternalIdentifier),
  ];
}

function renderOrganization(evidence: OrganizationEvidence): string {
  return `${escapeMarkdown(evidence.value)} — role: ${inlineCode(evidence.role)}; ${renderProvenance(evidence.provenance)}`;
}

function renderLocation(evidence: LocationEvidence): string {
  return `${escapeMarkdown(evidence.value)} — role: ${inlineCode(evidence.role)}; ${renderProvenance(evidence.provenance)}`;
}

function renderPerson(evidence: PersonEvidence): string {
  return `${escapeMarkdown(evidence.value)} — role: ${inlineCode(evidence.role)}; ${renderProvenance(evidence.provenance)}`;
}

function renderCharacteristic(evidence: EmployerCharacteristicEvidence): string {
  return `${escapeMarkdown(evidence.value)} — category: ${inlineCode(evidence.category)}; specificity: ${inlineCode(evidence.specificity)}; ${renderProvenance(evidence.provenance)}`;
}

function renderExternalIdentifier(evidence: ExternalIdentifierEvidence): string {
  return `${escapeMarkdown(evidence.value)} — provider: ${inlineCode(evidence.provider)}; type: ${inlineCode(evidence.identifierType)}; ${renderProvenance(evidence.provenance)}`;
}

function renderProvenance(provenance: EvidenceProvenance): string {
  return `method: ${inlineCode(provenance.extractionMethod)}; confidence: ${provenance.confidence.toFixed(2)}`;
}

function renderItems<T>(
  items: readonly T[],
  render: (item: T) => string,
): string[] {
  return items.length === 0
    ? ["None extracted."]
    : items.map((item) => `- ${render(item)}`);
}

function renderSignals(result: RecognitionValidationResult): string[] {
  return result.comparison.positiveSignals.length === 0
    ? ["None produced."]
    : result.comparison.positiveSignals.map(
        (signal) =>
          `- [${signal.strength}] ${escapeMarkdown(signal.explanation)}`,
      );
}

function renderContradictions(result: RecognitionValidationResult): string[] {
  return result.comparison.contradictions.length === 0
    ? ["None produced."]
    : result.comparison.contradictions.map(
        (contradiction) =>
          `- [${contradiction.strength}] ${escapeMarkdown(contradiction.explanation)}`,
      );
}

function countEmployerRelevantEvidence(
  evidence: ExtractedVacancyEvidence,
): number {
  return (
    evidence.organizations.filter(({ role }) => role === "EMPLOYER").length +
    evidence.locations.filter(
      ({ role }) => role === "WORKPLACE" || role === "EMPLOYER_LOCATION",
    ).length +
    evidence.employerCharacteristics.length
  );
}

function inlineCode(value: string): string {
  return `\`${value.replace(/\s+/gu, " ").trim().replaceAll("`", "\\`")}\``;
}

function escapeMarkdown(value: string): string {
  return value
    .replace(/\s+/gu, " ")
    .trim()
    .replace(/([\\`*_{}\[\]<>#|])/gu, "\\$1");
}
