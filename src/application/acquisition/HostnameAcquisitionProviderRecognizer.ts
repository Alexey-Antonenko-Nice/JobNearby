import type { ProviderKey } from "../../domain/acquisition/ProviderKey.js";
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
    try {
      const hostname = new URL(input.sourceUrl).hostname.toLocaleLowerCase();
      const sourceName = input.sourceName.toLocaleLowerCase();
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
      if (hostname !== sourceName) return undefined;
      return providersByHostname[hostname];
    } catch {
      return undefined;
    }
  }
}
