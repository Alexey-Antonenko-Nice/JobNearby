import { VacancyCleanupError, type VacancyCleanup } from "../../domain/user/VacancyCleanup.js";
import { humanOrganizationRoles, type HumanOrganizationRole } from "../../domain/organizations/VacancyOrganizationRoleDecision.js";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

import type { BrowserCapturePayload } from "../../application/acquisition/BrowserCapturePayload.js";
import type { CaptureAndProcessBrowserVacancyResult } from "../../application/acquisition/captureAndProcessBrowserVacancy.js";
import type { VacancyReviewWorkflow } from "../../application/user/createVacancyReviewWorkflow.js";
import type { RecordUserVacancyInteractionInput } from "../../application/user/recordUserVacancyInteraction.js";

export const BROWSER_CAPTURE_PATH = "/acquisition/browser";
export const MAX_BROWSER_REQUEST_BYTES = 8 * 1024 * 1024;

export interface BrowserCaptureServerDependencies {
  readonly vacancyCleanup?: VacancyCleanup;
  readonly decideEmployerIdentity?: VacancyReviewWorkflow["decideEmployerIdentity"];
  readonly searchEmployerIdentities?: VacancyReviewWorkflow["searchEmployerIdentities"];
  readonly decideVacancyOrganizationRole?: VacancyReviewWorkflow["decideVacancyOrganizationRole"];
  readonly captureAndProcessBrowserVacancy: (
    payload: BrowserCapturePayload,
  ) => Promise<CaptureAndProcessBrowserVacancyResult>;
  readonly getVacancyReview?: VacancyReviewWorkflow["getVacancyReview"];
  readonly getVacancyInbox?: VacancyReviewWorkflow["getVacancyInbox"];
  readonly decideEmployerReview?: VacancyReviewWorkflow["decideEmployerReview"];
  readonly decideEmployerMemoryReview?: VacancyReviewWorkflow["decideEmployerMemoryReview"];
  readonly confirmVacancyRecruitingAgency?: VacancyReviewWorkflow["confirmVacancyRecruitingAgency"];
  readonly confirmVacancyEmployer?: VacancyReviewWorkflow["confirmVacancyEmployer"];
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
        const archived = new URL(request.url ?? "/", "http://localhost").searchParams.get("archived");
        if (archived !== null && archived !== "true" && archived !== "false") throw new InvalidRequestError("Invalid archive filter.");
        sendJson(response, 200, { vacancies: await dependencies.getVacancyInbox({ ...(limit === undefined ? {} : { limit }), ...(archived === null ? {} : { archived: archived === "true" }) }) });
        return;
      }
      if (request.method === "POST" && path === BROWSER_CAPTURE_PATH) {
        operation = "capture";
        const payload = parsePayload(await readJsonBody(request, "Browser capture"));
        const result = await dependencies.captureAndProcessBrowserVacancy(payload);
        sendJson(response, 201, captureResponseDto(result));
        return;
      }
      const cleanupMatch = /^\/vacancies\/([^/]+)\/(cleanup|archive|deletion-preview|deletion)$/u.exec(path);
      if (cleanupMatch && dependencies.vacancyCleanup) {
        operation = "review";
        const id = decodePathId(cleanupMatch[1]!);
        const service = dependencies.vacancyCleanup;
        const action = cleanupMatch[2];
        if (request.method === "GET" && action === "cleanup") { sendJson(response, 200, { cleanup: service.state(id) }); return; }
        if (request.method === "GET" && action === "deletion-preview") {
          const source = new URL(request.url ?? "/", "http://localhost").searchParams.get("observationId");
          sendJson(response, 200, { preview: service.preview(id, source ?? undefined) }); return;
        }
        if (request.method === "POST" && (action === "archive" || action === "deletion")) {
          const body = await readJsonBody(request, "Vacancy cleanup");
          if (!isRecord(body) || typeof body.token !== "string" || !/^[a-f0-9]{64}$/u.test(body.token)) throw new InvalidRequestError("A current cleanup token is required.");
          if (action === "archive") {
            if (typeof body.archived !== "boolean" || Object.keys(body).some(k => !["token", "archived"].includes(k))) throw new InvalidRequestError("Invalid archive request.");
            sendJson(response, 200, { cleanup: service.setArchived(id, body.archived, body.token) }); return;
          }
          if (typeof body.confirmation !== "string" || typeof body.acknowledgeApplicationHistory !== "boolean" || (body.observationId !== undefined && (typeof body.observationId !== "string" || !body.observationId.trim())) || Object.keys(body).some(k => !["token", "confirmation", "acknowledgeApplicationHistory", "observationId"].includes(k))) throw new InvalidRequestError("Invalid deletion request.");
          sendJson(response, 200, await service.delete({ canonicalVacancyId: id, token: body.token, confirmation: body.confirmation, acknowledgeApplicationHistory: body.acknowledgeApplicationHistory, ...(typeof body.observationId === "string" ? { observationId: body.observationId } : {}) })); return;
        }
      }
      const reviewMatch = /^\/vacancies\/([^/]+)\/review$/u.exec(path);
      if (request.method === "GET" && reviewMatch !== null && dependencies.getVacancyReview !== undefined) {
        operation = "review";
        const review = await dependencies.getVacancyReview(decodePathId(reviewMatch[1]!));
        sendJson(response, 200, { review });
        return;
      }
      const employerReviewMatch = /^\/vacancies\/([^/]+)\/employer-review$/u.exec(path);
      if (request.method === "POST" && employerReviewMatch !== null && dependencies.decideEmployerReview !== undefined) {
        operation = "review";
        const body = await readJsonBody(request, "Employer review");
        if (!isRecord(body) || (body.decision !== "CONFIRM" && body.decision !== "REJECT")) throw new InvalidRequestError("Employer review payload is invalid.");
        const canonicalVacancyId = decodePathId(employerReviewMatch[1]!);
        if (body.type === "NAMED_CLIENT" && typeof body.candidateId === "string" && body.candidateId.trim() && Object.keys(body).every((key) => ["type", "candidateId", "decision"].includes(key))) {
          sendJson(response, 200, { review: await dependencies.decideEmployerReview({ canonicalVacancyId, type: body.type, candidateId: body.candidateId, decision: body.decision }) });
        } else if (body.type === "CONFIRMED_MEMORY" && typeof body.employerClusterId === "string" && body.employerClusterId.trim() && Object.keys(body).every((key) => ["type", "employerClusterId", "decision"].includes(key))) {
          sendJson(response, 200, { review: await dependencies.decideEmployerReview({ canonicalVacancyId, type: body.type, employerClusterId: body.employerClusterId, decision: body.decision }) });
        } else if (body.type === "ALIAS_SELECTION" && typeof body.candidateId === "string" && body.candidateId.trim() && typeof body.employerClusterId === "string" && body.employerClusterId.trim() && Object.keys(body).every((key) => ["type", "candidateId", "employerClusterId", "decision"].includes(key))) {
          sendJson(response, 200, { review: await dependencies.decideEmployerReview({ canonicalVacancyId, type: body.type, candidateId: body.candidateId, employerClusterId: body.employerClusterId, decision: body.decision }) });
        } else throw new InvalidRequestError("Employer review payload is invalid.");
        return;
      }
      const memoryReviewMatch = /^\/vacancies\/([^/]+)\/employer-memory-review$/u.exec(path);
      if (request.method === "POST" && memoryReviewMatch !== null && dependencies.decideEmployerMemoryReview !== undefined) {
        operation = "review";
        const body = await readJsonBody(request, "Employer memory review");
        if (!isRecord(body) || typeof body.employerClusterId !== "string" || !body.employerClusterId.trim() || !["CONFIRM", "REJECT"].includes(String(body.decision)) || Object.keys(body).some((key) => !["employerClusterId", "decision"].includes(key))) throw new InvalidRequestError("Employer memory review payload is invalid.");
        sendJson(response, 200, { review: await dependencies.decideEmployerMemoryReview({ canonicalVacancyId: decodePathId(memoryReviewMatch[1]!), employerClusterId: body.employerClusterId, decision: body.decision as "CONFIRM" | "REJECT" }) });
        return;
      }
      const identitySearchMatch = /^\/vacancies\/([^/]+)\/employer-identity-search$/u.exec(path);
      if (request.method === "GET" && identitySearchMatch && dependencies.searchEmployerIdentities) {
        operation = "review";
        const query = new URL(request.url ?? "/", "http://localhost").searchParams.get("q") ?? "";
        if (query.trim().length < 2 || query.length > 200) throw new InvalidRequestError("Enter at least two characters to search employer identities.");
        sendJson(response, 200, { employerIdentitySearch: await dependencies.searchEmployerIdentities({ canonicalVacancyId: decodePathId(identitySearchMatch[1]!), query }) });
        return;
      }
      const identityMatch = /^\/vacancies\/([^/]+)\/employer-identity-decisions$/u.exec(path);
      if (request.method === "POST" && identityMatch && dependencies.decideEmployerIdentity) {
        operation = "review";
        const body = await readJsonBody(request, "Employer identity decision");
        if (!isRecord(body) || typeof body.requestId !== "string" || !body.requestId.trim() || body.requestId.length > 200 || typeof body.employerClusterId !== "string" || !body.employerClusterId.trim() || typeof body.candidateToken !== "string" || !/^[a-f0-9]{64}$/u.test(body.candidateToken) || !["USE_EXISTING","KEEP_SEPARATE"].includes(String(body.decision)) || Object.keys(body).some(key => !["requestId","employerClusterId","candidateToken","decision"].includes(key))) throw new InvalidRequestError("Employer identity decision payload is invalid.");
        sendJson(response, 201, {review: await dependencies.decideEmployerIdentity({canonicalVacancyId:decodePathId(identityMatch[1]!),requestId:body.requestId,employerClusterId:body.employerClusterId,candidateToken:body.candidateToken,decision:body.decision as "USE_EXISTING"|"KEEP_SEPARATE"})});
        return;
      }
      const organizationRoleMatch = /^\/vacancies\/([^/]+)\/organization-role-decisions$/u.exec(path);
      if (request.method === "POST" && organizationRoleMatch && dependencies.decideVacancyOrganizationRole) {
        operation = "review";
        const body = await readJsonBody(request, "Organization role decision");
        if (!isRecord(body) || typeof body.requestId !== "string" || !body.requestId.trim() || body.requestId.length > 200 || typeof body.identityKey !== "string" || !body.identityKey.trim() || typeof body.candidateToken !== "string" || !/^[a-f0-9]{64}$/u.test(body.candidateToken) || !humanOrganizationRoles.includes(body.role as HumanOrganizationRole) || typeof body.acknowledgeContradiction !== "boolean" || Object.keys(body).some(key => !["requestId","identityKey","candidateToken","role","acknowledgeContradiction"].includes(key))) throw new InvalidRequestError("Organization role decision payload is invalid.");
        sendJson(response, 201, { review: await dependencies.decideVacancyOrganizationRole({canonicalVacancyId:decodePathId(organizationRoleMatch[1]!),requestId:body.requestId,identityKey:body.identityKey,candidateToken:body.candidateToken,role:body.role as HumanOrganizationRole,acknowledgeContradiction:body.acknowledgeContradiction}) });
        return;
      }
      const agencyConfirmationMatch = /^\/vacancies\/([^/]+)\/recruiting-agency-confirmation$/u.exec(path);
      if (request.method === "POST" && agencyConfirmationMatch !== null && dependencies.confirmVacancyRecruitingAgency !== undefined) {
        operation = "review";
        const body = await readJsonBody(request, "Recruiting agency confirmation");
        if (!isRecord(body) || typeof body.candidateId !== "string" || !body.candidateId.trim() || Object.keys(body).some((key) => key !== "candidateId")) throw new InvalidRequestError("Recruiting agency candidate is required.");
        sendJson(response, 201, { review: await dependencies.confirmVacancyRecruitingAgency({ canonicalVacancyId: decodePathId(agencyConfirmationMatch[1]!), candidateId: body.candidateId }) });
        return;
      }
      const employerConfirmationMatch = /^\/vacancies\/([^/]+)\/employer-confirmation$/u.exec(path);
      if (request.method === "POST" && employerConfirmationMatch !== null && dependencies.confirmVacancyEmployer !== undefined) {
        operation = "review";
        const body = await readJsonBody(request, "Employer confirmation");
        if (!isRecord(body) || typeof body.candidateName !== "string") throw new InvalidRequestError("Employer candidate is required.");
        sendJson(response, 201, { review: await dependencies.confirmVacancyEmployer({ canonicalVacancyId: decodePathId(employerConfirmationMatch[1]!), candidateName: body.candidateName }) });
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
      const status = error instanceof VacancyCleanupError ? error.status : errorStatus(message, operation, error);
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
  for (const key of query.keys()) if (key !== "limit" && key !== "archived") throw new InvalidRequestError(`Unsupported query parameter "${key}".`);
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
  if (message.startsWith("Employer identity review is stale")) return 409;
  if (message.startsWith("Organization role review is stale") || message === "Organization role override requires confirmation." || message === "Organization role request ID was already used." || message === "Use the vacancy-specific organization role actions.") return 409;
  if (operation === "capture") {
    return message.startsWith("Browser capture could not be persisted:") ? 500 : 400;
  }
  if (message === "Recruiting agency candidate is no longer eligible for confirmation.") return 409;
  if (message === "Employer review candidate is no longer eligible.") return 409;
  if (message === "Employer memory candidate is no longer eligible for review."
    || message === "Employer candidate is no longer eligible for confirmation.") return 409;
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
