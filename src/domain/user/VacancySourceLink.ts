export interface VacancySourceLink {
  readonly sourceObservationId: string;
  readonly provider: string;
  readonly url: string;
  readonly observedAt: Date;
}