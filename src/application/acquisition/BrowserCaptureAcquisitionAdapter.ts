import {
  createAcquisitionPackage,
  type AcquisitionId,
  type AcquisitionPackage,
} from "../../domain/acquisition/AcquisitionPackage.js";
import type { BrowserCapturePayload } from "./BrowserCapturePayload.js";
import { LiteralJsonLdDocumentExtractor } from "./LiteralJsonLdDocumentExtractor.js";
import { SchemaOrgJobPostingExtractor } from "./SchemaOrgJobPostingExtractor.js";
import { SchemaOrgJobPostingProjector } from "./SchemaOrgJobPostingProjector.js";

export const MAX_BROWSER_VISIBLE_TEXT_BYTES = 2 * 1024 * 1024;
export const MAX_BROWSER_HTML_BYTES = 5 * 1024 * 1024;

export class BrowserCaptureAcquisitionAdapter {
  private readonly jsonLdExtractor = new LiteralJsonLdDocumentExtractor();
  private readonly jobPostingExtractor = new SchemaOrgJobPostingExtractor();
  private readonly jobPostingProjector = new SchemaOrgJobPostingProjector();

  toAcquisitionPackage(
    payload: BrowserCapturePayload,
    acquisitionId: AcquisitionId,
  ): AcquisitionPackage {
    const pageUrl = validatePageUrl(payload.pageUrl);
    const visibleText = validateContent(
      payload.visibleText,
      "Visible page text",
      MAX_BROWSER_VISIBLE_TEXT_BYTES,
    );
    const html = payload.html === undefined
      ? undefined
      : validateContent(payload.html, "Page HTML", MAX_BROWSER_HTML_BYTES);
    const acquiredAt = parseCapturedAt(payload.capturedAt);
    const jobPostings = html === undefined
      ? []
      : this.jobPostingExtractor.extract(this.jsonLdExtractor.extract(html));
    const structuredFields = jobPostings.length === 1
      ? this.jobPostingProjector.project(jobPostings[0]!)
      : undefined;

    return createAcquisitionPackage({
      acquisitionId,
      acquiredAt,
      source: {
        sourceType: "BROWSER",
        sourceName: sourceNameFromUrl(pageUrl),
      },
      sourceUrl: pageUrl,
      ...(payload.pageTitle.trim().length > 0 ? { pageTitle: payload.pageTitle.trim() } : {}),
      content: {
        text: normalizeVisibleText(visibleText),
        ...(html !== undefined ? { html } : {}),
        ...(jobPostings.length > 0
          ? {
              structuredPayload: {
                format: "SCHEMA_ORG_JOB_POSTING_JSON_LD",
                jobPostings,
              },
            }
          : {}),
      },
      ...(structuredFields !== undefined ? { structuredFields } : {}),
      metadata: payload.browserMetadata === undefined
        ? {}
        : structuredClone(payload.browserMetadata),
    });
  }
}

function validatePageUrl(value: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error("Browser page URL is required.");
  }
  try {
    new URL(value);
    return value;
  } catch {
    throw new Error("Browser page URL must be a valid URL.");
  }
}

function sourceNameFromUrl(value: string): string {
  try {
    const hostname = new URL(value).hostname.toLocaleLowerCase();
    if (hostname.length === 0) return "browser";
    const withoutWww = hostname.startsWith("www.") ? hostname.slice(4) : hostname;
    const labels = withoutWww.split(".");
    return labels.length > 2 && /^[a-z]{2}(?:-[a-z]{2})?$/u.test(labels[0] ?? "")
      ? labels.slice(1).join(".")
      : withoutWww;
  } catch {
    return "browser";
  }
}

function parseCapturedAt(value: Date | string): Date {
  const parsed = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (!Number.isFinite(parsed.getTime())) {
    throw new Error("Browser capture timestamp must be a valid date.");
  }
  return parsed;
}

function validateContent(value: string, label: string, maximumBytes: number): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} is required.`);
  }
  if (Buffer.byteLength(value, "utf8") > maximumBytes) {
    throw new Error(`${label} exceeds the ${maximumBytes}-byte limit.`);
  }
  return value;
}

function normalizeVisibleText(value: string): string {
  return value.replace(/\r\n?/gu, "\n").trim();
}
