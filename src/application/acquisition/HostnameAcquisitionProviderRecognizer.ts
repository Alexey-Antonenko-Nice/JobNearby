import { isKellyWorkdaySource } from "./KellyWorkdayVacancy.js";
import type { ProviderKey } from "../../domain/acquisition/ProviderKey.js";
import { isPersonioSource } from "./PersonioVacancy.js";
import type {
  AcquisitionProviderRecognitionInput,
  AcquisitionProviderRecognizer,
} from "./AcquisitionProviderRecognizer.js";

const providersByHostname: Readonly<Record<string, ProviderKey>> = {
  "candidat.francetravail.fr": "FRANCE_TRAVAIL",
  "jooble.org": "JOOBLE",
  "cadremploi.fr": "CADREMPLOI",
  "lhh.com": "LHH",
};

export class HostnameAcquisitionProviderRecognizer implements AcquisitionProviderRecognizer {
  recognize(input: AcquisitionProviderRecognitionInput): ProviderKey | undefined {
    if (isKellyWorkdaySource(input.sourceName, input.sourceUrl)) return "KELLY_WORKDAY";
    if (isPersonioSource(input.sourceName, input.sourceUrl)) return "PERSONIO";
    try {
      const hostname = new URL(input.sourceUrl).hostname.toLocaleLowerCase();
      const sourceName = input.sourceName.toLocaleLowerCase();
      if (hostname === "jobsearch.alstom.com") return sourceName === hostname ? "ALSTOM" : undefined;
      if (hostname === "indeed.com" || hostname.endsWith(".indeed.com")) {
        return sourceName === "indeed.com" ? "INDEED" : undefined;
      }
      if (hostname === "linkedin.com" || hostname.endsWith(".linkedin.com")) {
        return sourceName === "linkedin.com" ? "LINKEDIN" : undefined;
      }
      if (hostname === "jooble.org" || hostname.endsWith(".jooble.org")) {
        return sourceName === "jooble.org" ? "JOOBLE" : undefined;
      }
      if (hostname === "cadremploi.fr" || hostname === "www.cadremploi.fr" || hostname.endsWith(".cadremploi.fr")) {
        return sourceName === "cadremploi.fr" ? "CADREMPLOI" : undefined;
      }
      if (hostname === "lhh.com" || hostname.endsWith(".lhh.com")) return sourceName === "lhh.com" ? "LHH" : undefined;
      if (/^(?:www\.)?hellowork\.com$/u.test(hostname)) return sourceName === "hellowork.com" ? "HELLOWORK" : undefined;
      if (/^(?:[a-z]{2}\.|www\.)?talent\.com$/u.test(hostname)) return sourceName === "talent.com" ? "TALENT" : undefined;
      if (/^(?:www\.)?adecco\.com$/u.test(hostname)) return sourceName === "adecco.com" ? "ADECCO" : undefined;
      if (/^(?:www\.)?manpower\.com$/u.test(hostname)) return sourceName === "manpower.com" ? "MANPOWER" : undefined;
      if (/^(?:www\.)?randstad\.fr$/u.test(hostname)) return sourceName === "randstad.fr" ? "RANDSTAD" : undefined;
      if (/^(?:www\.)?synergie\.fr$/u.test(hostname)) return sourceName === "synergie.fr" ? "SYNERGIE" : undefined;
      if (/^(?:www\.)?crit-job\.com$/u.test(hostname)) return sourceName === "crit-job.com" ? "CRIT" : undefined;
      if (/^(?:www\.)?actualgroup\.com$/u.test(hostname)) return sourceName === "actualgroup.com" ? "ACTUAL" : undefined;
      if (/^(?:www\.)?startpeople\.fr$/u.test(hostname)) return sourceName === "startpeople.fr" ? "START_PEOPLE" : undefined;
      if (hostname === "mon-espace.proman-emploi.fr") return sourceName === hostname ? "PROMAN" : undefined;
      if (/^(?:www\.)?apec\.fr$/u.test(hostname)) return sourceName === "apec.fr" ? "APEC" : undefined;
      if (/^(?:fr\.|www\.)?gigroup\.com$/u.test(hostname)) return sourceName === "gigroup.com" ? "GI_GROUP" : undefined;
      if (hostname !== sourceName) return undefined;
      return providersByHostname[hostname];
    } catch {
      return undefined;
    }
  }
}
