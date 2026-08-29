import type { ProviderKey } from "../../domain/acquisition/ProviderKey.js";
import type {
  AcquisitionProviderRecognitionInput,
  AcquisitionProviderRecognizer,
} from "./AcquisitionProviderRecognizer.js";

const providersByHostname: Readonly<Record<string, ProviderKey>> = {
  "candidat.francetravail.fr": "FRANCE_TRAVAIL",
};

export class HostnameAcquisitionProviderRecognizer implements AcquisitionProviderRecognizer {
  recognize(input: AcquisitionProviderRecognitionInput): ProviderKey | undefined {
    try {
      const hostname = new URL(input.sourceUrl).hostname.toLocaleLowerCase();
      const sourceName = input.sourceName.toLocaleLowerCase();
      if (hostname === "indeed.com" || hostname.endsWith(".indeed.com")) {
        return sourceName === "indeed.com" ? "INDEED" : undefined;
      }
      if (hostname !== sourceName) return undefined;
      return providersByHostname[hostname];
    } catch {
      return undefined;
    }
  }
}
