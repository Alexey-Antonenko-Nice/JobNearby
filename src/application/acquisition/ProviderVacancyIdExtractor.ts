export interface ProviderVacancyIdExtractionInput {
  readonly sourceName: string;
  readonly sourceUrl: string;
}

export interface ProviderVacancyIdExtractor {
  extract(input: ProviderVacancyIdExtractionInput): string | undefined;
}
