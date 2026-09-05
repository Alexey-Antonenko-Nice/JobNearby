import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { InboxPage } from "./InboxPage";
import { ReviewPage } from "./ReviewPage";

const fetchMock = vi.fn<typeof fetch>();
vi.stubGlobal("fetch", fetchMock);
beforeEach(() => window.history.pushState({}, "", "/"));
afterEach(() => { cleanup(); fetchMock.mockReset(); });

describe("InboxPage", () => {
  it("shows loading then a vacancy list without posting interactions", async () => {
    fetchMock.mockResolvedValueOnce(response({ vacancies: [item()] })); render(<InboxPage />);
    expect(screen.getByText("Loading...")).toBeInTheDocument();
    expect(await screen.findByText("Developer")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1); expect(fetchMock.mock.calls[0]![1]).toBeUndefined();
    expect(screen.getByRole("link", { name: "Open review" })).toHaveAttribute("href", "/review/canonical-1");
  });
  it("renders the primary source as a new-tab link", async () => {
    const url = "https://www.randstad.fr/emploi/technicien-de-maintenance-fh-en-journee_geispolsheim_307-u24-r000078_01r/";
    fetchMock.mockResolvedValueOnce(response({ vacancies: [item({ sourceLinks: [{ sourceObservationId: "source-1", provider: "Randstad", url, observedAt: "2026-09-01T00:00:00.000Z" }] })] })); render(<InboxPage />);
    const link = await screen.findByRole("link", { name: "Open source vacancy" });
    expect(link).toHaveAttribute("href", url); expect(link).toHaveAttribute("target", "_blank"); expect(link).toHaveAttribute("rel", "noreferrer");
  });
  it("shows an empty inbox", async () => { fetchMock.mockResolvedValueOnce(response({ vacancies: [] })); render(<InboxPage />); expect(await screen.findByText("No captured vacancies yet.")).toBeInTheDocument(); });
  it("shows an API error", async () => { fetchMock.mockResolvedValueOnce(response({ error: "Unavailable" }, 500)); render(<InboxPage />); expect(await screen.findByRole("alert")).toHaveTextContent("Unable to load vacancy inbox."); });
  it("keeps organization roles distinct", async () => { fetchMock.mockResolvedValueOnce(response({ vacancies: [item()] })); render(<InboxPage />); expect(await screen.findByText("Actual employer")).toBeInTheDocument(); expect(screen.getByText("Recruiter")).toBeInTheDocument(); expect(screen.getByText("Consultancy")).toBeInTheDocument(); });
  it("formats structured inbox facts without JSON", async () => { fetchMock.mockResolvedValueOnce(response({ vacancies: [item({ location: { rawText: "Molsheim, Bas-Rhin, FR" }, engagement: { rawTerms: ["CONTRACTOR"], normalizedTerms: [] }, workMode: "HYBRID" })] })); render(<InboxPage />); expect(await screen.findByText(/Molsheim, Bas-Rhin, FR/)).toBeInTheDocument(); expect(screen.getByText(/Contractor/)).toBeInTheDocument(); expect(screen.getByText(/Hybrid/)).toBeInTheDocument(); expect(screen.queryByText(/\{"rawText"/u)).not.toBeInTheDocument(); });
  it("offers a back link from review", async () => { window.history.pushState({}, "", "/review/canonical-1"); fetchMock.mockResolvedValueOnce(response({ review: review() })); render(<ReviewPage />); expect(await screen.findByRole("link", { name: "Back to inbox" })).toHaveAttribute("href", "/"); });
});

function response(body: unknown, status = 200): Response { return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }); }
function item(overrides: Record<string, unknown> = {}) { return { canonicalVacancyId: "canonical-1", canonicalizationStatus: "PARTIAL", title: "Developer", location: "Paris", engagement: null, workMode: null, latestObservedAt: "2026-09-01T00:00:00.000Z", sourceObservationCount: 2, sourceLinks: [], userState: "NEW", employer: { status: "RESOLVED", unresolvedEmployer: false }, organizations: { employerName: "Actual employer", displayedCompanyNames: [], recruiterNames: ["Recruiter"], consultancyNames: ["Consultancy"] }, signals: { sameCanonicalVacancySeenBefore: true, hasMultipleSourceObservations: true, alreadyAppliedToThisVacancy: false }, ...overrides }; }
function review() { return { vacancy: { canonicalVacancyId: "canonical-1", canonicalizationStatus: "PARTIAL", title: "Developer", location: null, engagement: null, workMode: null, compensation: null, latestObservedAt: null, sourceObservationCount: 1, sourceLinks: [] }, user: { currentState: "NEW", lastInteractionAt: null, everApplied: false, everInterviewed: false, everRejected: false }, employer: { employerClusterId: null, status: null, resolvedEmployerId: null, knownBefore: false, previousVacancyCount: 0, previousInteractedVacancyCount: 0, everAppliedToEmployer: false, everInterviewedWithEmployer: false, everRejectedByEmployer: false }, organizations: {}, recognition: { sameCanonicalVacancySeenBefore: false, employerSeenBefore: false, unresolvedEmployer: true }, reviewSignals: { isNewVacancy: true, isKnownEmployer: false, alreadyAppliedToThisVacancy: false, previouslyAppliedToEmployer: false, previouslyInterviewedWithEmployer: false, previouslyRejectedByEmployer: false, hasMultipleSourceObservations: false } }; }