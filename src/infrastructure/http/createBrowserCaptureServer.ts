import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

import type { BrowserCapturePayload } from "../../application/acquisition/BrowserCapturePayload.js";
import type { CaptureAndProcessBrowserVacancyResult } from "../../application/acquisition/captureAndProcessBrowserVacancy.js";
import type { VacancyReviewWorkflow } from "../../application/user/createVacancyReviewWorkflow.js";
import type { RecordUserVacancyInteractionInput } from "../../application/user/recordUserVacancyInteraction.js";

export const BROWSER_CAPTURE_PATH = "/acquisition/browser";
export const MAX_BROWSER_REQUEST_BYTES = 8 * 1024 * 1024;

export interface BrowserCaptureServerDependencies {
  readonly captureAndProcessBrowserVacancy: (
    payload: BrowserCapturePayload,
  ) => Promise<CaptureAndProcessBrowserVacancyResult>;
  readonly getVacancyReview?: VacancyReviewWorkflow["getVacancyReview"];
  readonly getVacancyInbox?: VacancyReviewWorkflow["getVacancyInbox"];
  readonly recordVacancyReviewAction?: VacancyReviewWorkflow["recordVacancyReviewAction"];
}

export function createBrowserCaptureServer(
  dependencies: BrowserCaptureServerDependencies,
): Server {
  return createServer(async (request, response) => {
    setCorsHeaders(request, response);
    if (request.method === "OPTIONS") {
      response.writeHead(204).end();
      return;
    }
    let operation: "capture" | "review" | "interaction" | "route" = "route";
    try {
      const path = requestPath(request);
      if (request.method === "GET" && path === "/vacancies" && dependencies.getVacancyInbox !== undefined) {
        operation = "review";
        const limit = parseInboxLimit(request);
        sendJson(response, 200, { vacancies: await dependencies.getVacancyInbox(limit === undefined ? {} : { limit }) });
        return;
      }
      if (request.method === "POST" && path === BROWSER_CAPTURE_PATH) {
        operation = "capture";
        const payload = parsePayload(await readJsonBody(request, "Browser capture"));
        const result = await dependencies.captureAndProcessBrowserVacancy(payload);
        sendJson(response, 201, captureResponseDto(result));
        return;
      }
      const reviewMatch = /^\/vacancies\/([^/]+)\/review$/u.exec(path);
      if (request.method === "GET" && reviewMatch !== null && dependencies.getVacancyReview !== undefined) {
        operation = "review";
        const review = await dependencies.getVacancyReview(decodePathId(reviewMatch[1]!));
        sendJson(response, 200, { review });
        return;
      }
      const interactionMatch = /^\/vacancies\/([^/]+)\/interactions$/u.exec(path);
      if (request.method === "POST" && interactionMatch !== null && dependencies.recordVacancyReviewAction !== undefined) {
        operation = "interaction";
        const canonicalVacancyId = decodePathId(interactionMatch[1]!);
        const input = parseInteractionPayload(
          canonicalVacancyId,
          await readJsonBody(request, "Vacancy interaction"),
        );
        sendJson(response, 201, await dependencies.recordVacancyReviewAction(input));
        return;
      }
      sendJson(response, 404, { success: false, error: "Not found." });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Browser capture failed.";
      const status = errorStatus(message, operation, error);
      sendJson(response, status, { success: false, error: message });
    }
  });
}

function captureResponseDto(result: CaptureAndProcessBrowserVacancyResult): object {
  const capture = {
    observationId: result.capture.observationId,
    acquisitionId: result.capture.acquisitionId,
    observedAt: result.capture.observedAt.toISOString(),
  };
  if (result.processing.status === "FAILED") {
    return {
      success: true,
      capture,
      processing: { status: "FAILED", code: "PROCESSING_FAILED" },
    };
  }
  return { success: true, capture, processing: result.processing };
}

async function readJsonBody(request: IncomingMessage, label: string): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.byteLength;
    if (size > MAX_BROWSER_REQUEST_BYTES) {
      throw new InvalidRequestError(`${label} request exceeds the ${MAX_BROWSER_REQUEST_BYTES}-byte limit.`);
    }
    chunks.push(buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    throw new InvalidRequestError(`${label} request must contain valid JSON.`);
  }
}

function parseInteractionPayload(
  canonicalVacancyId: string,
  value: unknown,
): RecordUserVacancyInteractionInput {
  if (!isRecord(value)) throw new InvalidRequestError("Vacancy interaction payload must be an object.");
  const allowed = new Set(["type", "occurredAt", "metadata"]);
  const unsupported = Object.keys(value).find((key) => !allowed.has(key));
  if (unsupported !== undefined) {
    throw new InvalidRequestError(`Vacancy interaction payload contains unsupported field "${unsupported}".`);
  }
  const types = [
    "REVIEWED", "INTERESTED", "APPLIED", "CONTACTED", "INTERVIEW",
    "OFFER", "REJECTED", "WITHDRAWN", "CLOSED",
  ] as const;
  if (value.type === "NEW") throw new InvalidRequestError("NEW is derived and cannot be recorded as an interaction event.");
  if (typeof value.type !== "string" || !types.includes(value.type as typeof types[number])) {
    throw new InvalidRequestError("Vacancy interaction type is invalid.");
  }
  let occurredAt: Date | undefined;
  if (value.occurredAt !== undefined) {
    if (typeof value.occurredAt !== "string") throw new InvalidRequestError("Vacancy interaction occurredAt must be an ISO date string.");
    occurredAt = new Date(value.occurredAt);
    if (Number.isNaN(occurredAt.getTime())) throw new InvalidRequestError("Vacancy interaction occurredAt must be a valid date.");
  }
  if (value.metadata !== undefined && !isRecord(value.metadata)) {
    throw new InvalidRequestError("Vacancy interaction metadata must be an object.");
  }
  return {
    canonicalVacancyId,
    type: value.type,
    ...(occurredAt === undefined ? {} : { occurredAt }),
    ...(value.metadata === undefined ? {} : { metadata: value.metadata }),
  } as RecordUserVacancyInteractionInput;
}

function requestPath(request: IncomingMessage): string {
  return new URL(request.url ?? "/", "http://127.0.0.1").pathname;
}

function parseInboxLimit(request: IncomingMessage): number | undefined {
  const query = new URL(request.url ?? "/", "http://127.0.0.1").searchParams;
  for (const key of query.keys()) if (key !== "limit") throw new InvalidRequestError(`Unsupported query parameter "${key}".`);
  const value = query.get("limit");
  if (value === null) return undefined;
  if (!/^\d+$/u.test(value)) throw new InvalidRequestError("Inbox limit must be an integer.");
  return Number(value);
}

function decodePathId(value: string): string {
  try {
    const decoded = decodeURIComponent(value);
    if (decoded.trim().length === 0 || decoded.includes("/")) throw new Error();
    return decoded;
  } catch {
    throw new InvalidRequestError("Canonical vacancy ID in the request path is invalid.");
  }
}

function errorStatus(
  message: string,
  operation: "capture" | "review" | "interaction" | "route",
  error: unknown,
): number {
  if (/^CanonicalVacancy ".+" does not exist\.$/u.test(message)) return 404;
  if (operation === "capture") {
    return message.startsWith("Browser capture could not be persisted:") ? 500 : 400;
  }
  if (operation === "route") return 400;
  if (error instanceof InvalidRequestError) return 400;
  if (message.startsWith("Inbox limit must be")) return 400;
  if (operation === "interaction" && (
    message.startsWith("Metadata field") ||
    message.startsWith("Interaction metadata") ||
    message.startsWith("Interaction type")
  )) return 400;
  if (
    message.includes("references missing SourceObservation") ||
    message.includes("integrity error")
  ) return 500;
  return 500;
}

class InvalidRequestError extends Error {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parsePayload(value: unknown): BrowserCapturePayload {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Browser capture payload must be an object.");
  }
  const payload = value as Record<string, unknown>;
  if (typeof payload.pageUrl !== "string" || typeof payload.pageTitle !== "string" ||
      typeof payload.visibleText !== "string" ||
      (typeof payload.capturedAt !== "string" && !(payload.capturedAt instanceof Date))) {
    throw new Error("Browser capture payload has invalid required fields.");
  }
  if (payload.html !== undefined && typeof payload.html !== "string") {
    throw new Error("Browser capture HTML must be a string.");
  }
  if (payload.browserMetadata !== undefined &&
      (typeof payload.browserMetadata !== "object" || payload.browserMetadata === null ||
       Array.isArray(payload.browserMetadata))) {
    throw new Error("Browser metadata must be an object.");
  }
  return {
    pageUrl: payload.pageUrl,
    pageTitle: payload.pageTitle,
    visibleText: payload.visibleText,
    capturedAt: payload.capturedAt,
    ...(typeof payload.html === "string" ? { html: payload.html } : {}),
    ...(payload.browserMetadata !== undefined
      ? { browserMetadata: payload.browserMetadata as Readonly<Record<string, unknown>> }
      : {}),
  };
}

function setCorsHeaders(request: IncomingMessage, response: ServerResponse): void {
  const origin = request.headers.origin;
  if (origin !== undefined && (
    /^(chrome|moz)-extension:\/\//u.test(origin) ||
    origin === "http://127.0.0.1:5173"
  )) {
    response.setHeader("Access-Control-Allow-Origin", origin);
    response.setHeader("Vary", "Origin");
  }
  response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}
