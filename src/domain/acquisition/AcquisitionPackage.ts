import {
  createAcquisitionContext,
  type AcquisitionContext,
} from "./AcquisitionContext.js";

export type AcquisitionId = string;

export type AcquisitionSourceType =
  | "BROWSER"
  | "JOB_BOARD"
  | "EMPLOYER_WEBSITE"
  | "PUBLIC_API"
  | "EMAIL"
  | "MANUAL"
  | "IMPORT"
  | "OTHER";

export interface AcquisitionSource {
  readonly sourceType: AcquisitionSourceType;
  readonly sourceName: string;
}

export interface AcquisitionContent {
  readonly text?: string;
  readonly html?: string;
  readonly structuredPayload?: unknown;
}

export interface AcquisitionStructuredFields {
  readonly title?: string;
  readonly displayedCompanyName?: string;
  readonly locationText?: string;
  readonly salaryText?: string;
  readonly contractText?: string;
  readonly contactText?: string;
  readonly publishedAt?: Date;
}

export interface AcquisitionPackage {
  readonly acquisitionId: AcquisitionId;
  readonly acquiredAt: Date;
  readonly source: AcquisitionSource;
  readonly sourceUrl?: string;
  readonly externalId?: string;
  readonly pageTitle?: string;
  readonly content: AcquisitionContent;
  readonly structuredFields?: AcquisitionStructuredFields;
  readonly contexts?: readonly AcquisitionContext[];
  readonly metadata: Readonly<Record<string, unknown>>;
}

const sourceTypes: readonly AcquisitionSourceType[] = [
  "BROWSER",
  "JOB_BOARD",
  "EMPLOYER_WEBSITE",
  "PUBLIC_API",
  "EMAIL",
  "MANUAL",
  "IMPORT",
  "OTHER",
];

export function createAcquisitionPackage(
  input: AcquisitionPackage,
): AcquisitionPackage {
  const acquisitionId = requireText(input.acquisitionId, "Acquisition ID");
  const sourceName = requireText(input.source.sourceName, "Acquisition source name");
  if (!sourceTypes.includes(input.source.sourceType)) {
    throw new Error("Acquisition source type is invalid.");
  }
  const acquiredAt = requireValidDate(input.acquiredAt, "Acquisition date");
  const text = optionalRawContent(input.content.text);
  const html = optionalRawContent(input.content.html);
  if (text === undefined && html === undefined && input.content.structuredPayload === undefined) {
    throw new Error("Acquisition content requires text, HTML, or a structured payload.");
  }

  const content: AcquisitionContent = {
    ...(text !== undefined ? { text } : {}),
    ...(html !== undefined ? { html } : {}),
    ...(input.content.structuredPayload !== undefined
      ? { structuredPayload: structuredClone(input.content.structuredPayload) }
      : {}),
  };
  const structuredFields = copyStructuredFields(input.structuredFields);
  const contexts = input.contexts?.map(createAcquisitionContext);

  return {
    acquisitionId,
    acquiredAt,
    source: { sourceType: input.source.sourceType, sourceName },
    ...(optionalText(input.sourceUrl) !== undefined ? { sourceUrl: input.sourceUrl!.trim() } : {}),
    ...(optionalText(input.externalId) !== undefined ? { externalId: input.externalId!.trim() } : {}),
    ...(optionalText(input.pageTitle) !== undefined ? { pageTitle: input.pageTitle!.trim() } : {}),
    content,
    ...(structuredFields !== undefined ? { structuredFields } : {}),
    ...(contexts !== undefined ? { contexts } : {}),
    metadata: structuredClone(input.metadata),
  };
}

function copyStructuredFields(
  fields: AcquisitionStructuredFields | undefined,
): AcquisitionStructuredFields | undefined {
  if (fields === undefined) return undefined;
  const publishedAt = fields.publishedAt === undefined
    ? undefined
    : requireValidDate(fields.publishedAt, "Publication date");
  return {
    ...copyOptionalFields(fields, [
      "title", "displayedCompanyName", "locationText", "salaryText",
      "contractText", "contactText",
    ]),
    ...(publishedAt !== undefined ? { publishedAt } : {}),
  };
}

function copyOptionalFields<T extends object, K extends keyof T>(
  value: T,
  keys: readonly K[],
): Partial<Pick<T, K>> {
  const result: Partial<Pick<T, K>> = {};
  for (const key of keys) {
    const normalized = optionalText(value[key]);
    if (normalized !== undefined) {
      (result as Record<K, string>)[key] = normalized;
    }
  }
  return result;
}

function optionalText(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new Error("Acquisition text values must be strings.");
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

function optionalRawContent(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new Error("Acquisition content must be a string.");
  return value.trim().length === 0 ? undefined : value;
}

function requireText(value: unknown, label: string): string {
  const text = optionalText(value);
  if (text === undefined) throw new Error(`${label} is required.`);
  return text;
}

function requireValidDate(value: unknown, label: string): Date {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new Error(`${label} must be a valid Date.`);
  }
  return new Date(value.getTime());
}
