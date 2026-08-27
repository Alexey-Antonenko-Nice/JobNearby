import type { EmployerRecognitionHoldoutResult } from "./runEvaluation.js";

export type RecognitionFailureStage =
  | "EXTRACTION"
  | "COMPARISON"
  | "AGGREGATION"
  | "CALIBRATION"
  | "POLICY"
  | "ORGANIZATION_MODEL"
  | "UNRESOLVED";

export type FailureScope = "LOCAL" | "ARCHITECTURAL";

export interface HumanSignalTrace {
  readonly clue: string;
  readonly presentInA: boolean;
  readonly presentInB: boolean;
  readonly extractedFromA: string;
  readonly extractedFromB: string;
  readonly compared: string;
  readonly dimensionContribution: string;
  readonly attribution: "EMPLOYER_CHARACTERISTIC" | "JOB_OR_OCCUPATION_CONTEXT" | "LOCATION" | "ORGANIZATION" | "ABSENT";
}

export interface HoldoutFailureDiagnosis {
  readonly caseId: "H01" | "H02" | "H07" | "H09";
  readonly earliestFailureStage: RecognitionFailureStage;
  readonly scope: FailureScope;
  readonly humanSignals: readonly HumanSignalTrace[];
  readonly observedCause: string;
  readonly engineeringHypothesis: string;
}

export const holdoutFailureDiagnoses: readonly HoldoutFailureDiagnosis[] = [
  {
    caseId: "H01",
    earliestFailureStage: "EXTRACTION",
    scope: "LOCAL",
    humanSignals: [
      trace("Pharmaceutical environment", true, true, "No characteristic", "No characteristic", "No", "None", "EMPLOYER_CHARACTERISTIC"),
      trace("Strasbourg", true, true, "DISPLAYED_LOCATION", "DISPLAYED_LOCATION", "Yes: WEAK location signal", "Geography WEAK_POSITIVE", "LOCATION"),
      trace("Maintenance context", true, true, "No characteristic", "No characteristic", "No", "None", "JOB_OR_OCCUPATION_CONTEXT"),
      trace("Project context", true, false, "No characteristic", "None", "No", "None", "JOB_OR_OCCUPATION_CONTEXT"),
      trace("Utilities", true, true, "No characteristic", "No characteristic", "No", "None", "EMPLOYER_CHARACTERISTIC"),
      trace("New equipment / installation", true, true, "No characteristic", "No characteristic", "No", "None", "JOB_OR_OCCUPATION_CONTEXT"),
      trace("Commissioning / start-up", true, true, "No characteristic", "No characteristic", "No", "None", "JOB_OR_OCCUPATION_CONTEXT"),
      trace("Industrial investment", false, false, "Absent", "Absent", "No", "None", "ABSENT"),
    ],
    observedCause: "Only the shared displayed location and provider-specific identifiers survive extraction. No organization or employer-characteristic evidence is produced from either pharmaceutical excerpt, so comparison has only one weak geographic signal.",
    engineeringHypothesis: "The current explicit characteristic vocabulary does not cover the employer-attributed pharmaceutical, utilities, or production-environment wording in these fixtures. Maintenance, projects, equipment installation, and commissioning also mix employer context with job duties, so their overlap should not automatically be treated as employer identity.",
  },
  {
    caseId: "H02",
    earliestFailureStage: "COMPARISON",
    scope: "ARCHITECTURAL",
    humanSignals: [
      trace("Displayed organization LOXAM", true, true, "LOXAM / UNKNOWN / DIRECT_FIELD / 1.00", "LOXAM / UNKNOWN / DIRECT_FIELD / 1.00", "No identity signal", "Identity UNKNOWN", "ORGANIZATION"),
      trace("Plain LOXAM in recognition-relevant text", true, true, "Direct displayed-company field", "Direct displayed-company field", "Not compared as employer identity", "None", "ORGANIZATION"),
      trace("Same establishment location", false, false, "Strasbourg displayed location", "Haguenau displayed location", "No location signal or contradiction", "Geography UNKNOWN", "LOCATION"),
      trace("LOXAM ACCESS / LOXAM RENTAL values", false, false, "Absent", "Absent", "No literal comparison", "None", "ABSENT"),
    ],
    observedCause: "Both identical LOXAM organization values survive direct-field extraction, but both retain role UNKNOWN. The comparator emits neither a positive identity signal nor a contradiction for UNKNOWN-role organizations. With every dimension UNKNOWN, confidence falls through to the 0.10 default and policy returns NO_MATCH.",
    engineeringHypothesis: "This is primarily an organization-role/comparison-rule boundary: identical displayed organizations are deliberately not treated as employer identity when their role is UNKNOWN. It is not a normalization, alias, or parent-brand/business-unit failure in the frozen fixtures, because both extracted strings are already exactly LOXAM and no ACCESS/RENTAL relationship is represented or required by the actual data.",
  },
  {
    caseId: "H07",
    earliestFailureStage: "EXTRACTION",
    scope: "LOCAL",
    humanSignals: [
      trace("Lifting equipment", true, true, "No characteristic", "No characteristic", "No", "None", "JOB_OR_OCCUPATION_CONTEXT"),
      trace("Maintenance", true, true, "No characteristic", "No characteristic", "No", "None", "JOB_OR_OCCUPATION_CONTEXT"),
      trace("Repair", true, true, "No characteristic", "No characteristic", "No", "None", "JOB_OR_OCCUPATION_CONTEXT"),
      trace("Regulatory controls", true, true, "No characteristic", "No characteristic", "No", "None", "JOB_OR_OCCUPATION_CONTEXT"),
      trace("Strasbourg", true, true, "DISPLAYED_LOCATION", "DISPLAYED_LOCATION", "Yes: WEAK location signal", "Geography WEAK_POSITIVE", "LOCATION"),
      trace("Employer identity", true, false, "LOXAM / UNKNOWN", "Only Logic Intérim / UNKNOWN; client anonymous", "No identity signal", "Identity UNKNOWN", "ORGANIZATION"),
    ],
    observedCause: "The shared Strasbourg display location survives and yields a weak geographic signal. The distinctive combination of lifting-equipment work, repair, and regulatory controls produces no employer-characteristic evidence. The anonymous client is not represented as an organization.",
    engineeringHypothesis: "The extraction gap is local to unsupported equipment/activity wording, but attribution remains important: maintenance, repair, and controls are job duties and cannot alone establish employer identity. Lifting equipment is the potentially distinctive employer fingerprint; the current extractor does not preserve it for comparison.",
  },
  {
    caseId: "H09",
    earliestFailureStage: "EXTRACTION",
    scope: "LOCAL",
    humanSignals: [
      trace("Production site", true, true, "No characteristic", "No characteristic", "No", "None", "EMPLOYER_CHARACTERISTIC"),
      trace("Shift/team organization", true, true, "No characteristic", "No characteristic", "No", "None", "JOB_OR_OCCUPATION_CONTEXT"),
      trace("Explicit 5x8 organization", false, false, "Absent", "Absent", "No", "None", "ABSENT"),
      trace("GMAO", true, true, "No characteristic", "No characteristic", "No", "None", "JOB_OR_OCCUPATION_CONTEXT"),
      trace("Industrial maintenance", true, true, "Title only; no characteristic", "Title only; no characteristic", "No", "None", "JOB_OR_OCCUPATION_CONTEXT"),
      trace("Reliability / improvement", true, true, "No characteristic", "No characteristic", "No", "None", "JOB_OR_OCCUPATION_CONTEXT"),
      trace("Continuous improvement specifically", true, false, "No characteristic", "Absent", "No", "None", "JOB_OR_OCCUPATION_CONTEXT"),
      trace("Energy / boiler rounds", false, false, "Absent", "Absent", "No", "None", "ABSENT"),
    ],
    observedCause: "Neither production-site wording nor any operational overlap becomes employer-characteristic evidence. Different displayed organizations and locations remain UNKNOWN-role/context evidence and create no signals or contradictions, leaving all dimensions UNKNOWN and confidence at 0.10.",
    engineeringHypothesis: "The current extractor has no applicable rules for production-site context, GMAO, shift organization, or reliability wording. Most overlap describes maintenance organization or duties rather than a distinctive employer, so a future approach would need employer attribution and specificity safeguards; this diagnosis does not assert that the two clients are identical.",
  },
] as const;

export function diagnoseHoldoutFailures(
  results: readonly EmployerRecognitionHoldoutResult[],
): readonly HoldoutFailureDiagnosis[] {
  const failedIds = new Set(
    results.filter(({ outcome }) => outcome === "FAIL").map(({ caseId }) => caseId),
  );
  return holdoutFailureDiagnoses.filter(({ caseId }) => failedIds.has(caseId));
}

function trace(
  clue: string,
  presentInA: boolean,
  presentInB: boolean,
  extractedFromA: string,
  extractedFromB: string,
  compared: string,
  dimensionContribution: string,
  attribution: HumanSignalTrace["attribution"],
): HumanSignalTrace {
  return { clue, presentInA, presentInB, extractedFromA, extractedFromB, compared, dimensionContribution, attribution };
}
