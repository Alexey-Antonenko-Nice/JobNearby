import type { EmployerRecognitionHoldoutCase } from "../types.js";

export const employerRecognitionHoldoutCases: readonly EmployerRecognitionHoldoutCase[] = [
  {
    caseId: "H01",
    observationIds: ["holdout-4454269228", "holdout-4448033515"],
    expectedRelationship: "POSSIBLE_SAME_EMPLOYER",
    expectedConfidenceZone: "REVIEW_REQUIRED",
    humanExplanation: "Both anonymous vacancies describe Strasbourg pharmaceutical industrial work with substantial overlap around maintenance, projects, utilities, new equipment, and commissioning. This is meaningful circumstantial evidence but does not establish client identity.",
  },
  {
    caseId: "H02",
    observationIds: ["holdout-loxam-strasbourg", "holdout-loxam-haguenau"],
    expectedRelationship: "SAME_EMPLOYER_CLUSTER",
    expectedConfidenceZone: "AUTO_MATCH",
    humanExplanation: "Both publications explicitly identify LOXAM. They concern different locations and business branches, but belong to the explicitly named LOXAM employer organization. This benchmark concerns employer clustering rather than establishment equality.",
  },
  {
    caseId: "H03",
    observationIds: ["holdout-4454269228", "holdout-4445142611"],
    expectedRelationship: "DIFFERENT_EMPLOYERS",
    expectedConfidenceZone: "NO_MATCH",
    humanExplanation: "Anonymous pharmaceutical manufacturing versus anonymous printing, dematerialization, and reprography activity supports different employers.",
  },
  {
    caseId: "H04",
    observationIds: ["holdout-cerelia-hoerdt", "holdout-tir-technologies-kilstett"],
    expectedRelationship: "DIFFERENT_EMPLOYERS",
    expectedConfidenceZone: "NO_MATCH",
    humanExplanation: "The observations explicitly name different organizations and describe strongly different activities: food manufacturing versus solar-protection and closure manufacturing.",
  },
  {
    caseId: "H05",
    observationIds: ["holdout-apave-strasbourg", "holdout-loxam-strasbourg"],
    expectedRelationship: "DIFFERENT_EMPLOYERS",
    expectedConfidenceZone: "NO_MATCH",
    humanExplanation: "The observations explicitly identify different organizations despite overlapping industrial-machine and technical vocabulary.",
  },
  {
    caseId: "H06",
    observationIds: ["holdout-cerelia-hoerdt", "holdout-apave-strasbourg"],
    expectedRelationship: "DIFFERENT_EMPLOYERS",
    expectedConfidenceZone: "NO_MATCH",
    humanExplanation: "The observations explicitly identify different organizations; their shared industrial context must not override employer identity.",
  },
  {
    caseId: "H07",
    observationIds: ["holdout-loxam-strasbourg", "holdout-logic-interim-lifting-client"],
    expectedRelationship: "POSSIBLE_SAME_EMPLOYER",
    expectedConfidenceZone: "REVIEW_REQUIRED",
    humanExplanation: "LOXAM and the anonymous Logic Intérim client both involve Strasbourg-area lifting equipment, maintenance, repairs, and regulatory controls. This makes common identity plausible but not established.",
  },
  {
    caseId: "H08",
    observationIds: ["holdout-hays-anonymous-erstein", "holdout-hays-anonymous-saverne"],
    expectedRelationship: "INSUFFICIENT_EVIDENCE",
    expectedConfidenceZone: "UNSCORED",
    humanExplanation: "The same recruiter and broadly similar industrial-maintenance vocabulary do not provide sufficient client-specific evidence. Different locations alone do not establish different employers.",
  },
  {
    caseId: "H09",
    observationIds: ["holdout-cezam-anonymous-industrial-client", "holdout-cerelia-hoerdt"],
    expectedRelationship: "POSSIBLE_SAME_EMPLOYER",
    expectedConfidenceZone: "REVIEW_REQUIRED",
    humanExplanation: "The anonymous Cezam client and Cérélia both present production-site maintenance fingerprints including shift work, GMAO, and industrial reliability and improvement context. Similarity is suggestive but does not establish identity.",
  },
  {
    caseId: "H10",
    observationIds: ["holdout-cezam-anonymous-industrial-client", "holdout-4445142611"],
    expectedRelationship: "DIFFERENT_EMPLOYERS",
    expectedConfidenceZone: "NO_MATCH",
    humanExplanation: "Industrial production-site maintenance and mobile reprography installation and service have substantially different employer and activity fingerprints.",
  },
];
