import type { ProviderKey } from "../../domain/acquisition/ProviderKey.js";
import { extractBurkertApplyId } from "./BurkertVacancyIdentity.js";
import { ConservativeProviderVacancyIdExtractor } from "./ConservativeProviderVacancyIdExtractor.js";
import { FranceTravailSelectedVacancyContextLocator } from "./FranceTravailSelectedVacancyContextLocator.js";
import { HostnameAcquisitionProviderRecognizer } from "./HostnameAcquisitionProviderRecognizer.js";
import { IndeedSelectedVacancyContextLocator, requiresIndeedSelectedContext } from "./IndeedSelectedVacancyContextLocator.js";
import { JoobleSelectedVacancyContextLocator } from "./JoobleSelectedVacancyContextLocator.js";
import { CadremploiSelectedVacancyContextLocator } from "./CadremploiSelectedVacancyContextLocator.js";
import { LhhSelectedVacancyContextLocator } from "./LhhSelectedVacancyContextLocator.js";
import { LinkedInSelectedVacancyContextLocator } from "./LinkedInSelectedVacancyContextLocator.js";
import { extractWorkdayStructuredFields, isWorkdaySource } from "./WorkdayVacancy.js";
import type { SelectedVacancyContextLocator } from "./SelectedVacancyContextLocator.js";
import { extractPersonioHeaderFacts } from "./PersonioVacancy.js";

import { HelloWorkSelectedVacancyContextLocator, helloWorkHeaderFields } from "./HelloWorkVacancy.js";

export interface ProviderCaptureInput {
  readonly sourceName: string;
  readonly sourceUrl: string;
  readonly html?: string;
}

export interface ProviderCaptureResult {
  readonly requiresSelectedVacancyContext?: boolean;
  readonly providerKey?: ProviderKey;
  readonly externalId?: string;
  readonly context?: ReturnType<SelectedVacancyContextLocator["locate"]>;
  readonly structuredFields?: {
    readonly title?: string;
    readonly displayedCompanyName?: string;
    readonly locationText?: string;
    readonly contractText?: string;
    readonly salaryText?: string;
    readonly publishedAt?: Date;
  };
}

export class ProviderCaptureRegistry {
  private readonly recognizer = new HostnameAcquisitionProviderRecognizer();
  private readonly idExtractor = new ConservativeProviderVacancyIdExtractor();
  private readonly contextLocators: Partial<Readonly<Record<ProviderKey, SelectedVacancyContextLocator>>> = {
    FRANCE_TRAVAIL: new FranceTravailSelectedVacancyContextLocator(),
    INDEED: new IndeedSelectedVacancyContextLocator(),
    LINKEDIN: new LinkedInSelectedVacancyContextLocator(),
    JOOBLE: new JoobleSelectedVacancyContextLocator(),
    CADREMPLOI: new CadremploiSelectedVacancyContextLocator(),
    LHH: new LhhSelectedVacancyContextLocator(),
    HELLOWORK: new HelloWorkSelectedVacancyContextLocator(),
  };

  capture(input: ProviderCaptureInput): ProviderCaptureResult {
    const providerKey = this.recognizer.recognize({ sourceName: input.sourceName, sourceUrl: input.sourceUrl });
    const providerExternalId = this.idExtractor.extract({ sourceName: input.sourceName, sourceUrl: input.sourceUrl });
    const externalId = input.sourceName === "burkert.com" && input.html !== undefined
      ? extractBurkertApplyId(input.html) ?? providerExternalId
      : providerExternalId;
    const context = providerKey === undefined || input.html === undefined
      ? undefined
      : this.contextLocators[providerKey]?.locate({
          providerKey, sourceUrl: input.sourceUrl,
          ...(externalId === undefined ? {} : { externalId }), html: input.html,
        });
    const personioHeader = providerKey === "PERSONIO" && externalId !== undefined && input.html !== undefined
      ? extractPersonioHeaderFacts(input.html) : undefined;
    const structuredFields = providerKey === "HELLOWORK" && context?.html !== undefined
      ? helloWorkHeaderFields(context.html)
      : personioHeader !== undefined
      ? {
          ...(personioHeader.title === undefined ? {} : { title: personioHeader.title }),
          ...(personioHeader.contractTerms.length === 0 ? {} : { contractText: personioHeader.contractTerms.join(" · ") }),
        }
      : input.html !== undefined && isWorkdaySource(input.sourceName, input.sourceUrl)
      ? extractWorkdayStructuredFields(input.html, input.sourceUrl)
      : undefined;
    const selectedExternalId = context?.providerExternalId ?? externalId;
    return {
      ...(providerKey === undefined ? {} : { providerKey }),
      ...(selectedExternalId === undefined ? {} : { externalId: selectedExternalId }),
      ...(providerKey === "HELLOWORK" ? { requiresSelectedVacancyContext: true } : {}),
      ...(providerKey === "INDEED" ? { requiresSelectedVacancyContext: requiresIndeedSelectedContext(input.sourceUrl, input.html) } : {}),
      ...(context === undefined ? {} : { context }),
      ...(structuredFields === undefined ? {} : { structuredFields }),
    };
  }
}
