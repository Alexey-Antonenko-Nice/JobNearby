import type { PublicationCampaignContext as DomainPublicationCampaignContext } from "../../src/domain/user/PublicationCampaignContext.js";
import type { EmployerDisplayState } from "../../src/domain/user/EmployerDisplayState.js";
import type { VacancyProcessState } from "../../src/domain/user/VacancyCrm.js";

type Serialized<T> = T extends Date ? string : T extends readonly (infer V)[] ? readonly Serialized<V>[] : T extends object ? { [K in keyof T]: Serialized<T[K]> } : T;
export type PublicationCampaignContext = Serialized<DomainPublicationCampaignContext>;

export interface VacancyContext extends PublicationCampaignContext {
  readonly currentCanonicalVacancyId: string;
  readonly seenBefore: boolean;
  readonly observationCount: number;
  readonly sourceCount: number;
  readonly sourceProviders: readonly string[];
  readonly firstSeenAt: string | null;
  readonly lastSeenAt: string | null;
  readonly currentSourceObservationId: string | null;
  readonly currentSourceProvider: string | null;
  readonly reviewedBefore: boolean;
  readonly interestedBefore: boolean;
  readonly appliedBefore: boolean;
  readonly contactedBefore: boolean;
  readonly interviewedBefore: boolean;
  readonly offeredBefore: boolean;
  readonly rejectedBefore: boolean;
  readonly withdrawnBefore: boolean;
  readonly closedBefore: boolean;
  readonly latestInteractionType: string | null;
  readonly latestInteractionAt: string | null;
  readonly appliedViaProvider: string | null;
  readonly appliedViaSourceObservationId: string | null;
}

export interface EmployerAliasSelection {
  readonly type: "ALIAS_SELECTION";
  readonly candidateId: string;
  readonly name: string;
  readonly explanation: string;
  readonly options: readonly { employerClusterId: string; displayLabel: string }[];
}

export interface NamedClientEmployerCandidate {
  readonly type: "NAMED_CLIENT";
  readonly candidateId: string;
  readonly name: string;
  readonly explanation: string;
  readonly sourceRelationship: "CLIENT";
  readonly employerClusterId: string | null;
  readonly priorConfirmationCount: number;
}

export interface OrganizationRelationship {
  readonly organizationId?: string;
  readonly employerClusterId?: string;
  readonly rawName?: string;
  readonly role: string;
}

export interface VacancySourceLink {
  readonly sourceObservationId: string;
  readonly provider: string;
  readonly url: string;
  readonly observedAt: string;
}

export interface EmployerHistory {
  readonly employerCluster: { readonly id: string; readonly status: string; readonly displayLabel?: string };
  readonly knownNames: readonly string[];
  readonly summary: {
    readonly vacancyCount: number; readonly everAppliedCount: number; readonly everInterviewedCount: number;
    readonly everOfferedCount: number; readonly everRejectedCount: number; readonly latestUserInteractionAt: string | null;
  };
  readonly vacancies: readonly {
    readonly canonicalVacancyId: string; readonly title: string | null; readonly location: unknown | null;
    readonly sources?: readonly string[]; readonly currentUserState: string; readonly lastUserInteractionAt: string | null;
    readonly everApplied: boolean; readonly everContacted: boolean; readonly everInterviewed: boolean;
    readonly everOffered: boolean; readonly everRejected: boolean; readonly everWithdrawn: boolean;
  }[];
}

export interface EmployerActionContext {
  readonly knownEmployer: boolean;
  readonly appliedBefore: boolean; readonly applicationCount: number;
  readonly contactedBefore: boolean; readonly contactCount: number;
  readonly interviewedBefore: boolean; readonly interviewCount: number;
  readonly offeredBefore: boolean; readonly offerCount: number;
  readonly rejectedBefore: boolean; readonly rejectionCount: number;
  readonly withdrawnBefore: boolean; readonly withdrawalCount: number;
  readonly lastApplicationAt: string | null;
  readonly lastInteractionAt: string | null;
  readonly lastInteractionType: string | null;
}

export interface ReviewView {
  readonly interactions?: Serialized<readonly import("../../src/domain/user/UserVacancyInteractionEvent.js").UserVacancyInteractionEvent[]>;
  readonly contacts?: import("../../src/domain/user/Contact.js").ContactsView;
  readonly documents?: Serialized<import("../../src/domain/user/ApplicationDocument.js").ApplicationDocumentsView>;
  readonly nextActions?: Serialized<import("../../src/domain/user/VacancyNextAction.js").NextActionsView>;
  readonly crm?: Serialized<import("../../src/domain/user/VacancyCrm.js").VacancyCrmState>;
  readonly employerIdentityReview?: import("../../src/domain/user/EmployerIdentityReview").EmployerIdentityReview | null;
  readonly organizationRoleReview?: readonly import("../../src/domain/organizations/VacancyOrganizationRoleDecision.js").OrganizationRoleReviewItem[];
  readonly agencyContext?: {
    readonly candidates: readonly { candidateId: string; name: string; role: "RECRUITER" | "STAFFING_AGENCY" }[];
    readonly known: readonly { name: string; role: "RECRUITER" | "STAFFING_AGENCY"; memoryId: string; source: "USER_CONFIRMED" | "AGENCY_MEMORY" }[];
    readonly ambiguousNames: readonly string[];
  };
  readonly vacancyContext?: VacancyContext;
  readonly employerActionContext?: EmployerActionContext;
  readonly employerHistory?: EmployerHistory;
  readonly employerReview?: { readonly required: boolean; readonly candidates: readonly (EmployerAliasSelection | NamedClientEmployerCandidate | (NonNullable<ReviewView["employerMemoryReview"]>["candidates"][number] & { readonly type: "CONFIRMED_MEMORY" }))[] };
  readonly employerMemoryReview?: { readonly required: boolean; readonly candidates: readonly { employerClusterId: string; displayLabel: string; status: string; currentOrganizationName: string; explanation: string; reasonCodes: readonly string[]; priorConfirmationExists: boolean; priorConfirmationCount: number }[] };
  readonly vacancy: {
    readonly canonicalVacancyId: string;
    readonly canonicalizationStatus: string;
    readonly title: string | null;
    readonly location: unknown | null;
    readonly locationAlternatives: readonly unknown[];
    readonly engagement: unknown | null;
    readonly workMode: unknown | null;
    readonly compensation: unknown | null;
    readonly educationRequirements?: readonly { readonly rawText: string; readonly normalizedLevel?: string }[];
    readonly skillRequirements?: readonly { readonly skill: string; readonly rawText?: string }[];
    readonly languageRequirements?: readonly { readonly language: string; readonly requirement: string; readonly level?: string; readonly rawText?: string }[];
    readonly compensationHistory?: readonly { readonly sourceObservationId: string; readonly observedAt: string; readonly status: string; readonly values: readonly unknown[] }[];
    readonly latestObservedAt: string | null;
    readonly sourceObservationCount: number;
    readonly sourceLinks: readonly VacancySourceLink[];
  };
  readonly user: { readonly currentState: string; readonly lastInteractionAt: string | null; readonly everApplied: boolean; readonly everInterviewed: boolean; readonly everRejected: boolean };
  readonly employer: { readonly aliasEvidence?: readonly { aliasName: string; explanation: string; sourceType: string; createdAt: string }[]; readonly employerClusterId: string | null; readonly status: string | null; readonly displayState: EmployerDisplayState; readonly displayName: string | null; readonly resolvedEmployerId: string | null; readonly knownBefore: boolean; readonly previousVacancyCount: number; readonly previousInteractedVacancyCount: number; readonly everAppliedToEmployer: boolean; readonly everInterviewedWithEmployer: boolean; readonly everRejectedByEmployer: boolean; readonly confirmationCandidate?: string | null };
  readonly organizations: Record<string, readonly OrganizationRelationship[]>;
  readonly recognition: { readonly sameCanonicalVacancySeenBefore: boolean; readonly employerSeenBefore: boolean; readonly unresolvedEmployer: boolean };
  readonly reviewSignals: { readonly isNewVacancy: boolean; readonly isKnownEmployer: boolean; readonly alreadyAppliedToThisVacancy: boolean; readonly previouslyAppliedToEmployer: boolean; readonly previouslyInterviewedWithEmployer: boolean; readonly previouslyRejectedByEmployer: boolean; readonly hasMultipleSourceObservations: boolean };
}

interface ErrorResponse { readonly error?: string; }

const API_ORIGIN = "http://127.0.0.1:4317";

export async function getReview(canonicalVacancyId: string): Promise<ReviewView> {
  const response = await fetch(`${API_ORIGIN}/vacancies/${encodeURIComponent(canonicalVacancyId)}/review`);
  if (!response.ok) throw await apiError(response);
  return (await response.json() as { review: ReviewView }).review;
}

export async function recordInteraction(canonicalVacancyId: string, type: string, requestId?:string, contactId?:string): Promise<ReviewView> {
  const response = await fetch(`${API_ORIGIN}/vacancies/${encodeURIComponent(canonicalVacancyId)}/interactions`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type, ...(requestId?{requestId}:{}), ...(contactId?{contactId}:{}) }),
  });
  if (!response.ok) throw await apiError(response);
  return (await response.json() as { review: ReviewView }).review;
}

async function apiError(response: Response): Promise<Error & { readonly status: number }> {
  const body = await response.json().catch(() => ({})) as ErrorResponse;
  const error = new Error(body.error ?? "Request failed.") as Error & { status: number };
  Object.assign(error, { status: response.status });
  return error;
}

export interface VacancyInboxItem {
  readonly canonicalVacancyId: string;
  readonly canonicalizationStatus: string;
  readonly title: string | null;
  readonly location: unknown | null;
  readonly locationAlternatives: readonly unknown[];
  readonly engagement: unknown | null;
  readonly workMode: unknown | null;
  readonly latestObservedAt: string | null;
  readonly sourceObservationCount: number;
  readonly sourceLinks: readonly VacancySourceLink[];
  readonly userState: string;
  readonly employer: { readonly status: string | null; readonly displayState: EmployerDisplayState; readonly displayName: string | null; readonly unresolvedEmployer: boolean };
  readonly organizations: { readonly employerName: string | null; readonly displayedCompanyNames: readonly string[]; readonly recruiterNames: readonly string[]; readonly consultancyNames: readonly string[] };
  readonly signals: { readonly sameCanonicalVacancySeenBefore: boolean; readonly hasMultipleSourceObservations: boolean; readonly alreadyAppliedToThisVacancy: boolean };
}

export async function getVacancyInbox(limit?: number, archived = false): Promise<readonly VacancyInboxItem[]> {
  const query = limit === undefined ? "" : `?limit=${encodeURIComponent(limit)}`;
  const response = await fetch(`${API_ORIGIN}/vacancies${query}${archived ? (query ? "&archived=true" : "?archived=true") : ""}`);
  if (!response.ok) throw await apiError(response);
  return (await response.json() as { vacancies: readonly VacancyInboxItem[] }).vacancies;
}

export async function confirmEmployer(canonicalVacancyId: string, candidateName: string): Promise<ReviewView> {
  const response = await fetch(`${API_ORIGIN}/vacancies/${encodeURIComponent(canonicalVacancyId)}/employer-confirmation`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ candidateName }),
  });
  if (!response.ok) throw await apiError(response);
  return (await response.json() as { review: ReviewView }).review;
}
export async function decideEmployerMemory(canonicalVacancyId: string, employerClusterId: string, decision: "CONFIRM" | "REJECT"): Promise<ReviewView> {
  const response = await fetch(`${API_ORIGIN}/vacancies/${encodeURIComponent(canonicalVacancyId)}/employer-memory-review`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ employerClusterId, decision }),
  });
  if (!response.ok) throw await apiError(response);
  return (await response.json() as { review: ReviewView }).review;
}

export async function decideNamedClientEmployer(canonicalVacancyId: string, candidateId: string, decision: "CONFIRM" | "REJECT"): Promise<ReviewView> {
  const response = await fetch(`${API_ORIGIN}/vacancies/${encodeURIComponent(canonicalVacancyId)}/employer-review`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "NAMED_CLIENT", candidateId, decision }),
  });
  if (!response.ok) throw await apiError(response);
  return (await response.json() as { review: ReviewView }).review;
}

export async function decideEmployerAlias(canonicalVacancyId: string, candidateId: string, employerClusterId: string, decision: "CONFIRM" | "REJECT"): Promise<ReviewView> {
  const response = await fetch(`${API_ORIGIN}/vacancies/${encodeURIComponent(canonicalVacancyId)}/employer-review`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "ALIAS_SELECTION", candidateId, employerClusterId, decision }),
  });
  if (!response.ok) throw await apiError(response);
  return (await response.json() as { review: ReviewView }).review;
}

export async function confirmRecruitingAgency(canonicalVacancyId: string, candidateId: string): Promise<ReviewView> {
  const response = await fetch(`${API_ORIGIN}/vacancies/${encodeURIComponent(canonicalVacancyId)}/recruiting-agency-confirmation`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ candidateId }),
  });
  if (!response.ok) throw await apiError(response);
  return (await response.json() as { review: ReviewView }).review;
}

export async function decideOrganizationRole(canonicalVacancyId: string, input: {
  requestId: string; identityKey: string; role: string; candidateToken: string; acknowledgeContradiction: boolean;
}): Promise<ReviewView> {
  const response = await fetch(`${API_ORIGIN}/vacancies/${encodeURIComponent(canonicalVacancyId)}/organization-role-decisions`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input),
  });
  if (!response.ok) throw await apiError(response);
  return (await response.json() as { review: ReviewView }).review;
}

export async function searchEmployerIdentities(canonicalVacancyId: string, query: string): Promise<NonNullable<ReviewView["employerIdentityReview"]>> {
  const response = await fetch(`${API_ORIGIN}/vacancies/${encodeURIComponent(canonicalVacancyId)}/employer-identity-search?q=${encodeURIComponent(query)}`);
  if (!response.ok) throw await apiError(response);
  return (await response.json() as {employerIdentitySearch:NonNullable<ReviewView["employerIdentityReview"]>}).employerIdentitySearch;
}

export async function decideEmployerIdentity(canonicalVacancyId: string, input: {
  requestId: string; employerClusterId: string; candidateToken: string; decision: "USE_EXISTING" | "KEEP_SEPARATE";
}): Promise<ReviewView> {
  const response = await fetch(`${API_ORIGIN}/vacancies/${encodeURIComponent(canonicalVacancyId)}/employer-identity-decisions`, {
    method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify(input),
  });
  if (!response.ok) throw await apiError(response);
  return (await response.json() as {review:ReviewView}).review;
}

export type { VacancyCleanupState, VacancyDeletionPreview } from "../../src/domain/user/VacancyCleanup.js";
export async function cleanupRequest<T>(id: string, action: string, body?: unknown): Promise<T> {
  const response = await fetch(API_ORIGIN + "/vacancies/" + encodeURIComponent(id) + "/" + action, body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!response.ok) throw await apiError(response);
  return await response.json() as T;
}

export async function setVacancyPriority(id: string, priority: import("../../src/domain/user/VacancyCrm.js").VacancyPriority): Promise<ReviewView> {
  return (await cleanupRequest<{review:ReviewView}>(id,"crm/priority",{priority})).review;
}
export async function addVacancyNote(id: string, requestId: string, text: string): Promise<ReviewView> {
  return (await cleanupRequest<{review:ReviewView}>(id,"crm/notes",{requestId,text})).review;
}
export async function setVacancyProcessState(id: string, requestId: string, state: VacancyProcessState): Promise<ReviewView> {
  return (await cleanupRequest<{review:ReviewView}>(id,"crm/process-state",{requestId,state})).review;
}

export async function createVacancyNextAction(id:string,requestId:string,description:string,dueAt:string|null,contactId?:string):Promise<ReviewView> {
  return (await cleanupRequest<{review:ReviewView}>(id,"crm/actions",{requestId,description,dueAt,...(contactId?{contactId}:{})})).review;
}
export async function completeVacancyNextAction(id:string,actionId:string,requestId:string):Promise<ReviewView> {
  return (await cleanupRequest<{review:ReviewView}>(id,"crm/actions/"+encodeURIComponent(actionId)+"/complete",{requestId})).review;
}
export async function cancelVacancyNextAction(id:string,actionId:string,requestId:string):Promise<ReviewView> {
  return (await cleanupRequest<{review:ReviewView}>(id,"crm/actions/"+encodeURIComponent(actionId)+"/cancel",{requestId})).review;
}
export async function rescheduleVacancyNextAction(id:string,actionId:string,requestId:string,dueAt:string|null):Promise<ReviewView> {
  return (await cleanupRequest<{review:ReviewView}>(id,"crm/actions/"+encodeURIComponent(actionId)+"/reschedule",{requestId,dueAt})).review;
}
export async function setVacancyActionReminder(id:string,actionId:string,requestId:string,remindAt:string):Promise<ReviewView> {
  return (await cleanupRequest<{review:ReviewView}>(id,"crm/actions/"+encodeURIComponent(actionId)+"/reminder",{requestId,remindAt})).review;
}
export async function dismissVacancyActionReminder(id:string,actionId:string,requestId:string,reminderId:string):Promise<ReviewView> {
  return (await cleanupRequest<{review:ReviewView}>(id,"crm/actions/"+encodeURIComponent(actionId)+"/dismiss-reminder",{requestId,reminderId})).review;
}

export async function importApplicationDocument(id:string, input:Record<string,unknown>):Promise<ReviewView> {
  return (await cleanupRequest<{review:ReviewView}>(id,"documents/import",input)).review;
}
export async function associateVacancyDocument(id:string,versionId:string,requestId:string):Promise<ReviewView> {
  return (await cleanupRequest<{review:ReviewView}>(id,"documents/associations",{versionId,requestId})).review;
}
export function documentDownloadUrl(versionId:string):string {
  return API_ORIGIN+"/documents/versions/"+encodeURIComponent(versionId)+"/content";
}

export type DocumentLibrary = Serialized<import("../../src/domain/user/ApplicationDocument.js").ApplicationDocumentsView["library"]>;
async function libraryRequest(path:string,body?:unknown):Promise<DocumentLibrary> {
  const response=await fetch(API_ORIGIN+path,body===undefined?{}:{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
  if(!response.ok) throw await apiError(response);
  return (await response.json() as {library:DocumentLibrary}).library;
}
export const getDocumentLibrary=()=>libraryRequest("/documents");
export const importLibraryDocument=(input:Record<string,unknown>)=>libraryRequest("/documents/import",input);
export const renameLibraryDocument=(id:string,name:string,requestId:string)=>libraryRequest("/documents/"+encodeURIComponent(id)+"/rename",{name,requestId});
export const archiveLibraryDocument=(id:string,requestId:string)=>libraryRequest("/documents/"+encodeURIComponent(id)+"/archive",{requestId});
export const restoreLibraryDocument=(id:string,requestId:string)=>libraryRequest("/documents/"+encodeURIComponent(id)+"/restore",{requestId});

export async function getContacts():Promise<import("../../src/domain/user/Contact.js").Contact[]> {
  const response=await fetch(API_ORIGIN+"/contacts");
  if(!response.ok)throw await apiError(response);
  return (await response.json()).contacts;
}
export async function contactCommand(input:import("../../src/domain/user/Contact.js").ContactCommand):Promise<{resultId:string;contacts:import("../../src/domain/user/Contact.js").Contact[]}> {
  const response=await fetch(API_ORIGIN+"/contacts/commands",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(input)});
  if(!response.ok)throw await apiError(response);
  return response.json();
}
