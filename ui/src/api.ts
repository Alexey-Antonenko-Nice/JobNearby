export interface OrganizationRelationship {
  readonly organizationId?: string;
  readonly employerClusterId?: string;
  readonly rawName?: string;
  readonly role: string;
}

export interface ReviewView {
  readonly vacancy: {
    readonly canonicalVacancyId: string;
    readonly canonicalizationStatus: string;
    readonly title: string | null;
    readonly location: unknown | null;
    readonly engagement: unknown | null;
    readonly workMode: unknown | null;
    readonly compensation: unknown | null;
    readonly latestObservedAt: string | null;
    readonly sourceObservationCount: number;
  };
  readonly user: { readonly currentState: string; readonly lastInteractionAt: string | null; readonly everApplied: boolean; readonly everInterviewed: boolean; readonly everRejected: boolean };
  readonly employer: { readonly employerClusterId: string | null; readonly status: string | null; readonly resolvedEmployerId: string | null; readonly knownBefore: boolean; readonly previousVacancyCount: number; readonly previousInteractedVacancyCount: number; readonly everAppliedToEmployer: boolean; readonly everInterviewedWithEmployer: boolean; readonly everRejectedByEmployer: boolean };
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

export async function recordInteraction(canonicalVacancyId: string, type: string): Promise<ReviewView> {
  const response = await fetch(`${API_ORIGIN}/vacancies/${encodeURIComponent(canonicalVacancyId)}/interactions`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type }),
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