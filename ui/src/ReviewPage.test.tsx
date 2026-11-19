import { readFileSync } from "node:fs";
import { cleanup, fireEvent, render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ReviewPage } from "./ReviewPage";

const fetchMock = vi.fn<typeof fetch>();
vi.stubGlobal("fetch", fetchMock);

beforeEach(() => window.history.pushState({}, "", "/review/canonical-1"));
afterEach(() => { cleanup(); fetchMock.mockReset(); });

describe("ReviewPage", () => {
  function submitDocumentImport() {
    const button=screen.getByRole("button",{name:"Import immutable version"});
    expect(button).toBeEnabled();
    expect((screen.getByLabelText("Document file (maximum 5 MiB)") as HTMLInputElement).files).toHaveLength(1);
    // user-event sets a DOM FileList shim; jsdom's native required-file validation
    // reads its internal FileList instead. Dispatch the form submit after upload.
    fireEvent.submit(button.closest("form")!);
  }
  function documentReview() {
    const date="2026-11-18T09:00:00.000Z";
    const version=(id:string,documentId:string,versionNumber:number)=>({id,documentId,versionNumber,originalFileName:id+".pdf",mediaType:"application/pdf",sizeBytes:5,contentHash:"a".repeat(64),createdAt:date,integrity:"AVAILABLE" as const});
    return {...review({status:"UNRESOLVED"}),documents:{library:[
      {id:"cv",kind:"CV" as const,name:"Engineering CV",createdAt:date,versions:[version("v1","cv",1),version("v2","cv",2)]},
      {id:"letter",kind:"MOTIVATION_LETTER" as const,name:"Engineering letter",createdAt:date,versions:[version("l1","letter",1)]}
    ],associations:[] as {id:string;canonicalVacancyId:string;documentVersionId:string;createdAt:string;current:boolean}[]}};
  }
  it("hides archived documents from new selection/import while retaining exact selected history and download",async()=>{
    const initial=documentReview(),archived={...initial,documents:{...initial.documents,library:initial.documents.library.map(d=>({...d,archivedAt:d.id==="cv"?"2026-11-18T09:00:00Z":null})),associations:[{id:"a",canonicalVacancyId:"canonical-1",documentVersionId:"v1",createdAt:"2026-11-18T09:00:00Z",current:true}]}};
    respond({review:archived});render(<ReviewPage/>);
    expect(await screen.findByText(/Document archived; selection preserved/)).toBeInTheDocument();
    expect(screen.getByRole("link",{name:"Download selected cv"})).toHaveAttribute("href","http://127.0.0.1:4317/documents/versions/v1/content");
    expect(within(screen.getByLabelText("CV version")).queryByRole("option",{name:/Engineering CV/})).not.toBeInTheDocument();
    await userEvent.click(screen.getByText("Import a document version"));
    expect(within(screen.getByLabelText("Logical document")).queryByRole("option",{name:/Engineering CV/})).not.toBeInTheDocument();
    expect(screen.getByRole("link",{name:"Manage document library"})).toHaveAttribute("href","/documents");
  });
  it("selects CV and motivation-letter versions and retains replaced selections in Review history",async()=>{
    const initial=documentReview(),a=(id:string,version:string,current=true)=>({id,canonicalVacancyId:"canonical-1",documentVersionId:version,createdAt:"2026-11-18T09:00:00.000Z",current});
    const withCv={...initial,documents:{...initial.documents,associations:[a("a1","v1")]}};
    const withLetter={...initial,documents:{...initial.documents,associations:[a("a1","v1"),a("a2","l1")]}};
    const replaced={...initial,documents:{...initial.documents,associations:[a("a1","v1",false),a("a2","l1"),a("a3","v2")]}};
    respond({review:initial});respond({review:withCv});respond({review:withLetter});respond({review:replaced});
    render(<ReviewPage/>);
    await userEvent.selectOptions(await screen.findByLabelText("CV version"),"v1");
    await userEvent.click(screen.getByRole("button",{name:"Select cv version"}));
    expect(await screen.findByText("Selected: Engineering CV — v1")).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText("Motivation letter version"),"l1");
    await userEvent.click(screen.getByRole("button",{name:"Select motivation letter version"}));
    expect(await screen.findByText("Selected: Engineering letter — v1")).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText("CV version"),"v2");await userEvent.click(screen.getByRole("button",{name:"Select cv version"}));
    expect(await screen.findByText("Selected: Engineering CV — v2")).toBeInTheDocument();
    await userEvent.click(screen.getByText("Document association history (3)"));
    expect(screen.getByText(/CV: Engineering CV — v1 — Previously selected/)).toBeInTheDocument();
    expect(screen.getByText(/not proof of sending/)).toBeInTheDocument();
    expect(screen.getByRole("link",{name:"Download selected cv"})).toHaveAttribute("href","http://127.0.0.1:4317/documents/versions/v2/content");
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toMatchObject({versionId:"v1",requestId:expect.any(String)});
  });
  it("imports a first document version and a later version without automatically selecting either",async()=>{
    const initial=documentReview();respond({review:initial});respond({review:initial});respond({review:initial});render(<ReviewPage/>);
    await userEvent.click(await screen.findByText("Import a document version"));
    await userEvent.type(screen.getByLabelText("Document name"),"Technician CV");
    await userEvent.upload(screen.getByLabelText("Document file (maximum 5 MiB)"),new File(["bytes"],"my-cv.pdf",{type:"application/pdf"}));
    submitDocumentImport();
    await waitFor(()=>expect(fetchMock).toHaveBeenCalledTimes(2));
    await waitFor(()=>expect(screen.getByLabelText("Document file (maximum 5 MiB)")).toHaveValue(""));
    expect(fetchMock.mock.calls[1]?.[0]).toContain("/documents/import");
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toMatchObject({kind:"CV",name:"Technician CV",originalFileName:"my-cv.pdf",contentBase64:"Ynl0ZXM="});
    await userEvent.selectOptions(screen.getByLabelText("Logical document"),"cv");
    await userEvent.upload(screen.getByLabelText("Document file (maximum 5 MiB)"),new File(["new"],"new.pdf"));
    submitDocumentImport();
    await waitFor(()=>expect(fetchMock).toHaveBeenCalledTimes(3));
    await waitFor(()=>expect(screen.getByLabelText("Document file (maximum 5 MiB)")).toHaveValue(""));
    expect(JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body))).toMatchObject({documentId:"cv",contentBase64:"bmV3"});
    expect(JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body))).not.toHaveProperty("kind");
  });
  it("retains import identity and file selection after a failed request",async()=>{
    const initial=documentReview();respond({review:initial});fetchMock.mockRejectedValueOnce(Error("Import interrupted"));respond({review:initial});render(<ReviewPage/>);
    await userEvent.click(await screen.findByText("Import a document version"));
    await userEvent.selectOptions(screen.getByLabelText("Document kind"),"MOTIVATION_LETTER");
    await userEvent.type(screen.getByLabelText("Document name"),"Letter");
    await userEvent.upload(screen.getByLabelText("Document file (maximum 5 MiB)"),new File(["letter"],"letter.pdf"));
    submitDocumentImport();
    expect(await screen.findByRole("alert")).toHaveTextContent("Import interrupted");
    submitDocumentImport();
    await waitFor(()=>expect(fetchMock).toHaveBeenCalledTimes(3));
    await waitFor(()=>expect(screen.getByLabelText("Document file (maximum 5 MiB)")).toHaveValue(""));
    expect(fetchMock.mock.calls[1]?.[1]?.body).toBe(fetchMock.mock.calls[2]?.[1]?.body);
  });
  it("shows missing versions without a download link and refuses their selection",async()=>{
    const initial=documentReview();const missing={...initial,documents:{...initial.documents,library:initial.documents.library.map(d=>({...d,versions:d.versions.map(v=>({...v,integrity:"MISSING" as const}))})),associations:[{id:"a",canonicalVacancyId:"canonical-1",documentVersionId:"v1",createdAt:"2026-11-18T09:00:00Z",current:true}]}};
    respond({review:missing});render(<ReviewPage/>);
    expect(await screen.findByText("v1.pdf — MISSING")).toBeInTheDocument();
    expect(screen.queryByRole("link",{name:"Download selected cv"})).not.toBeInTheDocument();
    expect(screen.getByRole("option",{name:/Engineering CV — v1/})).toBeDisabled();
  });

  it("retains a failed note draft and reuses its request identity on retry", async () => {
    const crm={priority:"NONE" as const,notes:[],processState:"DISCOVERED" as const,processTransitions:[]};
    const initial={...review({status:"UNRESOLVED"}),crm};
    respond({review:initial});
    fetchMock.mockRejectedValueOnce(new Error("Connection interrupted"));
    respond({review:{...initial,crm:{...crm,notes:[
      {id:"saved",canonicalVacancyId:"canonical-1",text:"<script>private</script>",createdAt:"2026-11-17T12:00:00Z"}
    ]}}});
    render(<ReviewPage/>);
    await userEvent.type(await screen.findByLabelText("New note"),"<script>private</script>");
    await userEvent.click(screen.getByRole("button",{name:"Add note"}));
    expect(await screen.findByRole("alert")).toHaveTextContent("Connection interrupted");
    expect(screen.getByLabelText("New note")).toHaveValue("<script>private</script>");
    await userEvent.click(screen.getByRole("button",{name:"Add note"}));
    expect(await screen.findByText("<script>private</script>")).toBeInTheDocument();
    expect(fetchMock.mock.calls[1]?.[1]?.body).toEqual(fetchMock.mock.calls[2]?.[1]?.body);
    expect(document.querySelector("script")).toBeNull();
  });

  it("changes private priority and adds chronological notes through Review commands", async () => {
    const crm={priority:"NONE" as const,notes:[],processState:"DISCOVERED" as const,processTransitions:[]};
    const initial={...review({status:"UNRESOLVED"}),crm};
    const prioritized={...initial,crm:{...crm,priority:"HIGH" as const}};
    const noted={...prioritized,crm:{...prioritized.crm,notes:[
      {id:"one",canonicalVacancyId:"canonical-1",text:"Mention commissioning experience",createdAt:"2026-11-17T12:00:00Z"}
    ]}};
    respond({review:initial});respond({review:prioritized});respond({review:noted});
    render(<ReviewPage/>);
    expect(await screen.findByLabelText("Priority")).toHaveValue("NONE");
    await userEvent.selectOptions(screen.getByLabelText("Priority"),"HIGH");
    await userEvent.click(screen.getByRole("button",{name:"Save priority"}));
    expect(fetchMock.mock.calls[1]?.[0]).toContain("/crm/priority");
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({priority:"HIGH"});
    await userEvent.type(screen.getByLabelText("New note"),"Mention commissioning experience");
    await userEvent.click(screen.getByRole("button",{name:"Add note"}));
    expect(await screen.findByText("Mention commissioning experience")).toBeInTheDocument();
    expect(screen.getByLabelText("New note")).toHaveValue("");
    expect(fetchMock.mock.calls[2]?.[0]).toContain("/crm/notes");
    expect(JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body))).toEqual({requestId:expect.any(String),text:"Mention commissioning experience"});
  });

  it("shows process state separately and retries its explicit transition with the same request identity", async () => {
    const crm={priority:"NONE" as const,notes:[],processState:"DISCOVERED" as const,processTransitions:[]};
    const initial={...review({status:"UNRESOLVED"}),crm};
    const updated={...initial,crm:{...crm,processState:"APPLIED" as const,processTransitions:[
      {id:"transition-1",canonicalVacancyId:"canonical-1",fromState:"DISCOVERED",toState:"APPLIED",createdAt:"2026-11-17T12:00:00.000Z"}
    ]}};
    respond({review:initial});
    fetchMock.mockRejectedValueOnce(new Error("Connection interrupted"));
    respond({review:updated});
    render(<ReviewPage/>);
    expect(await screen.findByLabelText("Application process state")).toHaveValue("DISCOVERED");
    await userEvent.selectOptions(screen.getByLabelText("Application process state"),"APPLIED");
    await userEvent.click(screen.getByRole("button",{name:"Save process state"}));
    expect(await screen.findByRole("alert")).toHaveTextContent("Connection interrupted");
    await userEvent.click(screen.getByRole("button",{name:"Save process state"}));
    expect(await screen.findByText("DISCOVERED to APPLIED")).toBeInTheDocument();
    expect(fetchMock.mock.calls[1]?.[0]).toContain("/crm/process-state");
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toMatchObject({requestId:expect.any(String),state:"APPLIED"});
    expect(fetchMock.mock.calls[1]?.[1]?.body).toEqual(fetchMock.mock.calls[2]?.[1]?.body);
    expect(screen.getByText("Interaction history state:",{exact:false})).toHaveTextContent("NEW");
  });

  it("shows saved Dexory qualifications without losing alternatives or optionality", async () => {
    const doc = new DOMParser().parseFromString(readFileSync("tests/fixtures/greenhouseDexory.html", "utf8"), "text/html");
    const lines = [...doc.querySelectorAll(".job__description li")].map(e => e.textContent!.trim());
    const qualification = lines.find(s => s.startsWith("A technical degree"))!;
    const technical = lines.find(s => s.startsWith("Linux and command-line"))!;
    const initial = review({ status: "UNRESOLVED" });
    respond({ review: { ...initial, vacancy: { ...initial.vacancy, title: "Robot Performance Engineer", educationRequirements: [{ rawText: qualification }], skillRequirements: [{ skill: technical, rawText: technical }] }, employer: { ...initial.employer, confirmationCandidate: "Dexory" } } });
    render(<ReviewPage />);
    expect(await screen.findByText(qualification)).toBeInTheDocument();
    expect(screen.getByText(technical)).toBeInTheDocument();
    expect(screen.getByText(/Employer not identified/)).toBeInTheDocument();
    expect(screen.getByText("Dexory")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirm as employer for this vacancy" })).toBeInTheDocument();
  });
  it("confirms an agency through its dedicated action while leaving the employer unresolved", async () => {
    const initial = { ...review({ status: "UNRESOLVED" }), agencyContext: { candidates: [{ candidateId: "agency-candidate", name: "Crit", role: "STAFFING_AGENCY" }], known: [], ambiguousNames: [] } };
    respond({ review: initial });
    respond({ review: { ...initial, agencyContext: { candidates: [], known: [{ name: "Crit", role: "STAFFING_AGENCY", memoryId: "private-memory-id", source: "USER_CONFIRMED" }], ambiguousNames: [] } } });
    render(<ReviewPage />);
    await userEvent.click(await screen.findByRole("button", { name: "Confirm as recruiting agency" }));
    expect(await screen.findByText(/Staffing agency — Confirmed/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Confirm as recruiting agency" })).not.toBeInTheDocument();
    expect(screen.getByText(/Employer not identified/)).toBeInTheDocument();
    expect(screen.queryByText("private-memory-id")).not.toBeInTheDocument();
    expect(fetchMock.mock.calls[1]?.[0]).toContain("/recruiting-agency-confirmation");
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({ candidateId: "agency-candidate" });
  });
  it("shows recognized agency memory without another confirmation or a new human claim", async () => {
    respond({ review: { ...review(), agencyContext: { candidates: [], known: [{ name: "Actual", role: "RECRUITER", memoryId: "memory", source: "AGENCY_MEMORY" }], ambiguousNames: [] } } });
    render(<ReviewPage />);
    expect(await screen.findByText(/Recognized from confirmed agency memory/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Confirm as recruiting agency" })).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("surfaces stale agency confirmation errors", async () => {
    respond({ review: { ...review({ status: "UNRESOLVED" }), agencyContext: { candidates: [{ candidateId: "stale", name: "Crit", role: "STAFFING_AGENCY" }], known: [], ambiguousNames: [] } } });
    respond({ error: "Recruiting agency candidate is no longer eligible for confirmation." }, 409);
    render(<ReviewPage />);
    await userEvent.click(await screen.findByRole("button", { name: "Confirm as recruiting agency" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("no longer eligible");
    expect(screen.getByText(/Employer not identified/)).toBeInTheDocument();
  });
  it("shows earlier compensation separately from the current salary with its observation date", async () => {
    const current = review({ compensation: { minimum: 32000, maximum: 36000, currency: "EUR", period: "YEAR" } });
    respond({ review: { ...current, vacancy: { ...current.vacancy, compensationHistory: [{ sourceObservationId: "old", observedAt: "2026-10-19T10:00:00Z", status: "RESOLVED", values: [{ minimum: 13, currency: "EUR", period: "HOUR" }] }] } } });
    render(<ReviewPage />);
    const history = await screen.findByRole("region", { name: "Compensation history" });
    expect(within(history).getByText(/13 EUR \/ hour/)).toBeInTheDocument();
    expect(history.querySelector("time")).toHaveAttribute("dateTime", "2026-10-19T10:00:00Z");
    expect(within(history).queryByText(/32,000/)).not.toBeInTheDocument();
  });
  it("shows Elite Robots history without a redundant direct employer confirmation", async () => {
    const history = employerHistory();
    respond({ review: { ...review({ status: "PROBABLY_RESOLVED", confirmationCandidate: null, isKnownEmployer: true }),
      employerHistory: { ...history, employerCluster: { id: "elite", displayLabel: "Elite Robots", status: "PROBABLY_RESOLVED" }, knownNames: ["Elite Robots"] } } });
    render(<ReviewPage />);
    const section = await screen.findByRole("region", { name: "Employer history" });
    expect(within(section).getAllByText("Elite Robots").length).toBeGreaterThan(0);
    expect(within(section).getByRole("link", { name: "Technicien itinérant" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Confirm as employer for this vacancy" })).not.toBeInTheDocument();
    expect(screen.queryByText(/Employer candidate:/)).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("integrates persisted publication context into review without implying a prior application", async () => {
    respond({ review: { ...review(), vacancyContext: { ...vacancyContext(), publicationFamilies: [{ id: "f1", representativeTitle: "Related publication", observationCount: 2, currentVacancyObservationCount: 1, currentVacancyObservationIds: ["a"], sourceProviders: ["indeed.com"], firstSeenAt: "2026-09-01T00:00:00Z", lastSeenAt: "2026-09-12T00:00:00Z", membershipEvidence: [] }] } } });
    render(<ReviewPage />);
    const section = await screen.findByRole("region", { name: "Publication and campaign context" });
    expect(within(section).getByText("Related publication")).toBeInTheDocument();
    expect(screen.getByText("No prior actions")).toBeInTheDocument();
    expect(within(section).queryByText(/duplicate|applied/i)).not.toBeInTheDocument();
  });

  it("shows first-time vacancy context with no prior actions", async () => {
    respond({ review: { ...review(), vacancyContext: vacancyContext() } });
    render(<ReviewPage />);
    const section = await screen.findByRole("region", { name: "Vacancy context" });
    expect(within(section).getByText("First time seen")).toBeInTheDocument();
    expect(within(section).getByText("No prior actions")).toBeInTheDocument();
    expect(within(section).getByText("Sources").nextElementSibling).toHaveTextContent("indeed.com");
    expect(within(section).queryByText(/application via/)).not.toBeInTheDocument();
  });
  it("shows multi-source history and factual latest application provenance", async () => {
    respond({ review: { ...review(), vacancyContext: { ...vacancyContext(), seenBefore: true, observationCount: 3, sourceCount: 2,
      sourceProviders: ["hellowork.com", "indeed.com"], appliedBefore: true, latestInteractionType: "APPLIED",
      latestInteractionAt: "2026-09-14T00:00:00Z", appliedViaProvider: "indeed.com", appliedViaSourceObservationId: "a" } } });
    render(<ReviewPage />);
    const section = await screen.findByRole("region", { name: "Vacancy context" });
    expect(within(section).getByText("Seen before").nextElementSibling).toHaveTextContent("yes");
    expect(within(section).getByText("Sources").nextElementSibling).toHaveTextContent("hellowork.com, indeed.com");
    expect(within(section).getByText("Applied", { selector: "dt" }).nextElementSibling).toHaveTextContent("yes");
    expect(within(section).getByText("Latest application via: indeed.com")).toBeInTheDocument();
    expect(within(section).queryByText(/duplicate|campaign|publication family/i)).not.toBeInTheDocument();
  });
  it("shows an application without claiming source provenance", async () => {
    respond({ review: { ...review(), vacancyContext: { ...vacancyContext(), appliedBefore: true, latestInteractionType: "CLOSED", latestInteractionAt: "2026-09-15T00:00:00Z", closedBefore: true } } });
    render(<ReviewPage />);
    const section = await screen.findByRole("region", { name: "Vacancy context" });
    expect(within(section).getByText("Latest action").nextElementSibling).toHaveTextContent("Closed");
    expect(within(section).queryByText(/application via/)).not.toBeInTheDocument();
  });
  it("shows factual employer action context with prior counts and dates", async () => {
    respond({ review: { ...review(), employerHistory: employerHistory(), employerActionContext: actionContext() } });
    render(<ReviewPage />);
    const section = await screen.findByRole("group", { name: "Employer context" });
    expect(within(section).getByText("Applied before").nextElementSibling).toHaveTextContent("Yes · 2");
    expect(within(section).getByText("Contacted before").nextElementSibling).toHaveTextContent("Yes · 1");
    expect(within(section).getByText("Interviewed before").nextElementSibling).toHaveTextContent("Yes · 1");
    expect(within(section).getByText("Rejected before").nextElementSibling).toHaveTextContent("Yes · 1");
    expect(within(section).getByText("Offer before").nextElementSibling).toHaveTextContent("No");
    expect(within(section).getByText("Withdrawn before").nextElementSibling).toHaveTextContent("No");
    expect(within(section).getByText("Last application").nextElementSibling).toHaveTextContent(new Date("2026-08-01T00:00:00Z").toLocaleDateString());
    expect(within(section).getByText("Last interaction").nextElementSibling).toHaveTextContent(`Rejected · ${new Date("2026-08-18T00:00:00Z").toLocaleDateString()}`);
    expect(screen.getByRole("heading", { name: "Previous vacancies" })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("shows the no-prior-interactions state for a known employer", async () => {
    const context = { ...actionContext(), appliedBefore: false, applicationCount: 0, contactedBefore: false, contactCount: 0,
      interviewedBefore: false, interviewCount: 0, rejectedBefore: false, rejectionCount: 0,
      lastApplicationAt: null, lastInteractionAt: null, lastInteractionType: null };
    respond({ review: { ...review(), employerHistory: { ...employerHistory(), vacancies: [], summary: { ...employerHistory().summary, vacancyCount: 0 } }, employerActionContext: context } });
    render(<ReviewPage />);
    expect(await screen.findByText("No previous applications or interactions with this employer.")).toBeInTheDocument();
    const section = screen.getByRole("group", { name: "Employer context" });
    expect(within(section).queryByText("Applied before")).not.toBeInTheDocument();
  });

  it("displays CLOSED neutrally and no application date when there was no application", async () => {
    respond({ review: { ...review(), employerHistory: employerHistory(), employerActionContext: {
      ...actionContext(), appliedBefore: false, applicationCount: 0, lastApplicationAt: null, rejectedBefore: false, rejectionCount: 0, lastInteractionType: "CLOSED",
    } } });
    render(<ReviewPage />);
    const section = await screen.findByRole("group", { name: "Employer context" });
    expect(within(section).getByText("Last interaction").nextElementSibling).toHaveTextContent("Closed");
    expect(within(section).getByText("Last application").nextElementSibling).toHaveTextContent("None");
    expect(within(section).getByText("Rejected before").nextElementSibling).toHaveTextContent("No");
  });

  it("shows compact previous employer history with outcomes, aliases, and recruiter context", async () => {
    respond({ review: { ...review({ organizations: { recruiters: [{ rawName: "ACTUA Saverne", role: "RECRUITER" }] } }), employerHistory: employerHistory() } });
    render(<ReviewPage />);
    const section = await screen.findByRole("region", { name: "Employer history" });
    expect(within(section).getByRole("heading", { name: "HEUFT" })).toBeInTheDocument();
    expect(within(section).getByText("Applications").nextElementSibling).toHaveTextContent("1");
    expect(within(section).getByText("Previous vacancies", {selector:"dt"}).nextElementSibling).toHaveTextContent("3");
    expect(within(section).getByRole("link", { name: "Technicien itinérant" })).toHaveAttribute("href", "/review/previous-1");
    expect(within(section).getByText(/Applied · Interviewed · Rejected/)).toBeInTheDocument();
    expect(within(section).getByText(/Strasbourg — Indeed — Rejected/)).toBeInTheDocument();
    expect(within(section).getByText("Current vacancy via: ACTUA Saverne")).toBeInTheDocument();
    expect(within(section).getByText("HEUFT France")).toBeInTheDocument();
    expect(within(section).queryByText("Developer")).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("keeps employer identity and known names visible with no previous vacancies", async () => {
    const history = employerHistory();
    respond({ review: { ...review(), employerHistory: { ...history, vacancies: [], summary: { ...history.summary, vacancyCount: 0 } } } });
    render(<ReviewPage />);
    expect(await screen.findByText("No previous vacancies with this employer.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Known names" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Previous roles" })).not.toBeInTheDocument();
  });

  it.each(["UNRESOLVED", "CONFLICTED"])("does not present authoritative history for %s", async (status) => {
    respond({ review: review({ status }) }); render(<ReviewPage />);
    await screen.findByRole("region", { name: "Employer status" });
    expect(screen.queryByRole("heading", { name: "Employer history" })).not.toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Employer context" })).not.toBeInTheDocument();
    if (status === "CONFLICTED") expect(screen.getByText(/Employer needs review/)).toBeInTheDocument();
  });

  it("shows absent previous interaction without substituting capture date", async () => {
    const history = employerHistory();
    respond({ review: { ...review(), employerHistory: { ...history, summary: { ...history.summary, latestUserInteractionAt: null } } } });
    render(<ReviewPage />);
    expect(await screen.findByText("Last interaction: No previous interactions")).toBeInTheDocument();
  });

  it.each([["Confirm as employer for this vacancy", "CONFIRM"], ["Not the employer", "REJECT"]])("reviews HEUFT named client with %s while ACTUA is not offered", async (label, decision) => {
    const base = review({ employerClusterId: null, status: "UNRESOLVED", confirmationCandidate: null, organizations: { employerRelationships: [], displayedCompanies: [{ role: "DISPLAYED_COMPANY", rawName: "ACTUA SAVERNE" }], recruiters: [{ role: "RECRUITER", rawName: "ACTUA Saverne" }], clients: [{ role: "CLIENT", rawName: "HEUFT France" }] } });
    respond({ review: { ...base, employerReview: { required: true, candidates: [{ type: "NAMED_CLIENT", candidateId: "client-token", name: "HEUFT France", sourceRelationship: "CLIENT", employerClusterId: null, priorConfirmationCount: 0, explanation: "ACTUA Saverne is recruiting for the named client HEUFT France." }] } } });
    respond({ review: base });
    const user = userEvent.setup(); render(<ReviewPage />);
    expect(await screen.findByRole("heading", { name: "Possible employer" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "HEUFT France" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Confirm as employer for this vacancy" })).toHaveLength(1);
    expect(screen.queryByText(/Employer candidate:/)).not.toBeInTheDocument();
    expect(screen.getByText("Source relationship: Client named in vacancy")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: label }));
    expect(fetchMock.mock.calls[1]![0]).toContain("/employer-review");
    expect(JSON.parse(fetchMock.mock.calls[1]![1]!.body as string)).toEqual({ type: "NAMED_CLIENT", candidateId: "client-token", decision });
    expect(screen.queryByRole("heading", { name: "Possible employer" })).not.toBeInTheDocument();
    expect(screen.getByText("HEUFT France")).toBeInTheDocument();
  });

  it.each([ ["Confirm as employer for this vacancy", "CONFIRM"], ["Not this employer", "REJECT"] ])("reviews a remembered employer using %s", async (label, decision) => {
    respond({ review: { ...review(), employerMemoryReview: { required: true, candidates: [{ employerClusterId: "memory-a", displayLabel: "ACME", status: "PROBABLY_RESOLVED", priorConfirmationCount: 2, explanation: "Multiple confirmed clusters match." }] } } });
    respond({ review: review() });
    const user = userEvent.setup(); render(<ReviewPage />);
    expect(await screen.findByText("Possible known employer")).toBeInTheDocument();
    expect(screen.getByText("Prior confirmation history: 2 observations. This does not confirm the employer role for this vacancy.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: label }));
    expect(fetchMock.mock.calls[1]![0]).toContain("/employer-memory-review");
    expect(JSON.parse(fetchMock.mock.calls[1]![1]!.body as string)).toEqual({ employerClusterId: "memory-a", decision });
    expect(screen.queryByText("Possible known employer")).not.toBeInTheDocument();
  });

  it("loads a NEW vacancy without creating an interaction", async () => {
    respond({ review: review() });
    render(<ReviewPage />);
    expect(await screen.findByText("Interaction history state:", { exact: false })).toHaveTextContent("NEW");
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
    expect(await screen.findByText("Interaction history state:", { exact: false })).toHaveTextContent("REVIEWED");
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
    expect(await screen.findByText("Interaction history state:", { exact: false })).toHaveTextContent("REVIEWED");
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

  it("displays language requirements from the vacancy", async () => {
    respond({ review: { ...review(), vacancy: { ...review().vacancy, languageRequirements: [{ language: "English", requirement: "REQUIRED", rawText: "Vous maîtrisez l'anglais professionnel" }, { language: "German", requirement: "UNKNOWN" }] } } });
    render(<ReviewPage />);
    expect(await screen.findByText("English — Required; German — Requirement not stated")).toBeInTheDocument();
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
    expect(screen.getByText("12.66–0 EUR / hour")).toBeInTheDocument();
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

  it("displays Bürkert title, company, and location", async () => {
    respond({ review: review({
      title: "Teamleiter Kunststofftechnik (m/w/d)",
      location: { rawText: "Ingelfingen-Criesbach" },
      organizations: { employerRelationships: [{ role: "EMPLOYER", rawName: "Bürkert Fluid Control Systems" }], displayedCompanies: [{ role: "DISPLAYED_COMPANY", rawName: "Bürkert Fluid Control Systems" }], recruiters: [], consultancies: [], staffingAgencies: [], clients: [], otherRelationships: [] },
    }) });
    render(<ReviewPage />);
    expect(await screen.findByText("Teamleiter Kunststofftechnik (m/w/d)")).toBeInTheDocument();
    expect(screen.getByText("Ingelfingen-Criesbach")).toBeInTheDocument();
    expect(screen.getAllByText("Bürkert Fluid Control Systems").length).toBeGreaterThan(0);
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
    expect(await screen.findByText(/Employer not identified/)).toBeInTheDocument();
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
    expect(screen.getByText(/Employer not identified/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Confirm as employer for this vacancy" })).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("offers and submits a clean employer confirmation candidate", async () => {
    respond({ review: review({ confirmationCandidate: "Air Products S.A.S (FR)" }) });
    respond({ review: review({ confirmationCandidate: null, status: "PROBABLY_RESOLVED", displayState: "HUMAN_CONFIRMED" }) });
    const user = userEvent.setup(); render(<ReviewPage />);
    expect(await screen.findByText(/Employer candidate:/u)).toHaveTextContent("Air Products S.A.S (FR)");
    await user.click(screen.getByRole("button", { name: "Confirm as employer for this vacancy" }));
    expect(fetchMock.mock.calls[1]![0]).toContain("/employer-confirmation");
    expect(await screen.findByText(/Confirmed for this vacancy/)).toBeInTheDocument();
  });

  it("renders known-employer history signals", async () => {
    respond({ review: review({ isKnownEmployer: true, previouslyAppliedToEmployer: true }) }); render(<ReviewPage />);
    expect(await screen.findByText("Prior employer history available")).toBeInTheDocument();
    expect(screen.getAllByText("Previously applied to employer")).toHaveLength(2);
  });

  it("keeps recruiter and consultancy separate from employer", async () => {
    respond({ review: review() }); render(<ReviewPage />);
    expect(await screen.findByText("Actual employer")).toBeInTheDocument();
    expect(screen.getByText("Recruiter name")).toBeInTheDocument();
    expect(screen.getByText("Consultancy name")).toBeInTheDocument();
  });

  it("shows memory reuse without claiming confirmation, then submits a vacancy-specific role decision", async () => {
    const current = review({ displayState: "MEMORY_REUSED", displayName: "Airbus" });
    const card = {
      identityKey: "name:airbus", name: "Airbus", recommendedRole: "EMPLOYER", confidence: 1,
      evidenceStrength: "EXPLICIT", reasons: [], confirmedRole: null, candidateToken: "token",
      history: [], actions: ["EMPLOYER", "STAFFING_AGENCY", "RECRUITER", "CLIENT", "CONSULTANCY"].map((role) => ({ role, warning: null })),
    };
    const initial = { ...current, organizationRoleReview: [card] };
    const updated = {
      ...initial,
      employer: { ...initial.employer, displayState: "HUMAN_CONFIRMED" },
      organizationRoleReview: [{ ...card, confirmedRole: "EMPLOYER" }],
    };
    respond({ review: initial });
    respond({ review: updated });
    const user = userEvent.setup();
    render(<ReviewPage />);
    expect(await screen.findByText(/Airbus — Recognized from prior employer knowledge/)).toBeInTheDocument();
    expect(screen.getByText(/Not yet confirmed for this vacancy/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirm as employer for this vacancy" })).toBeEnabled();
    expect(screen.queryByText("Confirmed for this vacancy: employer")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Confirm as employer for this vacancy" }));
    expect(await screen.findByText("Confirmed for this vacancy: employer")).toBeInTheDocument();
    expect(fetchMock.mock.calls[1]?.[0]).toContain("/organization-role-decisions");
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual(expect.objectContaining({
      identityKey: "name:airbus", role: "EMPLOYER", candidateToken: "token", acknowledgeContradiction: false,
    }));
  });

  it("labels automatic recognition as unconfirmed while keeping explicit confirmation available", async () => {
    const current = review({ displayState: "INFERRED", displayName: "Airbus" });
    respond({ review: { ...current, organizationRoleReview: [{
      identityKey: "name:airbus", name: "Airbus", recommendedRole: "EMPLOYER", confidence: 1,
      evidenceStrength: "EXPLICIT", reasons: [], confirmedRole: null, candidateToken: "token",
      history: [], actions: ["EMPLOYER", "STAFFING_AGENCY", "RECRUITER", "CLIENT", "CONSULTANCY"].map((role) => ({ role, warning: null })),
    }] } });
    render(<ReviewPage />);
    expect(await screen.findByText(/Airbus — Automatically recognized/)).toBeInTheDocument();
    expect(screen.getByText(/Not yet confirmed for this vacancy/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirm as employer for this vacancy" })).toBeEnabled();
    expect(screen.queryByText("Confirmed for this vacancy: employer")).not.toBeInTheDocument();
  });

  it("keeps ambiguous employer evidence under review without selecting a candidate", async () => {
    const current = review({ status: "UNRESOLVED", displayState: "REVIEW_REQUIRED", displayName: null });
    respond({ review: { ...current, organizationRoleReview: [{
      identityKey: "name:airbus", name: "Airbus", recommendedRole: "UNKNOWN", confidence: 0,
      evidenceStrength: "UNKNOWN", reasons: [], confirmedRole: null, candidateToken: "token",
      history: [], actions: ["EMPLOYER", "STAFFING_AGENCY", "RECRUITER", "CLIENT", "CONSULTANCY"].map((role) => ({ role, warning: null })),
    }] } });
    render(<ReviewPage />);
    expect(await screen.findByText("Employer needs review")).toBeInTheDocument();
    expect(screen.getByText("Employer candidates need review; no candidate is selected here.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirm as employer for this vacancy" })).toBeEnabled();
    expect(screen.queryByText("Confirmed for this vacancy: employer")).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
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
  const employer = { employerClusterId: "cluster-1", status: "RESOLVED", displayState: "INFERRED" as string, displayName: "Actual employer" as string | null, resolvedEmployerId: "employer-1", knownBefore: false, previousVacancyCount: 0, previousInteractedVacancyCount: 0, everAppliedToEmployer: false, everInterviewedWithEmployer: false, everRejectedByEmployer: false };
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
  if (!("displayState" in overrides)) employer.displayState = employer.status === "CONFLICTED"
    ? "REVIEW_REQUIRED"
    : employer.status === "UNRESOLVED" || employer.employerClusterId === null ? "UNRESOLVED" : "INFERRED";
  if (!("displayName" in overrides)) employer.displayName = employer.employerClusterId === null ? null : "Actual employer";
  return { vacancy, user, employer, organizations, recognition, reviewSignals };
}
function employerHistory() {
  return {
    employerCluster: { id: "heuft", displayLabel: "HEUFT", status: "PROBABLY_RESOLVED" }, knownNames: ["HEUFT", "HEUFT France"],
    summary: { vacancyCount: 3, everAppliedCount: 1, everInterviewedCount: 1, everOfferedCount: 0, everRejectedCount: 1, latestUserInteractionAt: "2026-08-18T00:00:00Z" },
    vacancies: ["Technicien itinérant", "Mécanicien monteur", "Mécanicien Monteur d'Équipements Industriels"].map((title, index) => ({
      canonicalVacancyId: `previous-${index + 1}`, title, location: { rawText: "Strasbourg" }, sources: ["Indeed"], currentUserState: index === 0 ? "REJECTED" : "NEW",
      lastUserInteractionAt: index === 0 ? "2026-08-18T00:00:00Z" : null, everApplied: index === 0, everInterviewed: index === 0,
      everRejected: index === 0, everOffered: false, everContacted: false, everWithdrawn: false,
    })),
  };
}

function actionContext() {
  return { knownEmployer: true, appliedBefore: true, applicationCount: 2, contactedBefore: true, contactCount: 1,
    interviewedBefore: true, interviewCount: 1, offeredBefore: false, offerCount: 0, rejectedBefore: true, rejectionCount: 1,
    withdrawnBefore: false, withdrawalCount: 0, lastApplicationAt: "2026-08-01T00:00:00Z", lastInteractionAt: "2026-08-18T00:00:00Z", lastInteractionType: "REJECTED" };
}

function vacancyContext(): import("./api").VacancyContext {
  return { publicationFamilies: [], recruitmentCampaigns: [], currentCanonicalVacancyId: "canonical-1", seenBefore: false, observationCount: 1, sourceCount: 1,
    sourceProviders: ["indeed.com"], firstSeenAt: "2026-09-12T00:00:00Z", lastSeenAt: "2026-09-12T00:00:00Z",
    currentSourceObservationId: null, currentSourceProvider: null, reviewedBefore: false, interestedBefore: false,
    appliedBefore: false, contactedBefore: false, interviewedBefore: false, offeredBefore: false, rejectedBefore: false,
    withdrawnBefore: false, closedBefore: false, latestInteractionType: null, latestInteractionAt: null,
    appliedViaProvider: null, appliedViaSourceObservationId: null };
}

describe("Review next actions",()=>{
  const instant="2026-11-17T12:00:00.000Z";
  function action(status:"ACTIVE"|"COMPLETED"|"CANCELLED"="ACTIVE") {
    return {id:"action",canonicalVacancyId:"canonical-1",description:"Send follow-up",createdAt:instant,
      dueAt:"2026-11-16T12:00:00.000Z",completedAt:status==="COMPLETED"?instant:null,cancelledAt:status==="CANCELLED"?instant:null,
      status,dueState:status==="ACTIVE"?"OVERDUE":"INACTIVE",reminderDue:status==="ACTIVE",
      reminders:[{id:"r",actionId:"action",createdAt:instant,remindAt:"2026-11-16T09:00:00.000Z",dismissedAt:null,supersededAt:null}],
      changes:[{id:"action",kind:"CREATE",createdAt:instant,dueAt:null,remindAt:null,reminderId:null}]};
  }
  function view(actions:ReturnType<typeof action>[] = []) {
    return {...review({status:"UNRESOLVED"}),nextActions:{evaluatedAt:instant,actions,overdueCount:actions.filter(a=>a.dueState==="OVERDUE").length}};
  }
  it("creates an action with optional due time and completes it while retaining history",async()=>{
    respond({review:view()});respond({review:view([action()])});respond({review:view([action("COMPLETED")])});
    render(<ReviewPage/>);
    await userEvent.type(await screen.findByLabelText("Next action description"),"Send follow-up");
    await userEvent.click(screen.getByRole("button",{name:"Create action"}));
    expect(await screen.findByRole("article",{name:"Send follow-up"})).toBeInTheDocument();
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toMatchObject({description:"Send follow-up",dueAt:null,requestId:expect.any(String)});
    await userEvent.click(screen.getByRole("button",{name:"Complete action"}));
    expect(await screen.findByText("Completed",{exact:true})).toBeInTheDocument();
    expect(screen.queryByRole("button",{name:"Complete action"})).not.toBeInTheDocument();
    expect(screen.getByRole("article",{name:"Send follow-up"})).toBeInTheDocument();
    expect(fetchMock.mock.calls[2]?.[0]).toContain("/actions/action/complete");
  });
  it("cancels an action into visible history",async()=>{
    respond({review:view([action()])});respond({review:view([action("CANCELLED")])});
    render(<ReviewPage/>);
    await userEvent.click(await screen.findByRole("button",{name:"Cancel action"}));
    expect(await screen.findByText("Cancelled",{exact:true})).toBeInTheDocument();
    expect(screen.queryByRole("button",{name:"Cancel action"})).not.toBeInTheDocument();
    expect(fetchMock.mock.calls[1]?.[0]).toContain("/actions/action/cancel");
  });
  it("uses server-derived overdue/reminder states and supports explicit refresh",async()=>{
    respond({review:view([action()])});
    const fresh={...action(),dueState:"UPCOMING",reminderDue:false};
    respond({review:view([fresh])});
    render(<ReviewPage/>);
    expect(await screen.findByText(/Active — Overdue/)).toBeInTheDocument();
    expect(screen.getByText(/^Reminder due:/)).toBeInTheDocument();
    expect(screen.getByText(/No desktop notifications/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button",{name:"Refresh action status"}));
    expect(await screen.findByText(/Active — Upcoming/)).toBeInTheDocument();
    expect(screen.getByText(/^Reminder scheduled:/)).toBeInTheDocument();
  });
  it("reschedules and sets/dismisses a separate reminder using UTC instants",async()=>{
    const initial=view([action()]);
    respond({review:initial});respond({review:initial});respond({review:initial});
    const dismissed={...action(),reminderDue:false,reminders:action().reminders.map(r=>({...r,dismissedAt:instant}))};
    respond({review:view([dismissed])});
    render(<ReviewPage/>);
    await userEvent.click(await screen.findByText("Due date and reminder",{exact:true}));
    fireEvent.change(screen.getByLabelText("New due date and time"),{target:{value:"2026-11-20T09:00"}});
    await userEvent.click(screen.getByRole("button",{name:"Reschedule action"}));
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body)).dueAt).toBe(new Date("2026-11-20T09:00").toISOString());
    fireEvent.change(screen.getByLabelText("Reminder date and time"),{target:{value:"2026-11-19T09:00"}});
    await userEvent.click(screen.getByRole("button",{name:"Set reminder"}));
    expect(JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body)).remindAt).toBe(new Date("2026-11-19T09:00").toISOString());
    await userEvent.click(screen.getByRole("button",{name:"Dismiss reminder"}));
    expect(await screen.findByText(/^Reminder dismissed:/)).toBeInTheDocument();
    expect(JSON.parse(String(fetchMock.mock.calls[3]?.[1]?.body)).reminderId).toBe("r");
  });
  it("retains failed drafts and reuses creation request IDs on retry",async()=>{
    respond({review:view()});fetchMock.mockRejectedValueOnce(new Error("Offline"));respond({review:view([action()])});
    render(<ReviewPage/>);
    await userEvent.type(await screen.findByLabelText("Next action description"),"Send follow-up");
    await userEvent.click(screen.getByRole("button",{name:"Create action"}));
    expect(await screen.findByRole("alert")).toHaveTextContent("Offline");
    expect(screen.getByLabelText("Next action description")).toHaveValue("Send follow-up");
    await userEvent.click(screen.getByRole("button",{name:"Create action"}));
    expect(await screen.findByRole("article",{name:"Send follow-up"})).toBeInTheDocument();
    expect(fetchMock.mock.calls[1]?.[1]?.body).toEqual(fetchMock.mock.calls[2]?.[1]?.body);
  });
});


describe("Contact-linked Review activity",()=>{
 const instant="2026-11-19T12:00:00.000Z";
 function view(){
   const person=(id:string,archived=false,ended=false)=>({id,displayName:"Person "+id,jobTitle:"",notes:"",createdAt:instant,archivedAt:archived?instant:null,methods:[],relationships:[{id:"link-"+id,contactId:id,canonicalVacancyId:"canonical-1",role:"RECRUITER",createdAt:instant,endedAt:ended?instant:null}]});
   const library=[person("active"),person("archived",true),person("ended",false,true)];
   return {...review({status:"UNRESOLVED"}),contacts:{library,relationships:library.flatMap(c=>c.relationships)},interactions:[],nextActions:{evaluatedAt:instant,actions:[],overdueCount:0}};
 }
 it("selects a linked contact when recording an interaction and displays resolved history",async()=>{
   const initial=view();respond({review:initial});respond({review:{...initial,interactions:[{id:"event",type:"CONTACTED",occurredAt:instant,recordedAt:instant,contactId:"active",contact:{id:"active",displayName:"Current name",archived:false},metadata:{contactMethod:"PHONE",direction:"INBOUND"}}]}});
   render(<ReviewPage/>);await userEvent.selectOptions(await screen.findByLabelText("Interaction contact (optional)"),"active");
   expect(screen.getByRole("button",{name:"REVIEWED"})).toBeDisabled();await userEvent.click(screen.getByRole("button",{name:"CONTACTED"}));
   expect(JSON.parse(fetchMock.mock.calls[1]![1]!.body as string)).toMatchObject({type:"CONTACTED",contactId:"active",requestId:expect.any(String)});
   const history=await screen.findByRole("region",{name:"Interaction history"});expect(history).toHaveTextContent("Current name");expect(history).toHaveTextContent("PHONE");
 });
 it("excludes archived and ended links from both new selection lists",async()=>{respond({review:view()});render(<ReviewPage/>);for(const label of ["Interaction contact (optional)","Action contact (optional)"]){const select=await screen.findByLabelText(label);expect(within(select).getAllByRole("option")).toHaveLength(2);expect(within(select).queryByRole("option",{name:/archived|ended/})).toBeNull();}});
 it("creates an action with explicit contact without changing reminder semantics",async()=>{
   const initial=view();respond({review:initial});respond({review:{...initial,nextActions:{evaluatedAt:instant,overdueCount:1,actions:[{id:"action",description:"Call person",createdAt:instant,dueAt:instant,completedAt:null,cancelledAt:null,status:"ACTIVE",dueState:"OVERDUE",reminderDue:true,contactId:"active",contact:{id:"active",displayName:"Person active",archived:false},reminders:[{id:"r",remindAt:instant,dismissedAt:null,supersededAt:null}],changes:[]}]}}});
   render(<ReviewPage/>);await userEvent.type(await screen.findByLabelText("Next action description"),"Call person");await userEvent.selectOptions(screen.getByLabelText("Action contact (optional)"),"active");await userEvent.click(screen.getByRole("button",{name:"Create action"}));
   expect(JSON.parse(fetchMock.mock.calls[1]![1]!.body as string)).toMatchObject({description:"Call person",contactId:"active",requestId:expect.any(String)});const card=await screen.findByRole("article",{name:"Call person"});expect(card).toHaveTextContent("Contact: Person active");expect(card).toHaveTextContent("Overdue");expect(card).toHaveTextContent("Reminder due");
 });
 it("displays archived/ended contacts on existing interactions and completed actions",async()=>{
   const initial=view(),contact={id:"archived",displayName:"Historical person",archived:true};respond({review:{...initial,interactions:[{id:"e",type:"INTERVIEW",occurredAt:instant,contact}],nextActions:{evaluatedAt:instant,overdueCount:0,actions:[{id:"a",description:"Follow-up completed",contact,status:"COMPLETED",dueState:"INACTIVE",createdAt:instant,dueAt:null,completedAt:instant,cancelledAt:null,reminders:[],changes:[]}]}}});render(<ReviewPage/>);
   expect(await screen.findByRole("region",{name:"Interaction history"})).toHaveTextContent("Historical person (Archived contact)");expect(screen.getByRole("article",{name:"Follow-up completed"})).toHaveTextContent("Historical person (Archived contact)");
 });
 it("retries the same interaction request after a failed response",async()=>{respond({review:view()});fetchMock.mockRejectedValueOnce(new Error("Offline"));respond({review:view()});render(<ReviewPage/>);await userEvent.selectOptions(await screen.findByLabelText("Interaction contact (optional)"),"active");await userEvent.click(screen.getByRole("button",{name:"CONTACTED"}));expect(await screen.findByRole("alert")).toHaveTextContent("Offline");await userEvent.click(screen.getByRole("button",{name:"CONTACTED"}));expect(fetchMock.mock.calls[1]![1]!.body).toBe(fetchMock.mock.calls[2]![1]!.body);});
});

it("Review renders projected activity alongside existing management sections",async()=>{
 const initial={...review({status:"UNRESOLVED"}),activityTimeline:[{id:"note:n",vacancyId:"canonical-1",kind:"NOTE",occurredAt:"2026-11-19T12:00:00.000Z",title:"Note",summary:"Timeline context",details:[],source:{model:"VacancyNote",recordId:"n"}}]};
 respond({review:initial});render(<ReviewPage/>);expect(await screen.findByRole("region",{name:"Vacancy activity timeline"})).toHaveTextContent("Timeline context");expect(screen.getByRole("button",{name:"CONTACTED"})).toBeEnabled();
});
