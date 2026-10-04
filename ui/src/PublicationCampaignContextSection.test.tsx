import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { PublicationCampaignContextSection } from "./PublicationCampaignContextSection";
import type { PublicationCampaignContext } from "./api";
afterEach(cleanup);
const evidence = { membershipId: "m1", status: "USER_CONFIRMED" as const, confidence: 0.87, sourceType: "USER_CONFIRMED" as const, algorithm: "manual", algorithmVersion: "1", evaluatedAt: "2026-10-01T00:00:00Z", createdAt: "2026-10-01T00:00:00Z" };
const family: PublicationCampaignContext["publicationFamilies"][number] = { id: "f1", representativeTitle: "Technician publications", observationCount: 4, currentVacancyObservationCount: 2, currentVacancyObservationIds: ["a", "b"], sourceProviders: ["hellowork.com", "indeed.com"], firstSeenAt: "2026-09-12T00:00:00Z", lastSeenAt: "2026-09-28T00:00:00Z", membershipEvidence: [] };
const campaign: PublicationCampaignContext["recruitmentCampaigns"][number] = { id: "c1", employerClusterId: "anonymous", status: "ENDED", firstObservedAt: "2025-01-01T00:00:00Z", lastObservedAt: "2026-10-01T00:00:00Z", relationshipPaths: [{ ...evidence, pathType: "PUBLICATION_FAMILY", publicationFamilyId: "f1" }, { ...evidence, membershipId: "m2", pathType: "DIRECT_OBSERVATION", sourceObservationId: "a" }] };
describe("Publication and campaign context", () => {
  it("omits the empty section without claiming that no related vacancies exist", () => {
    const { container } = render(<PublicationCampaignContextSection context={{ publicationFamilies: [], recruitmentCampaigns: [] }} />);
    expect(container).toBeEmptyDOMElement();
  });
  it("distinguishes family totals from the current vacancy subset", () => {
    render(<PublicationCampaignContextSection context={{ publicationFamilies: [family], recruitmentCampaigns: [] }} />);
    expect(screen.getByRole("heading", { name: "Technician publications" })).toBeInTheDocument();
    expect(screen.getByText(/4 observations in this family/)).toHaveTextContent("2 from this vacancy");
    expect(screen.getByText("Sources: hellowork.com, indeed.com")).toBeInTheDocument();
    expect(screen.getByText(/First seen:/)).toHaveTextContent(new Date(family.firstSeenAt!).toLocaleDateString());
  });
  it("shows a campaign once with its family and direct-observation paths", () => {
    render(<PublicationCampaignContextSection context={{ publicationFamilies: [family], recruitmentCampaigns: [campaign] }} />);
    expect(screen.getAllByRole("heading", { name: "Campaign c1" })).toHaveLength(1);
    const group = screen.getByRole("article", { name: "Campaign c1" });
    expect(within(group).getByText("Status: ENDED")).toBeInTheDocument();
    expect(within(group).getByText("Related through family f1")).toBeInTheDocument();
    expect(within(group).getByText("Direct observation relationship: a")).toBeInTheDocument();
    expect(within(group).queryByText(/duplicate|applied|recommended|likelihood/i)).not.toBeInTheDocument();
    expect(within(group).queryByText(/Employer:/)).not.toBeInTheDocument();
  });
  it("renders multiple valid families and campaigns with factual counts", () => {
    render(<PublicationCampaignContextSection context={{ publicationFamilies: [family, { ...family, id: "f2", representativeTitle: null }], recruitmentCampaigns: [campaign, { ...campaign, id: "c2", status: "PROBABLY_ACTIVE" }] }} />);
    expect(screen.getByText(/Publication families: 2/)).toHaveTextContent("Recruitment campaigns: 2");
    expect(screen.getByRole("heading", { name: "Family f2" })).toBeInTheDocument();
    expect(screen.getAllByRole("article")).toHaveLength(4);
  });
  it("supports direct-only campaign context", () => {
    render(<PublicationCampaignContextSection context={{ publicationFamilies: [], recruitmentCampaigns: [{ ...campaign, relationshipPaths: [campaign.relationshipPaths[1]!] }] }} />);
    expect(screen.getByText(/Publication families: 0/)).toHaveTextContent("Recruitment campaigns: 1");
    expect(screen.queryByText(/Related through family/)).not.toBeInTheDocument();
  });
});
