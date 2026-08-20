export type SourceType =
  | "JOB_BOARD"
  | "RECRUITMENT_AGENCY"
  | "EMPLOYER_WEBSITE"
  | "PUBLIC_API"
  | "PUBLIC_REGISTER"
  | "EMAIL"
  | "MANUAL"
  | "BROWSER_CAPTURE"
  | "OTHER";

export interface SourceReference {
  sourceType: SourceType;
  sourceName: string;

  sourceUrl?: string;
  externalId?: string;

  providerMetadata?: Readonly<Record<string, unknown>>;
}
