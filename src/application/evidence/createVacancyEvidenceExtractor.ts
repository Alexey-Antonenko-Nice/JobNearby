import { CompositeVacancyEvidenceExtractor } from "./CompositeVacancyEvidenceExtractor.js";
import { CoreVacancyHeaderFactsExtractor } from "./CoreVacancyHeaderFactsExtractor.js";
import { DirectFieldVacancyEvidenceExtractor } from "./DirectFieldVacancyEvidenceExtractor.js";
import { ExplicitCandidateRequirementsExtractor } from "./ExplicitCandidateRequirementsExtractor.js";
import { ExplicitEmployerCharacteristicExtractor } from "./ExplicitEmployerCharacteristicExtractor.js";
import { ExplicitTextVacancyEvidenceExtractor } from "./ExplicitTextVacancyEvidenceExtractor.js";
import { IndeedSelectedVacancyEvidenceExtractor } from "./IndeedSelectedVacancyEvidenceExtractor.js";
import { WorkdayVacancyEvidenceExtractor } from "./WorkdayVacancyEvidenceExtractor.js";

export function createVacancyEvidenceExtractor(): CompositeVacancyEvidenceExtractor {
  return new CompositeVacancyEvidenceExtractor([
    new WorkdayVacancyEvidenceExtractor(),
    new IndeedSelectedVacancyEvidenceExtractor(),
    new DirectFieldVacancyEvidenceExtractor(),
    new ExplicitTextVacancyEvidenceExtractor(),
    new ExplicitEmployerCharacteristicExtractor(),
    new CoreVacancyHeaderFactsExtractor(),
    new ExplicitCandidateRequirementsExtractor(),
  ]);
}