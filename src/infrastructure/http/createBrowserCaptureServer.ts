import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

import type { BrowserCapturePayload } from "../../application/acquisition/BrowserCapturePayload.js";
import type { CaptureAndProcessBrowserVacancyResult } from "../../application/acquisition/captureAndProcessBrowserVacancy.js";

export const BROWSER_CAPTURE_PATH = "/acquisition/browser";
export const MAX_BROWSER_REQUEST_BYTES = 8 * 1024 * 1024;

export interface BrowserCaptureServerDependencies {
  readonly captureAndProcessBrowserVacancy: (
    payload: BrowserCapturePayload,
  ) => Promise<CaptureAndProcessBrowserVacancyResult>;
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
    if (request.method !== "POST" || request.url !== BROWSER_CAPTURE_PATH) {
      sendJson(response, 404, { success: false, error: "Not found." });
      return;
    }

    try {
      const payload = parsePayload(await readJsonBody(request));
      const result = await dependencies.captureAndProcessBrowserVacancy(payload);
      sendJson(response, 201, captureResponseDto(result));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Browser capture failed.";
      const status = message.startsWith("Browser capture could not be persisted:") ? 500 : 400;
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

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.byteLength;
    if (size > MAX_BROWSER_REQUEST_BYTES) {
      throw new Error(`Browser capture request exceeds the ${MAX_BROWSER_REQUEST_BYTES}-byte limit.`);
    }
    chunks.push(buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    throw new Error("Browser capture request must contain valid JSON.");
  }
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
  if (origin !== undefined && /^(chrome|moz)-extension:\/\//u.test(origin)) {
    response.setHeader("Access-Control-Allow-Origin", origin);
    response.setHeader("Vary", "Origin");
  }
  response.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}
