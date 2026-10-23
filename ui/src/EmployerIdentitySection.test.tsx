import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EmployerIdentitySection } from "./EmployerIdentitySection";
import { decideEmployerIdentity, getReview, searchEmployerIdentities, type ReviewView } from "./api";
vi.mock("./api",()=>({decideEmployerIdentity:vi.fn(),getReview:vi.fn(),searchEmployerIdentities:vi.fn()}));
afterEach(()=>{cleanup();vi.resetAllMocks();});
const review=()=>({vacancy:{canonicalVacancyId:"french"},employerIdentityReview:{currentClusterId:"separate",employerName:"Alstom",candidates:[{employerClusterId:"known",displayLabel:"Alstom",candidateToken:"a".repeat(64),keptSeparate:false,advisoryReasons:["Matching organization name (advisory only).","Shared source domain (advisory only)."],priorVacancies:[{canonicalVacancyId:"english",title:"Software Developer",location:"Charleroi, BE"}]}]}} as ReviewView);
describe("separate employer identity controls",()=>{
  it("shows prior vacancy and location after employer role confirmation without making an automatic choice",()=>{
    render(<EmployerIdentitySection review={review()} onConfirmed={vi.fn()} disabled={false}/>);
    expect(screen.getByRole("link",{name:"Software Developer"})).toHaveAttribute("href","/vacancies/english/review");
    expect(screen.getByText(/Charleroi, BE/)).toBeVisible();
    expect(screen.getByText(/Matching names and careers domains are clues only/)).toBeVisible();
    expect(screen.getByRole("button",{name:"Use this existing identity"})).toBeEnabled();
    expect(screen.getByRole("button",{name:"Keep separate"})).toBeEnabled();
    expect(decideEmployerIdentity).not.toHaveBeenCalled();
  });
  it("requires explicit identity confirmation and supports cancel",async()=>{
    vi.mocked(decideEmployerIdentity).mockResolvedValue(review());const updated=vi.fn();
    render(<EmployerIdentitySection review={review()} onConfirmed={updated} disabled={false}/>);
    await userEvent.click(screen.getByRole("button",{name:"Use this existing identity"}));
    expect(decideEmployerIdentity).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button",{name:"Cancel"}));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button",{name:"Use this existing identity"}));
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button",{name:"Confirm existing identity"}));
    expect(decideEmployerIdentity).toHaveBeenCalledWith("french",expect.objectContaining({decision:"USE_EXISTING",employerClusterId:"known",candidateToken:"a".repeat(64)}));
    expect(updated).toHaveBeenCalled();
  });
  it("records Keep separate independently of role confirmation",async()=>{
    vi.mocked(decideEmployerIdentity).mockResolvedValue(review());
    render(<EmployerIdentitySection review={review()} onConfirmed={vi.fn()} disabled={false}/>);
    await userEvent.click(screen.getByRole("button",{name:"Keep separate"}));
    expect(decideEmployerIdentity).toHaveBeenCalledWith("french",expect.objectContaining({decision:"KEEP_SEPARATE"}));
  });
  it("keeps the explicit use action available after Keep separate",()=>{
    const r=review();const identity=r.employerIdentityReview!;
    render(<EmployerIdentitySection review={{...r,employerIdentityReview:{...identity,candidates:identity.candidates.map(c=>({...c,keptSeparate:true}))}}} onConfirmed={vi.fn()} disabled={false}/>);
    expect(screen.getByRole("button",{name:"Keep separate"})).toBeDisabled();
    expect(screen.getByRole("button",{name:"Use this existing identity"})).toBeEnabled();
  });
  it("refreshes stale identity context without retrying the decision",async()=>{
    vi.mocked(decideEmployerIdentity).mockRejectedValue(Object.assign(Error("Employer identity review is stale. Refresh the vacancy."),{status:409}));
    vi.mocked(getReview).mockResolvedValue(review());const updated=vi.fn();
    render(<EmployerIdentitySection review={review()} onConfirmed={updated} disabled={false}/>);
    await userEvent.click(screen.getByRole("button",{name:"Keep separate"}));
    expect(await screen.findByRole("alert")).toHaveTextContent("stale");
    expect(decideEmployerIdentity).toHaveBeenCalledTimes(1);expect(getReview).toHaveBeenCalledWith("french");expect(updated).toHaveBeenCalled();
  });
  it("lists no confirmed employer by default and shows searched identities only after an explicit search",async()=>{
    const r=review();const identity=r.employerIdentityReview!;
    vi.mocked(searchEmployerIdentities).mockResolvedValue({...identity,candidates:[{...identity.candidates[0]!,employerClusterId:"other",displayLabel:"Siemens Mobility",advisoryReasons:["Previously confirmed employer identity. Confirm that it is the same employer before using it."]}]});
    render(<EmployerIdentitySection review={{...r,employerIdentityReview:{...identity,candidates:[]}}} onConfirmed={vi.fn()} disabled={false}/>);
    expect(screen.getByText(/No suggested identities/)).toBeVisible();
    expect(screen.queryByRole("button",{name:"Use this existing identity"})).not.toBeInTheDocument();
    expect(screen.getByRole("button",{name:"Search identities"})).toBeDisabled();
    await userEvent.type(screen.getByLabelText(/Search another confirmed identity/),"siemens");
    await userEvent.click(screen.getByRole("button",{name:"Search identities"}));
    expect(searchEmployerIdentities).toHaveBeenCalledWith("french","siemens");
    expect(await screen.findByRole("article",{name:"Existing identity: Siemens Mobility"})).toBeVisible();
    expect(screen.getByRole("button",{name:"Keep separate"})).toBeEnabled();
    expect(decideEmployerIdentity).not.toHaveBeenCalled();
  });
  it("disables decisions during another page action",()=>{
    render(<EmployerIdentitySection review={review()} onConfirmed={vi.fn()} disabled={true}/>);
    expect(screen.getByRole("button",{name:"Use this existing identity"})).toBeDisabled();
    expect(screen.getByRole("button",{name:"Keep separate"})).toBeDisabled();
  });
});
