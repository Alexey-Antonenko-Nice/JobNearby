import { ContactError, validateContactId } from "../../domain/user/Contact.js";
import { ApplicationDocumentError, MAX_DOCUMENT_BYTES, applicationDocumentKinds, type ImportApplicationDocument } from "../../domain/user/ApplicationDocument.js";
import { VacancyCrmError, validatePriority, validateProcessState } from "../../domain/user/VacancyCrm.js";
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
  readonly getDailyWorkQueue?: (timeZone:string)=>import("../../application/user/deriveWorkQueue.js").DailyWorkQueue;
  readonly getContacts?: VacancyReviewWorkflow["getContacts"];
  readonly contactCommand?: VacancyReviewWorkflow["contactCommand"];
  readonly getApplicationDocuments?: VacancyReviewWorkflow["getApplicationDocuments"];
  readonly importLibraryDocument?: VacancyReviewWorkflow["importLibraryDocument"];
  readonly renameApplicationDocument?: VacancyReviewWorkflow["renameApplicationDocument"];
  readonly archiveApplicationDocument?: VacancyReviewWorkflow["archiveApplicationDocument"];
  readonly restoreApplicationDocument?: VacancyReviewWorkflow["restoreApplicationDocument"];

  readonly importApplicationDocument?: VacancyReviewWorkflow["importApplicationDocument"];
  readonly associateVacancyDocument?: VacancyReviewWorkflow["associateVacancyDocument"];
  readonly getApplicationDocumentContent?: VacancyReviewWorkflow["getApplicationDocumentContent"];
  readonly createVacancyNextAction?: VacancyReviewWorkflow["createVacancyNextAction"];
  readonly completeVacancyNextAction?: VacancyReviewWorkflow["completeVacancyNextAction"];
  readonly cancelVacancyNextAction?: VacancyReviewWorkflow["cancelVacancyNextAction"];
  readonly rescheduleVacancyNextAction?: VacancyReviewWorkflow["rescheduleVacancyNextAction"];
  readonly setVacancyActionReminder?: VacancyReviewWorkflow["setVacancyActionReminder"];
  readonly dismissVacancyActionReminder?: VacancyReviewWorkflow["dismissVacancyActionReminder"];
  readonly setVacancyPriority?: VacancyReviewWorkflow["setVacancyPriority"];
  readonly addVacancyNote?: VacancyReviewWorkflow["addVacancyNote"];
  readonly setVacancyProcessState?: VacancyReviewWorkflow["setVacancyProcessState"];
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
      if(path==="/work-queue" && request.method==="GET" && dependencies.getDailyWorkQueue){
        const zone=new URL(request.url??"/","http://localhost").searchParams.get("timeZone")??"UTC";
        try { new Intl.DateTimeFormat("en-US",{timeZone:zone}); } catch { throw new InvalidRequestError("Invalid timezone."); }
        sendJson(response,200,dependencies.getDailyWorkQueue(zone));return;
      }
      if(path==="/contacts" && request.method==="GET" && dependencies.getContacts){operation="review";sendJson(response,200,{contacts:dependencies.getContacts()});return;}
      if(path==="/contacts/commands" && request.method==="POST" && dependencies.contactCommand){
        operation="review";
        if(!/^application\/json(?:\s*;|$)/iu.test(request.headers["content-type"]??"")) throw new InvalidRequestError("Contact commands require JSON.");
        sendJson(response,200,dependencies.contactCommand(await readJsonBody(request,"Contact")));return;
      }
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
      if(request.method==="GET" && path==="/documents" && dependencies.getApplicationDocuments) {
        operation="review";sendJson(response,200,{library:dependencies.getApplicationDocuments()});return;
      }
      const lifecycle=/^\/documents\/([^/]+)\/(rename|archive|restore)$/u.exec(path);
      if(request.method==="POST" && (path==="/documents/import" || lifecycle)) {
        operation="review";
        if(!/^application\/json(?:\s*;|$)/iu.test(request.headers["content-type"]??"")) throw new InvalidRequestError("Document commands require JSON.");
        const body=await readJsonBody(request,"Document");
        if(path==="/documents/import" && dependencies.importLibraryDocument) {
          sendJson(response,200,{library:dependencies.importLibraryDocument(parseDocumentImport(body))});return;
        }
        if(lifecycle) {
          if(!isRecord(body) || typeof body.requestId!=="string" || Object.keys(body).some(k=>!["requestId",...(lifecycle[2]==="rename"?["name"]:[])].includes(k))) throw new InvalidRequestError("Invalid document lifecycle payload.");
          const target={documentId:decodePathId(lifecycle[1]!),requestId:body.requestId};
          if(lifecycle[2]==="rename" && dependencies.renameApplicationDocument) {
            if(typeof body.name!=="string") throw new InvalidRequestError("Document name required.");
            sendJson(response,200,{library:dependencies.renameApplicationDocument({...target,name:body.name})});return;
          }
          if(lifecycle[2]==="archive" && dependencies.archiveApplicationDocument) {sendJson(response,200,{library:dependencies.archiveApplicationDocument(target)});return;}
          if(lifecycle[2]==="restore" && dependencies.restoreApplicationDocument) {sendJson(response,200,{library:dependencies.restoreApplicationDocument(target)});return;}
        }
        throw new ApplicationDocumentError("Document library unavailable.",500);
      }
      const contentMatch=/^\/documents\/versions\/([^/]+)\/content$/u.exec(path);
      if(request.method==="GET" && contentMatch && dependencies.getApplicationDocumentContent) {
        operation="review";
        const file=dependencies.getApplicationDocumentContent(decodePathId(contentMatch[1]!));
        response.writeHead(200,{"Content-Type":"application/octet-stream","X-Content-Type-Options":"nosniff",
          "Cache-Control":"no-store","Content-Security-Policy":"sandbox",
          "Content-Disposition":"attachment; filename=\"document\"; filename*=UTF-8''"+encodeURIComponent(file.originalFileName).replace(/['()*]/gu,c=>"%"+c.charCodeAt(0).toString(16))});
        response.end(Buffer.from(file.bytes));return;
      }
      const documentMatch=/^\/vacancies\/([^/]+)\/documents\/(import|associations)$/u.exec(path);
      if(request.method==="POST" && documentMatch) {
        operation="review";
        if(!/^application\/json(?:\s*;|$)/iu.test(request.headers["content-type"]??"")) throw new InvalidRequestError("Document commands require JSON.");
        const canonicalVacancyId=decodePathId(documentMatch[1]!);
        const body=await readJsonBody(request,"Document");
        if(!isRecord(body) || typeof body.requestId!=="string") throw new InvalidRequestError("Document request ID required.");
        if(documentMatch[2]==="associations" && dependencies.associateVacancyDocument) {
          if(typeof body.versionId!=="string" || Object.keys(body).some(k=>!["versionId","requestId"].includes(k))) throw new InvalidRequestError("Invalid document association.");
          sendJson(response,200,{review:await dependencies.associateVacancyDocument({canonicalVacancyId,versionId:body.versionId,requestId:body.requestId})});return;
        }
        if(documentMatch[2]==="import" && dependencies.importApplicationDocument) {
          sendJson(response,200,{review:await dependencies.importApplicationDocument({canonicalVacancyId,document:parseDocumentImport(body)})});return;
        }
        throw new ApplicationDocumentError("Document library unavailable.",500);
      }
      const actionMatch = /^\/vacancies\/([^/]+)\/crm\/actions(?:\/([^/]+)\/(complete|cancel|reschedule|reminder|dismiss-reminder))?$/u.exec(path);
      if(request.method === "POST" && actionMatch) {
        operation="review";
        const canonicalVacancyId=decodePathId(actionMatch[1]!);
        const body=await readJsonBody(request,"Next action");
        if(!isRecord(body) || typeof body.requestId!=="string") throw new InvalidRequestError("An action request ID is required.");
        const operationName=actionMatch[3] ?? "create";
        const fields:Record<string,string[]> = {
          create:["requestId","description","dueAt","contactId"], complete:["requestId"], cancel:["requestId"],
          reschedule:["requestId","dueAt"], reminder:["requestId","remindAt"], "dismiss-reminder":["requestId","reminderId"]
        };
        if(Object.keys(body).some(key=>!fields[operationName]!.includes(key))) throw new InvalidRequestError("Unexpected action field.");
        const dueAt=body.dueAt ?? null;
        if(dueAt!==null && typeof dueAt!=="string") throw new InvalidRequestError("Invalid due time.");
        const target={canonicalVacancyId,requestId:body.requestId,actionId:actionMatch[2] ? decodePathId(actionMatch[2]) : body.requestId};
        let review;
        if(operationName==="create" && dependencies.createVacancyNextAction) {
          if(typeof body.description!=="string") throw new InvalidRequestError("An action description is required.");
          if(body.contactId!==undefined)validateContactId(body.contactId);
          review=await dependencies.createVacancyNextAction({...target,description:body.description,dueAt,...(body.contactId===undefined?{}:{contactId:body.contactId})});
        } else if(operationName==="complete" && dependencies.completeVacancyNextAction) review=await dependencies.completeVacancyNextAction(target);
        else if(operationName==="cancel" && dependencies.cancelVacancyNextAction) review=await dependencies.cancelVacancyNextAction(target);
        else if(operationName==="reschedule" && dependencies.rescheduleVacancyNextAction) {
          if(!("dueAt" in body)) throw new InvalidRequestError("Specify a due time or null to remove it.");
          review=await dependencies.rescheduleVacancyNextAction({...target,dueAt});
        } else if(operationName==="reminder" && dependencies.setVacancyActionReminder) {
          if(typeof body.remindAt!=="string") throw new InvalidRequestError("A reminder time is required.");
          review=await dependencies.setVacancyActionReminder({...target,remindAt:body.remindAt});
        } else if(operationName==="dismiss-reminder" && dependencies.dismissVacancyActionReminder) {
          if(typeof body.reminderId!=="string") throw new InvalidRequestError("A reminder ID is required.");
          review=await dependencies.dismissVacancyActionReminder({...target,reminderId:body.reminderId});
        }
        if(review) {sendJson(response,operationName==="create"?201:200,{review});return;}
      }
      const crmMatch = /^\/vacancies\/([^/]+)\/crm\/(priority|notes|process-state)$/u.exec(path);
      if (request.method === "POST" && crmMatch) {
        operation = "review";
        const canonicalVacancyId = decodePathId(crmMatch[1]!);
        const body = await readJsonBody(request, "Private CRM");
        if (!isRecord(body)) throw new InvalidRequestError("Invalid CRM payload.");
        if (crmMatch[2] === "priority" && dependencies.setVacancyPriority) {
          if(Object.keys(body).some(key=>key!=="priority")) throw new InvalidRequestError("Invalid priority payload.");
          validatePriority(body.priority);
          sendJson(response,200,{review:await dependencies.setVacancyPriority({canonicalVacancyId,priority:body.priority})});
          return;
        }
        if (crmMatch[2] === "notes" && dependencies.addVacancyNote) {
          if(typeof body.requestId!=="string" || typeof body.text!=="string" || Object.keys(body).some(key=>!["requestId","text"].includes(key))) throw new InvalidRequestError("Invalid note payload.");
          sendJson(response,201,{review:await dependencies.addVacancyNote({canonicalVacancyId,requestId:body.requestId,text:body.text})});
          return;
        }
        if (crmMatch[2] === "process-state" && dependencies.setVacancyProcessState) {
          if(typeof body.requestId!=="string" || Object.keys(body).some(key=>!["requestId","state"].includes(key))) throw new InvalidRequestError("Invalid process-state payload.");
          validateProcessState(body.state);
          sendJson(response,200,{review:await dependencies.setVacancyProcessState({canonicalVacancyId,requestId:body.requestId,state:body.state})});
          return;
        }
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
      const status = error instanceof ContactError || error instanceof ApplicationDocumentError || error instanceof VacancyCleanupError || error instanceof VacancyCrmError ? error.status : errorStatus(message, operation, error);
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
  const allowed = new Set(["type", "occurredAt", "metadata", "requestId", "contactId"]);
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
  if(value.contactId!==undefined)validateContactId(value.contactId);
  if(value.requestId!==undefined)validateContactId(value.requestId);
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
    ...(value.contactId===undefined?{}:{contactId:value.contactId}),
    ...(value.requestId===undefined?{}:{requestId:value.requestId}),
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

/** Both Review and the reusable library use the same bounded import decoder. */
function parseDocumentImport(body:unknown):ImportApplicationDocument {
  if(!isRecord(body) || typeof body.requestId!=="string") throw new InvalidRequestError("Document request ID required.");
  const existing=typeof body.documentId==="string";
  const allowed=["requestId","originalFileName","mediaType","contentBase64",...(existing?["documentId"]:["name","kind"])];
  if(Object.keys(body).some(k=>!allowed.includes(k)) || typeof body.originalFileName!=="string" || typeof body.contentBase64!=="string"
    || (body.mediaType!==null && typeof body.mediaType!=="string")) throw new InvalidRequestError("Invalid document import.");
  if(body.contentBase64.length>4*Math.ceil(MAX_DOCUMENT_BYTES/3)) throw new ApplicationDocumentError("File exceeds 5 MiB.",413);
  if(body.contentBase64.length%4!==0 || /[^A-Za-z0-9+/=]/u.test(body.contentBase64)) throw new InvalidRequestError("Invalid file encoding.");
  const bytes=Buffer.from(body.contentBase64,"base64");
  if(bytes.toString("base64")!==body.contentBase64) throw new InvalidRequestError("Invalid file encoding.");
  const common={requestId:body.requestId,originalFileName:body.originalFileName,mediaType:body.mediaType,bytes};
  if(existing) return {...common,documentId:body.documentId as string};
  if(typeof body.name!=="string" || !applicationDocumentKinds.includes(body.kind as never)) throw new InvalidRequestError("Choose a document kind and name.");
  return {...common,name:body.name,kind:body.kind as typeof applicationDocumentKinds[number]};
}
