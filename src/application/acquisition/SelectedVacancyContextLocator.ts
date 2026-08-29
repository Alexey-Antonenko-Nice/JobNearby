import type { AcquisitionContext } from "../../domain/acquisition/AcquisitionContext.js";
import type { ProviderKey } from "../../domain/acquisition/ProviderKey.js";

export interface SelectedVacancyContextLocatorInput {
  readonly providerKey: ProviderKey;
  readonly sourceUrl: string;
  readonly externalId?: string;
  readonly html: string;
}

export interface SelectedVacancyContextLocator {
  locate(input: SelectedVacancyContextLocatorInput): AcquisitionContext | undefined;
}
