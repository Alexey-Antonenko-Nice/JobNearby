import { RandstadVacancyEvidenceExtractor } from "./RandstadVacancyEvidenceExtractor.js";
import { ManpowerVacancyEvidenceExtractor } from "./ManpowerVacancyEvidenceExtractor.js";
import { CompositeVacancyEvidenceExtractor } from "./CompositeVacancyEvidenceExtractor.js";
import { CoreVacancyHeaderFactsExtractor } from "./CoreVacancyHeaderFactsExtractor.js";
import { DirectFieldVacancyEvidenceExtractor } from "./DirectFieldVacancyEvidenceExtractor.js";
import { ExplicitCandidateRequirementsExtractor } from "./ExplicitCandidateRequirementsExtractor.js";
import { ExplicitEmployerCharacteristicExtractor } from "./ExplicitEmployerCharacteristicExtractor.js";
import { ExplicitTextVacancyEvidenceExtractor } from "./ExplicitTextVacancyEvidenceExtractor.js";
import { IndeedSelectedVacancyEvidenceExtractor } from "./IndeedSelectedVacancyEvidenceExtractor.js";
import { WorkdayVacancyEvidenceExtractor } from "./WorkdayVacancyEvidenceExtractor.js";
import { PersonioVacancyEvidenceExtractor } from "./PersonioVacancyEvidenceExtractor.js";
import { JoobleSelectedVacancyEvidenceExtractor } from "./JoobleSelectedVacancyEvidenceExtractor.js";
import { LinkedInSelectedVacancyEvidenceExtractor } from "./LinkedInSelectedVacancyEvidenceExtractor.js";
import { CadremploiSelectedVacancyEvidenceExtractor } from "./CadremploiSelectedVacancyEvidenceExtractor.js";
import { LhhSelectedVacancyEvidenceExtractor } from "./LhhSelectedVacancyEvidenceExtractor.js";

import { AdeccoSelectedVacancyEvidenceExtractor } from "./AdeccoSelectedVacancyEvidenceExtractor.js";

export function createVacancyEvidenceExtractor(): CompositeVacancyEvidenceExtractor {
  return new CompositeVacancyEvidenceExtractor([
    new RandstadVacancyEvidenceExtractor(),
    new ManpowerVacancyEvidenceExtractor(),
    new AdeccoSelectedVacancyEvidenceExtractor(),
    new WorkdayVacancyEvidenceExtractor(),
    new PersonioVacancyEvidenceExtractor(),
    new JoobleSelectedVacancyEvidenceExtractor(),
    new LinkedInSelectedVacancyEvidenceExtractor(),
    new CadremploiSelectedVacancyEvidenceExtractor(),
    new LhhSelectedVacancyEvidenceExtractor(),
    new IndeedSelectedVacancyEvidenceExtractor(),
    new DirectFieldVacancyEvidenceExtractor(),
    new ExplicitTextVacancyEvidenceExtractor(),
    new ExplicitEmployerCharacteristicExtractor(),
    new CoreVacancyHeaderFactsExtractor(),
    new ExplicitCandidateRequirementsExtractor(),
  ]);
}
