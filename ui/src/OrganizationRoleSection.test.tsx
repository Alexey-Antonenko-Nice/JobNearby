import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OrganizationRoleSection } from "./OrganizationRoleSection";
import { decideOrganizationRole, getReview, type ReviewView } from "./api";
import type { HumanOrganizationRole, OrganizationRoleReviewItem } from "../../src/domain/organizations/VacancyOrganizationRoleDecision.js";
vi.mock("./api", () => ({ decideOrganizationRole: vi.fn(), getReview: vi.fn() }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });
function review(role: HumanOrganizationRole = "EMPLOYER"): ReviewView {
  const actions: OrganizationRoleReviewItem["actions"] = (["EMPLOYER","STAFFING_AGENCY","RECRUITER","CLIENT","CONSULTANCY"] as const).map(r => ({ role:r,warning:r===role?null:"This conflicts with current vacancy evidence." }));
  return { vacancy:{canonicalVacancyId:"vacancy"}, organizationRoleReview:[{identityKey:"name:kelly",name:"Kelly",recommendedRole:role,confidence:.98,evidenceStrength:"CONTEXTUAL",reasons:["Corporate-careers tenant","First-person employer wording"],confirmedRole:null,candidateToken:"a".repeat(64),history:[],actions}] } as ReviewView;
}
describe("organization role controls", () => {
  it("shows employer recommendation and every alternative without sending any automatic decision", () => {
    render(<OrganizationRoleSection review={review()} onConfirmed={vi.fn()} disabled={false}/>);
    expect(screen.getByRole("button",{name:"Confirm as employer"})).toBeVisible();
    expect(screen.getByRole("button",{name:"Mark as staffing agency"})).toBeVisible();
    expect(screen.getByRole("button",{name:"Mark as recruiter"})).toBeVisible();
    expect(screen.getByRole("button",{name:"Mark as client"})).toBeVisible();
    expect(screen.getByRole("button",{name:"Mark as consultancy"})).toBeVisible();
    expect(screen.getByText(/98% confidence/)).toBeVisible();
    expect(decideOrganizationRole).not.toHaveBeenCalled();
  });
  it("keeps the employer alternative visible for a staffing recommendation", () => {
    render(<OrganizationRoleSection review={review("STAFFING_AGENCY")} onConfirmed={vi.fn()} disabled={false}/>);
    expect(screen.getByRole("button",{name:"Confirm as staffing agency"})).toBeVisible();
    expect(screen.getByRole("button",{name:"Mark as employer"})).toBeVisible();
  });
  it("saves a recommended role with the current token and refreshes the displayed review", async () => {
    const initial=review(), updated={...initial,organizationRoleReview:initial.organizationRoleReview!.map(c=>({...c,confirmedRole:"EMPLOYER" as const}))}, onConfirmed=vi.fn();
    vi.mocked(decideOrganizationRole).mockResolvedValue(updated);
    render(<OrganizationRoleSection review={initial} onConfirmed={onConfirmed} disabled={false}/>);
    await userEvent.click(screen.getByRole("button",{name:"Confirm as employer"}));
    expect(decideOrganizationRole).toHaveBeenCalledWith("vacancy",expect.objectContaining({identityKey:"name:kelly",candidateToken:"a".repeat(64),role:"EMPLOYER",acknowledgeContradiction:false,requestId:expect.any(String)}));
    expect(onConfirmed).toHaveBeenCalledWith(updated);
  });
  it("requires a warning acknowledgment before saving an alternative and permits cancellation", async () => {
    vi.mocked(decideOrganizationRole).mockResolvedValue(review());
    render(<OrganizationRoleSection review={review()} onConfirmed={vi.fn()} disabled={false}/>);
    await userEvent.click(screen.getByRole("button",{name:"Mark as staffing agency"}));
    expect(decideOrganizationRole).not.toHaveBeenCalled(); expect(screen.getByRole("dialog")).toHaveTextContent("conflicts with current vacancy evidence");
    await userEvent.click(screen.getByRole("button",{name:"Cancel"})); expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button",{name:"Mark as staffing agency"}));
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button",{name:"Confirm override as staffing agency"}));
    expect(decideOrganizationRole).toHaveBeenCalledWith("vacancy",expect.objectContaining({role:"STAFFING_AGENCY",acknowledgeContradiction:true}));
  });
  it("shows coexisting histories while leaving all alternative actions available", () => {
    const initial=review(); const card=initial.organizationRoleReview![0]!;
    render(<OrganizationRoleSection review={{...initial,organizationRoleReview:[{...card,confirmedRole:"EMPLOYER",history:[{role:"EMPLOYER",vacancyId:"other1",recordedAt:"2026-10-22"},{role:"STAFFING_AGENCY",vacancyId:"other2",recordedAt:"2026-10-22"}]}]}} onConfirmed={vi.fn()} disabled={false}/>);
    expect(screen.getByText(/Previously confirmed roles: employer, staffing agency/)).toBeVisible();
    expect(screen.getByRole("button",{name:"Mark as staffing agency"})).toBeEnabled();
  });
  it("refreshes stale evidence and displays the error without retrying the decision", async () => {
    vi.mocked(decideOrganizationRole).mockRejectedValue(Object.assign(Error("Review is stale. Refresh the vacancy."),{status:409}));
    vi.mocked(getReview).mockResolvedValue(review()); const updated=vi.fn();
    render(<OrganizationRoleSection review={review()} onConfirmed={updated} disabled={false}/>);
    await userEvent.click(screen.getByRole("button",{name:"Confirm as employer"}));
    expect(await screen.findByRole("alert")).toHaveTextContent("stale"); expect(getReview).toHaveBeenCalledWith("vacancy");
    expect(decideOrganizationRole).toHaveBeenCalledTimes(1); expect(updated).toHaveBeenCalled();
  });
});
