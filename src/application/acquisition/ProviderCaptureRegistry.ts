import { AlstomSelectedVacancyContextLocator, alstomFacts } from "./AlstomVacancy.js";
import { KellySelectedVacancyContextLocator, kellyFacts } from "./KellyWorkdayVacancy.js";
import { ApecSelectedVacancyContextLocator, apecFacts, apecIdentity, apecPublishedAt } from "./ApecVacancy.js";
import { GiGroupSelectedVacancyContextLocator, giGroupFacts, giGroupPublishedAt } from "./GiGroupVacancy.js";
import { PromanSelectedVacancyContextLocator, promanFacts, promanPublishedAt } from "./PromanVacancy.js";
import { StartPeopleSelectedVacancyContextLocator, startPeopleFacts, startPeoplePublishedAt } from "./StartPeopleVacancy.js";
import { ActualSelectedVacancyContextLocator, actualFacts } from "./ActualVacancy.js";
import { CritSelectedVacancyContextLocator, critFacts, critPublishedAt } from "./CritVacancy.js";
import { SynergieSelectedVacancyContextLocator, synergieFacts, synergiePublishedAt } from "./SynergieVacancy.js";
import { RandstadSelectedVacancyContextLocator, randstadFacts, randstadPublishedAt } from "./RandstadVacancy.js";
import { ManpowerSelectedVacancyContextLocator, manpowerFacts } from "./ManpowerVacancy.js";
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

import { TalentSelectedVacancyContextLocator, talentHeaderFields } from "./TalentSelectedVacancyContextLocator.js";

import { AdeccoSelectedVacancyContextLocator, adeccoSelectedFacts } from "./AdeccoSelectedVacancyContextLocator.js";

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
    TALENT: new TalentSelectedVacancyContextLocator(),
    KELLY_WORKDAY: new KellySelectedVacancyContextLocator(),
    ALSTOM: new AlstomSelectedVacancyContextLocator(),
    APEC: new ApecSelectedVacancyContextLocator(),
    GI_GROUP: new GiGroupSelectedVacancyContextLocator(),
    PROMAN: new PromanSelectedVacancyContextLocator(),
    START_PEOPLE: new StartPeopleSelectedVacancyContextLocator(),
    ACTUAL: new ActualSelectedVacancyContextLocator(),
    CRIT: new CritSelectedVacancyContextLocator(),
    SYNERGIE: new SynergieSelectedVacancyContextLocator(),
    RANDSTAD: new RandstadSelectedVacancyContextLocator(),
    MANPOWER: new ManpowerSelectedVacancyContextLocator(),
    ADECCO: new AdeccoSelectedVacancyContextLocator(),
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
    const adeccoFacts = providerKey === "ADECCO" && context?.html ? adeccoSelectedFacts(context.html) : undefined;
    const manpower = providerKey === "MANPOWER" && context?.html ? manpowerFacts(context.html) : undefined;
    const randstad = providerKey === "RANDSTAD" && context?.html ? randstadFacts(context.html) : undefined;
    const randstadDate = context ? randstadPublishedAt(context) : undefined;
    const synergie = providerKey === "SYNERGIE" && context?.html ? synergieFacts(context.html) : undefined;
    const synergieDate = context?.html && providerKey === "SYNERGIE" ? synergiePublishedAt(context.html) : undefined;
    const crit = providerKey === "CRIT" && context?.html ? critFacts(context.html) : undefined;
    const critDate = providerKey === "CRIT" ? critPublishedAt(context?.metadata) : undefined;
    const actual = providerKey === "ACTUAL" && context?.html ? actualFacts(context.html) : undefined;
    const startPeople = providerKey === "START_PEOPLE" && context?.html ? startPeopleFacts(context.html) : undefined;
    const startPeopleDate = context?.html && providerKey === "START_PEOPLE" ? startPeoplePublishedAt(context.html) : undefined;
    const proman = providerKey === "PROMAN" && context?.html ? promanFacts(context.html) : undefined;
    const promanDate = context?.html && providerKey === "PROMAN" ? promanPublishedAt(context.html) : undefined;
    const giGroup = providerKey === "GI_GROUP" && context?.html ? giGroupFacts(context.html) : undefined;
    const giGroupDate = context?.html && providerKey === "GI_GROUP" ? giGroupPublishedAt(context.html) : undefined;
    const kelly = providerKey === "KELLY_WORKDAY" && context?.html ? kellyFacts(context.html) : undefined;
    const apec = providerKey === "APEC" && context?.html ? apecFacts(context.html) : undefined;
    const apecDate = providerKey === "APEC" ? apecPublishedAt(context) : undefined;
    // Conflicting identifiers on an APEC page are never published as an exact identity.
    const apecConflict = providerKey === "APEC" && input.html !== undefined && externalId !== undefined
      && apecIdentity({ sourceUrl: input.sourceUrl, html: input.html, externalId }).status === "CONFLICT";
    const alstom = providerKey === "ALSTOM" && context?.html ? alstomFacts(context.html) : undefined;
    const structuredFields = alstom ? { title: alstom.title, displayedCompanyName: alstom.company, locationText: alstom.location, ...(alstom.publishedAt ? { publishedAt: alstom.publishedAt } : {}) } : apec ? { title: apec.title, ...(apec.company ? { displayedCompanyName: apec.company } : {}), ...(apec.location ? { locationText: apec.location } : {}),
        ...(apec.contract ? { contractText: apec.contract } : {}), ...(apec.salaryText ? { salaryText: apec.salaryText } : {}), ...(apecDate ? { publishedAt: apecDate } : {}) }
      : kelly ? { title: kelly.title, locationText: kelly.values.locations! }
      : giGroup ? { title: giGroup.title, locationText: giGroup.location, ...(giGroupDate ? { publishedAt: giGroupDate } : {}) }
      : proman ? { title: proman.title, locationText: proman.location, ...(promanDate ? { publishedAt: promanDate } : {}) }
      : startPeople ? { title: startPeople.title, locationText: startPeople.values["Localisation"]!, ...(startPeopleDate ? { publishedAt: startPeopleDate } : {}) }
      : actual ? { title: actual.title, locationText: actual.location }
      : crit ? { title: crit.title, locationText: crit.values["Location"]!, ...(critDate ? { publishedAt: critDate } : {}) }
      : synergie ? { title: synergie.title, locationText: synergie.values["Lieu de la mission"]!, ...(synergieDate ? { publishedAt: synergieDate } : {}) }
      : randstad ? { title: randstad.title, locationText: randstad.location, ...(randstadDate ? { publishedAt: randstadDate } : {}) }
      : manpower ? { title: manpower.title, locationText: manpower.location, ...(manpower.publishedAt ? { publishedAt: manpower.publishedAt } : {}) }
      : adeccoFacts ? { title: adeccoFacts.title, ...(adeccoFacts.location ? { locationText: adeccoFacts.location } : {}) }
      : providerKey === "TALENT" && context?.html !== undefined
      ? talentHeaderFields(context.html)
      : providerKey === "HELLOWORK" && context?.html !== undefined
      ? helloWorkHeaderFields(context.html)
      : personioHeader !== undefined
      ? {
          ...(personioHeader.title === undefined ? {} : { title: personioHeader.title }),
          ...(personioHeader.contractTerms.length === 0 ? {} : { contractText: personioHeader.contractTerms.join(" · ") }),
        }
      : providerKey !== "KELLY_WORKDAY" && input.html !== undefined && isWorkdaySource(input.sourceName, input.sourceUrl)
      ? extractWorkdayStructuredFields(input.html, input.sourceUrl)
      : undefined;
    const selectedExternalId = apecConflict ? undefined : context?.providerExternalId ?? externalId;
    return {
      ...(providerKey === undefined ? {} : { providerKey }),
      ...(selectedExternalId === undefined ? {} : { externalId: selectedExternalId }),
      ...(providerKey === "HELLOWORK" || providerKey === "TALENT" || providerKey === "ADECCO" || providerKey === "MANPOWER" || providerKey === "RANDSTAD" || providerKey === "SYNERGIE" || providerKey === "CRIT" || providerKey === "ACTUAL" || providerKey === "START_PEOPLE" || providerKey === "PROMAN" || providerKey === "GI_GROUP" || providerKey === "KELLY_WORKDAY" || providerKey === "APEC" || providerKey === "ALSTOM" ? { requiresSelectedVacancyContext: true } : {}),
      ...(providerKey === "INDEED" ? { requiresSelectedVacancyContext: requiresIndeedSelectedContext(input.sourceUrl, input.html) } : {}),
      ...(context === undefined ? {} : { context }),
      ...(structuredFields === undefined ? {} : { structuredFields }),
    };
  }
}
