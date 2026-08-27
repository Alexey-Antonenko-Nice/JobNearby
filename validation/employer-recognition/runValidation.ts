import { CompositeVacancyEvidenceExtractor } from "../../src/application/evidence/CompositeVacancyEvidenceExtractor.js";
import { DirectFieldVacancyEvidenceExtractor } from "../../src/application/evidence/DirectFieldVacancyEvidenceExtractor.js";
import { ExplicitEmployerCharacteristicExtractor } from "../../src/application/evidence/ExplicitEmployerCharacteristicExtractor.js";
import { ExplicitTextVacancyEvidenceExtractor } from "../../src/application/evidence/ExplicitTextVacancyEvidenceExtractor.js";
import type { ExtractedVacancyEvidence } from "../../src/domain/evidence/ExtractedVacancyEvidence.js";
import type { VacancyEvidenceExtractor } from "../../src/domain/evidence/VacancyEvidenceExtractor.js";
import { DEFAULT_EMPLOYER_CLUSTER_ASSIGNMENT_POLICY } from "../../src/domain/recognition/EmployerClusterAssignmentPolicy.js";
import type { EmployerEvidenceComparison } from "../../src/domain/recognition/EmployerEvidenceComparison.js";
import type { EmployerMatchAssessment } from "../../src/domain/recognition/EmployerMatchAssessment.js";
import { assessEmployerMatchDimensions } from "../../src/domain/recognition/assessEmployerMatchDimensions.js";
import { calculateEmployerMatchConfidence } from "../../src/domain/recognition/calculateEmployerMatchConfidence.js";
import { compareEmployerEvidence } from "../../src/domain/recognition/compareEmployerEvidence.js";
import { decideEmployerClusterAssignment } from "../../src/domain/recognition/decideEmployerClusterAssignment.js";
import { employerRecognitionCases } from "./cases/index.js";
import { employerRecognitionFixtures } from "./fixtures/index.js";
import type {
  ExpectedConfidenceZone,
  ExpectedEmployerRelationship,
  RecognitionValidationCase,
  RecognitionValidationFixture,
} from "./types.js";

export type ActualConfidenceZone = Exclude<ExpectedConfidenceZone, "UNSCORED">;
export type RecognitionValidationOutcome = "PASS" | "FAIL" | "UNSCORED";

export interface RecognitionValidationResult {
  readonly caseId: string;
  readonly expectedRelationship: ExpectedEmployerRelationship;
  readonly expectedConfidenceZone: ExpectedConfidenceZone;
  readonly humanExplanation: string;
  readonly confidence: number;
  readonly actualConfidenceZone: ActualConfidenceZone;
  readonly outcome: RecognitionValidationOutcome;
  readonly leftEvidence: ExtractedVacancyEvidence;
  readonly rightEvidence: ExtractedVacancyEvidence;
  readonly comparison: EmployerEvidenceComparison;
  readonly assessment: EmployerMatchAssessment;
}

export interface RecognitionValidationSummary {
  readonly totalCases: number;
  readonly scoredCases: number;
  readonly passedCases: number;
  readonly failedCases: number;
  readonly unscoredCases: number;
  readonly passRate: number;
}

export interface RecognitionValidationRun {
  readonly results: readonly RecognitionValidationResult[];
  readonly summary: RecognitionValidationSummary;
}

export type RecognitionValidationCaseInput = Pick<
  RecognitionValidationCase,
  | "caseId"
  | "observationIds"
  | "expectedRelationship"
  | "expectedConfidenceZone"
  | "humanExplanation"
>;

export async function runEmployerRecognitionValidation(
  cases: readonly RecognitionValidationCaseInput[] = employerRecognitionCases,
  fixtures: readonly RecognitionValidationFixture[] = employerRecognitionFixtures,
): Promise<RecognitionValidationRun> {
  const fixturesById = new Map(fixtures.map((fixture) => [fixture.id, fixture]));
  const extractor = createValidationEvidenceExtractor();
  const results: RecognitionValidationResult[] = [];

  for (const validationCase of cases) {
    results.push(
      await executeRecognitionValidationCase(
        validationCase,
        fixturesById,
        extractor,
      ),
    );
  }

  return { results, summary: summarizeRecognitionValidation(results) };
}

export function scoreRecognitionValidationOutcome(
  validationCase: RecognitionValidationCaseInput,
  actualConfidenceZone: ActualConfidenceZone,
): RecognitionValidationOutcome {
  if (
    validationCase.expectedRelationship === "INSUFFICIENT_EVIDENCE" &&
    validationCase.expectedConfidenceZone === "UNSCORED"
  ) {
    return "UNSCORED";
  }
  return validationCase.expectedConfidenceZone === actualConfidenceZone
    ? "PASS"
    : "FAIL";
}

export function summarizeRecognitionValidation(
  results: readonly Pick<RecognitionValidationResult, "outcome">[],
): RecognitionValidationSummary {
  const passedCases = results.filter(({ outcome }) => outcome === "PASS").length;
  const failedCases = results.filter(({ outcome }) => outcome === "FAIL").length;
  const unscoredCases = results.filter(
    ({ outcome }) => outcome === "UNSCORED",
  ).length;
  const scoredCases = passedCases + failedCases;

  return {
    totalCases: results.length,
    scoredCases,
    passedCases,
    failedCases,
    unscoredCases,
    passRate: scoredCases === 0 ? 0 : passedCases / scoredCases,
  };
}

async function executeRecognitionValidationCase(
  validationCase: RecognitionValidationCaseInput,
  fixturesById: ReadonlyMap<string, RecognitionValidationFixture>,
  extractor: VacancyEvidenceExtractor,
): Promise<RecognitionValidationResult> {
  const leftFixture = requireFixture(
    fixturesById,
    validationCase.observationIds[0],
  );
  const rightFixture = requireFixture(
    fixturesById,
    validationCase.observationIds[1],
  );
  const [leftEvidence, rightEvidence] = await Promise.all([
    extractor.extract(leftFixture),
    extractor.extract(rightFixture),
  ]);
  const comparison = compareEmployerEvidence(leftEvidence, rightEvidence);
  const assessment = assessEmployerMatchDimensions(comparison);
  const confidence = calculateEmployerMatchConfidence(assessment);
  const decision = decideEmployerClusterAssignment(
    {
      cluster: {
        id: `validation-${validationCase.caseId}`,
        status: "UNRESOLVED",
        createdAt: new Date(0),
        updatedAt: new Date(0),
      },
      confidence,
    },
    DEFAULT_EMPLOYER_CLUSTER_ASSIGNMENT_POLICY,
  );
  const actualConfidenceZone = decision.outcome;

  return {
    caseId: validationCase.caseId,
    expectedRelationship: validationCase.expectedRelationship,
    expectedConfidenceZone: validationCase.expectedConfidenceZone,
    humanExplanation: validationCase.humanExplanation,
    confidence,
    actualConfidenceZone,
    outcome: scoreRecognitionValidationOutcome(
      validationCase,
      actualConfidenceZone,
    ),
    leftEvidence,
    rightEvidence,
    comparison,
    assessment,
  };
}

function createValidationEvidenceExtractor(): VacancyEvidenceExtractor {
  return new CompositeVacancyEvidenceExtractor([
    new DirectFieldVacancyEvidenceExtractor(),
    new ExplicitTextVacancyEvidenceExtractor(),
    new ExplicitEmployerCharacteristicExtractor(),
  ]);
}

function requireFixture(
  fixtures: ReadonlyMap<string, RecognitionValidationFixture>,
  observationId: string,
): RecognitionValidationFixture {
  const fixture = fixtures.get(observationId);
  if (fixture === undefined) {
    throw new Error(`Validation fixture "${observationId}" does not exist.`);
  }
  return fixture;
}
