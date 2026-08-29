import type { ProviderKey } from "../../domain/acquisition/ProviderKey.js";

export interface AcquisitionProviderRecognitionInput {
  readonly sourceName: string;
  readonly sourceUrl: string;
}

export interface AcquisitionProviderRecognizer {
  recognize(input: AcquisitionProviderRecognitionInput): ProviderKey | undefined;
}
