import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ReviewPage } from "./ReviewPage";

const fetchMock = vi.fn<typeof fetch>();
vi.stubGlobal("fetch", fetchMock);

beforeEach(() => window.history.pushState({}, "", "/review/canonical-1"));
afterEach(() => { cleanup(); fetchMock.mockReset(); });

describe("ReviewPage", () => {
  it.each([["Confirm employer", "CONFIRM"], ["Not the employer", "REJECT"]])("reviews HEUFT named client with %s while ACTUA is not offered", async (label, decision) => {
    const base = review({ employerClusterId: null, status: "UNRESOLVED", confirmationCandidate: null, organizations: { employerRelationships: [], displayedCompanies: [{ role: "DISPLAYED_COMPANY", rawName: "ACTUA SAVERNE" }], recruiters: [{ role: "RECRUITER", rawName: "ACTUA Saverne" }], clients: [{ role: "CLIENT", rawName: "HEUFT France" }] } });
    respond({ review: { ...base, employerReview: { required: true, candidates: [{ type: "NAMED_CLIENT", candidateId: "client-token", name: "HEUFT France", sourceRelationship: "CLIENT", employerClusterId: null, priorConfirmationCount: 0, explanation: "ACTUA Saverne is recruiting for the named client HEUFT France." }] } } });
    respond({ review: base });
    const user = userEvent.setup(); render(<ReviewPage />);
    expect(await screen.findByRole("heading", { name: "Possible employer" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "HEUFT France" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Confirm as employer" })).not.toBeInTheDocument();
    expect(screen.getByText("Source relationship: Client named in vacancy")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: label }));
    expect(fetchMock.mock.calls[1]![0]).toContain("/employer-review");
    expect(JSON.parse(fetchMock.mock.calls[1]![1]!.body as string)).toEqual({ type: "NAMED_CLIENT", candidateId: "client-token", decision });
    expect(screen.queryByRole("heading", { name: "Possible employer" })).not.toBeInTheDocument();
    expect(screen.getByText("HEUFT France")).toBeInTheDocument();
  });

  it.each([ ["Confirm employer", "CONFIRM"], ["Not this employer", "REJECT"] ])("reviews a remembered employer using %s", async (label, decision) => {
    respond({ review: { ...review(), employerMemoryReview: { required: true, candidates: [{ employerClusterId: "memory-a", displayLabel: "ACME", status: "PROBABLY_RESOLVED", priorConfirmationCount: 2, explanation: "Multiple confirmed clusters match." }] } } });
    respond({ review: review() });
    const user = userEvent.setup(); render(<ReviewPage />);
    expect(await screen.findByText("Possible known employer")).toBeInTheDocument();
    expect(screen.getByText("Previously confirmed in 2 observations")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: label }));
    expect(fetchMock.mock.calls[1]![0]).toContain("/employer-memory-review");
    expect(JSON.parse(fetchMock.mock.calls[1]![1]!.body as string)).toEqual({ employerClusterId: "memory-a", decision });
    expect(screen.queryByText("Possible known employer")).not.toBeInTheDocument();
  });

  it("loads a NEW vacancy without creating an interaction", async () => {
    respond({ review: review() });
    render(<ReviewPage />);
    expect(await screen.findByText("Current state:", { exact: false })).toHaveTextContent("NEW");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]![1]).toBeUndefined();
  });

  it("renders source links in a new tab and shows Unknown when none are available", async () => {
    const url = "https://www.randstad.fr/emploi/technicien-de-maintenance-fh-en-journee_geispolsheim_307-u24-r000078_01r/";
    respond({ review: review({ sourceLinks: [{ sourceObservationId: "source-1", provider: "Randstad", url, observedAt: "2026-09-01T00:00:00.000Z" }] }) }); render(<ReviewPage />);
    const link = await screen.findByRole("link", { name: "Open vacancy" });
    expect(link).toHaveAttribute("href", url); expect(link).toHaveAttribute("target", "_blank"); expect(link).toHaveAttribute("rel", "noreferrer");
    cleanup(); fetchMock.mockReset(); respond({ review: review() }); render(<ReviewPage />);
    expect((await screen.findAllByText("Unknown")).length).toBeGreaterThan(0);
  });

  it("records REVIEWED and updates from the POST review response", async () => {
    respond({ review: review() }); respond({ review: review({ currentState: "REVIEWED", isNewVacancy: false }) });
    const user = userEvent.setup(); render(<ReviewPage />);
    await screen.findByRole("button", { name: "REVIEWED" }); await user.click(screen.getByRole("button", { name: "REVIEWED" }));
    expect(await screen.findByText("Current state:", { exact: false })).toHaveTextContent("REVIEWED");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]![0]).toContain("/interactions");
  });

  it("records APPLIED and shows the returned application signal", async () => {
    respond({ review: review() }); respond({ review: review({ currentState: "APPLIED", alreadyAppliedToThisVacancy: true }) });
    const user = userEvent.setup(); render(<ReviewPage />); await screen.findByRole("button", { name: "APPLIED" });
    await user.click(screen.getByRole("button", { name: "APPLIED" }));
    expect(await screen.findByText("Already applied to this vacancy")).toBeInTheDocument();
  });

  it("disables all action buttons during an interaction request", async () => {
    respond({ review: review() }); let finish!: (response: Response) => void;
    fetchMock.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const user = userEvent.setup(); render(<ReviewPage />); await screen.findByRole("button", { name: "REVIEWED" });
    await user.click(screen.getByRole("button", { name: "REVIEWED" }));
    expect(screen.getByRole("button", { name: "APPLIED" })).toBeDisabled();
    finish(json({ review: review({ currentState: "REVIEWED" }) }));
    expect(await screen.findByText("Current state:", { exact: false })).toHaveTextContent("REVIEWED");
  });

  it("shows a not-found state for a missing vacancy", async () => {
    respond({ error: "Missing" }, 404); render(<ReviewPage />);
    expect(await screen.findByText("Vacancy not found.")).toBeInTheDocument();
  });

  it("shows a POST validation error", async () => {
    respond({ review: review() }); respond({ error: "Interaction type is invalid." }, 400);
    const user = userEvent.setup(); render(<ReviewPage />); await screen.findByRole("button", { name: "REVIEWED" });
    await user.click(screen.getByRole("button", { name: "REVIEWED" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Interaction type is invalid.");
  });

  it("renders unknown vacancy fields safely", async () => {
    respond({ review: review({ title: null, location: null, engagement: null, workMode: null, compensation: null }) }); render(<ReviewPage />);
    expect((await screen.findAllByText("Unknown")).length).toBeGreaterThanOrEqual(4);
  });

  it("renders structured facts readably without exposing JSON", async () => {
    respond({ review: review({
      location: { rawText: "Benfeld, Bas-Rhin, FR" },
      engagement: { rawTerms: ["CONTRACTOR"], normalizedTerms: [] },
      compensation: { rawText: "12.66 - 0 EUR / HOUR" }, workMode: "REMOTE",
    }) });
    render(<ReviewPage />);
    expect(await screen.findByText("Benfeld, Bas-Rhin, FR")).toBeInTheDocument();
    expect(screen.getByText("Contractor")).toBeInTheDocument();
    expect(screen.getByText("12.66â€“0 EUR / hour")).toBeInTheDocument();
    expect(screen.getByText("Remote")).toBeInTheDocument();
    expect(screen.queryByText(/\{"rawText"/u)).not.toBeInTheDocument();
    expect(screen.queryByText(/"normalizedTerms"/u)).not.toBeInTheDocument();
  });

  it("displays selected Indeed company and location facts", async () => {
    respond({ review: review({
      title: "Technicien de maintenance H/F",
      location: { rawText: "67120 Altorf" },
      organizations: { employerRelationships: [], displayedCompanies: [{ role: "DISPLAYED_COMPANY", rawName: "EUROBRILLANCE" }], recruiters: [], consultancies: [], staffingAgencies: [], clients: [], otherRelationships: [] },
    }) });
    render(<ReviewPage />);
    expect(await screen.findByText("Technicien de maintenance H/F")).toBeInTheDocument();
    expect(screen.getByText("67120 Altorf")).toBeInTheDocument();
    expect(screen.getByText("EUROBRILLANCE")).toBeInTheDocument();
    expect(screen.queryByText("Job Post Details")).not.toBeInTheDocument();
  });

  it("displays BÃ¼rkert title, company, and location", async () => {
    respond({ review: review({
      title: "Teamleiter Kunststofftechnik (m/w/d)",
      location: { rawText: "Ingelfingen-Criesbach" },
      organizations: { employerRelationships: [{ role: "EMPLOYER", rawName: "BÃ¼rkert Fluid Control Systems" }], displayedCompanies: [{ role: "DISPLAYED_COMPANY", rawName: "BÃ¼rkert Fluid Control Systems" }], recruiters: [], consultancies: [], staffingAgencies: [], clients: [], otherRelationships: [] },
    }) });
    render(<ReviewPage />);
    expect(await screen.findByText("Teamleiter Kunststofftechnik (m/w/d)")).toBeInTheDocument();
    expect(screen.getByText("Ingelfingen-Criesbach")).toBeInTheDocument();
    expect(screen.getAllByText("BÃ¼rkert Fluid Control Systems").length).toBeGreaterThan(0);
  });

  it("displays Workday title, company, and location", async () => {
    respond({ review: review({ title: "Chauffeur SPL ADR (H/F)", location: { rawText: "Rouen" }, organizations: { employerRelationships: [], displayedCompanies: [{ role: "DISPLAYED_COMPANY", rawName: "Air Products" }], recruiters: [], consultancies: [], staffingAgencies: [], clients: [], otherRelationships: [] } }) });
    render(<ReviewPage />);
    expect(await screen.findByText("Chauffeur SPL ADR (H/F)")).toBeInTheDocument();
    expect(screen.getByText("Rouen")).toBeInTheDocument();
    expect(screen.getByText("Air Products")).toBeInTheDocument();
  });

  it("displays the canonical Daimler location", async () => {
    respond({ review: review({ location: { rawText: "MOLSHEIM, Daimler Truck - FR, FR" } }) });
    render(<ReviewPage />);
    expect(await screen.findByText("MOLSHEIM, Daimler Truck - FR, FR")).toBeInTheDocument();
  });

  it("shows an unlinked employer explicitly", async () => {
    respond({ review: review({ employerClusterId: null }) }); render(<ReviewPage />);
    expect(await screen.findByText("Employer unresolved / not linked")).toBeInTheDocument();
  });

  it("keeps ACTUA recruiter and HEUFT client visible without offering employer confirmation", async () => {
    respond({ review: review({
      title: "Mécanicien Monteur d’Équipements Industriels H/F", employerClusterId: null, status: "UNRESOLVED", confirmationCandidate: null,
      organizations: { employerRelationships: [], displayedCompanies: [{ role: "DISPLAYED_COMPANY", rawName: "ACTUA SAVERNE" }], recruiters: [{ role: "RECRUITER", rawName: "ACTUA Saverne" }], clients: [{ role: "CLIENT", rawName: "HEUFT France" }], consultancies: [] },
    }) });
    render(<ReviewPage />);
    expect(await screen.findByText("ACTUA SAVERNE")).toBeInTheDocument();
    expect(screen.getByText("ACTUA Saverne")).toBeInTheDocument();
    expect(screen.getByText("HEUFT France")).toBeInTheDocument();
    expect(screen.getByText("Employer unresolved / not linked")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Confirm as employer" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Confirm employer" })).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("offers and submits a clean employer confirmation candidate", async () => {
    respond({ review: review({ confirmationCandidate: "Air Products S.A.S (FR)" }) });
    respond({ review: review({ confirmationCandidate: null, status: "PROBABLY_RESOLVED" }) });
    const user = userEvent.setup(); render(<ReviewPage />);
    expect(await screen.findByText(/Employer candidate:/u)).toHaveTextContent("Air Products S.A.S (FR)");
    await user.click(screen.getByRole("button", { name: "Confirm as employer" }));
    expect(fetchMock.mock.calls[1]![0]).toContain("/employer-confirmation");
    expect(await screen.findByText("Employer status", { exact: false })).toBeInTheDocument();
  });

  it("renders known-employer history signals", async () => {
    respond({ review: review({ isKnownEmployer: true, previouslyAppliedToEmployer: true }) }); render(<ReviewPage />);
    expect(await screen.findByText("Known employer")).toBeInTheDocument();
    expect(screen.getAllByText("Previously applied to employer")).toHaveLength(2);
  });

  it("keeps recruiter and consultancy separate from employer", async () => {
    respond({ review: review() }); render(<ReviewPage />);
    expect(await screen.findByText("Actual employer")).toBeInTheDocument();
    expect(screen.getByText("Recruiter name")).toBeInTheDocument();
    expect(screen.getByText("Consultancy name")).toBeInTheDocument();
  });

  it("shows recurrence for multiple observations", async () => {
    respond({ review: review({ sameCanonicalVacancySeenBefore: true, hasMultipleSourceObservations: true }) }); render(<ReviewPage />);
    expect(await screen.findByText("Same vacancy seen before")).toBeInTheDocument();
    expect(screen.getByText("Multiple source observations")).toBeInTheDocument();
  });
});

function respond(body: unknown, status = 200): void { fetchMock.mockResolvedValueOnce(json(body, status)); }
function json(body: unknown, status = 200): Response { return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }); }
function review(overrides: Record<string, unknown> = {}) {
  const vacancy = { canonicalVacancyId: "canonical-1", canonicalizationStatus: "CANONICAL", title: "Developer", location: "Paris", locationAlternatives: [], engagement: "FULL_TIME", workMode: "HYBRID", compensation: "50000", latestObservedAt: "2026-09-01T00:00:00.000Z", sourceObservationCount: 1, sourceLinks: [] };
  const user = { currentState: "NEW", lastInteractionAt: null, everApplied: false, everInterviewed: false, everRejected: false };
  const employer = { employerClusterId: "cluster-1", status: "RESOLVED", resolvedEmployerId: "employer-1", knownBefore: false, previousVacancyCount: 0, previousInteractedVacancyCount: 0, everAppliedToEmployer: false, everInterviewedWithEmployer: false, everRejectedByEmployer: false };
  const organizations = { employerRelationships: [{ role: "EMPLOYER", rawName: "Actual employer" }], displayedCompanies: [], recruiters: [{ role: "RECRUITER", rawName: "Recruiter name" }], consultancies: [{ role: "CONSULTANCY", rawName: "Consultancy name" }], staffingAgencies: [], clients: [], otherRelationships: [] };
  const recognition = { sameCanonicalVacancySeenBefore: false, employerSeenBefore: false, unresolvedEmployer: false };
  const reviewSignals = { isNewVacancy: true, isKnownEmployer: false, alreadyAppliedToThisVacancy: false, previouslyAppliedToEmployer: false, previouslyInterviewedWithEmployer: false, previouslyRejectedByEmployer: false, hasMultipleSourceObservations: false };
  for (const [key, value] of Object.entries(overrides)) {
    if (key in vacancy) Object.assign(vacancy, { [key]: value });
    else if (key in user) Object.assign(user, { [key]: value });
    else if (key in employer || key === "confirmationCandidate") Object.assign(employer, { [key]: value });
    else if (key === "organizations") Object.assign(organizations, value);
    else if (key in recognition) Object.assign(recognition, { [key]: value });
    else Object.assign(reviewSignals, { [key]: value });
  }
  return { vacancy, user, employer, organizations, recognition, reviewSignals };
}