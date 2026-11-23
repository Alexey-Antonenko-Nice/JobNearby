import { cleanup, fireEvent, render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DocumentLibraryPage } from "./DocumentLibraryPage";
import type { DocumentLibrary } from "./api";

const fetchMock=vi.fn<typeof fetch>();vi.stubGlobal("fetch",fetchMock);
afterEach(()=>{cleanup();fetchMock.mockReset();});
const date="2026-11-18T09:00:00.000Z";
function fixture():DocumentLibrary {
  return [
    {id:"cv",kind:"CV",name:"Engineering CV",createdAt:date,archivedAt:null,versions:[
      {id:"v1",documentId:"cv",versionNumber:1,originalFileName:"old.pdf",mediaType:null,sizeBytes:100,contentHash:"a".repeat(64),createdAt:date,integrity:"AVAILABLE",referenceCount:2,currentReferenceCount:1},
      {id:"v2",documentId:"cv",versionNumber:2,originalFileName:"new.pdf",mediaType:null,sizeBytes:200,contentHash:"b".repeat(64),createdAt:date,integrity:"AVAILABLE",referenceCount:0,currentReferenceCount:0}
    ]},
    {id:"letter",kind:"MOTIVATION_LETTER",name:"Archived letter",createdAt:date,archivedAt:date,versions:[]}
  ];
}
function respond(library:DocumentLibrary) {fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({library}),{status:200,headers:{"Content-Type":"application/json"}}));}
async function openCv() {await userEvent.click(await screen.findByRole("button",{name:"Engineering CV"}));return screen.getByRole("region",{name:"Document detail"});}
function submitImport(region:HTMLElement) {
  const button=within(region).getByRole("button",{name:"Import immutable version"});expect(button).toBeEnabled();
  // jsdom's native required-file check cannot see user-event's FileList shim.
  fireEvent.submit(button.closest("form")!);
}
describe("Document library",()=>{
  it("defaults to active documents and offers archived and all filters",async()=>{
    respond(fixture());render(<DocumentLibraryPage/>);
    expect(await screen.findByRole("button",{name:"Engineering CV"})).toBeInTheDocument();
    expect(screen.queryByRole("button",{name:"Archived letter"})).not.toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText("Document filter"),"ARCHIVED");
    expect(screen.getByRole("button",{name:"Archived letter"})).toBeInTheDocument();expect(screen.queryByRole("button",{name:"Engineering CV"})).not.toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText("Document filter"),"ALL");expect(screen.getByRole("button",{name:"Engineering CV"})).toBeInTheDocument();
    expect(screen.queryByRole("button",{name:/delete/i})).not.toBeInTheDocument();
  });
  it("shows ordered exact versions, reference summaries and verified downloads without storage paths",async()=>{
    respond(fixture());render(<DocumentLibraryPage/>);const detail=await openCv();
    const rows=within(detail).getAllByRole("listitem");expect(rows[0]).toHaveTextContent("v1 - old.pdf");expect(rows[1]).toHaveTextContent("v2 - new.pdf");
    expect(rows[0]).toHaveTextContent("100 bytes - AVAILABLE");expect(rows[0]).toHaveTextContent("2 references (1 current, 1 historical)");
    expect(rows[0]).toHaveTextContent("Protected by vacancy history");expect(rows[1]).toHaveTextContent("Unreferenced; retained");
    expect(within(detail).getByRole("button",{name:"Download v1"})).toBeInTheDocument();
    expect(within(detail).queryByRole("button",{name:/delete/i})).not.toBeInTheDocument();
  });
  it("renames with stable retry identity and archives/restores explicitly",async()=>{
    const initial=fixture(),renamed=initial.map(d=>d.id==="cv"?{...d,name:"Commissioning CV"}:d),archived=renamed.map(d=>d.id==="cv"?{...d,archivedAt:date}:d);
    respond(initial);fetchMock.mockRejectedValueOnce(Error("Interrupted"));respond(renamed);respond(archived);respond(renamed);
    render(<DocumentLibraryPage/>);await openCv();
    await userEvent.clear(screen.getByLabelText("Rename document"));await userEvent.type(screen.getByLabelText("Rename document"),"Commissioning CV");
    await userEvent.click(screen.getByRole("button",{name:"Save document name"}));expect(await screen.findByRole("alert")).toHaveTextContent("Interrupted");
    await userEvent.click(screen.getByRole("button",{name:"Save document name"}));await screen.findByRole("heading",{name:"Commissioning CV"});
    expect(fetchMock.mock.calls[1]?.[1]?.body).toBe(fetchMock.mock.calls[2]?.[1]?.body);
    await userEvent.click(screen.getByRole("button",{name:"Archive document"}));await screen.findByRole("button",{name:"Restore document"});
    expect(screen.queryByRole("button",{name:"Commissioning CV"})).not.toBeInTheDocument();
    expect(screen.getByRole("button",{name:"Download v1"})).toBeInTheDocument();
    expect(screen.queryByText("Add version")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button",{name:"Restore document"}));await screen.findByRole("button",{name:"Archive document"});
    expect(fetchMock.mock.calls[3]?.[0]).toContain("/documents/cv/archive");expect(fetchMock.mock.calls[4]?.[0]).toContain("/documents/cv/restore");
  });
  it("adds a version using the shared import flow and retains older history",async()=>{
    const initial=fixture();respond(initial);respond(initial.map(d=>d.id==="cv"?{...d,versions:[...d.versions,{...d.versions[1]!,id:"v3",versionNumber:3,originalFileName:"v3.pdf"}]}:d));
    render(<DocumentLibraryPage/>);const detail=await openCv();await userEvent.click(within(detail).getByText("Add version"));
    await userEvent.upload(within(detail).getByLabelText("Document file (maximum 5 MiB)"),new File(["new bytes"],"v3.pdf"));submitImport(detail);
    expect(await screen.findByRole("button",{name:"Download v3"})).toBeInTheDocument();expect(screen.getByRole("button",{name:"Download v1"})).toBeInTheDocument();
    expect(fetchMock.mock.calls[1]?.[0]).toBe("/documents/import");
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toMatchObject({documentId:"cv",requestId:expect.any(String),originalFileName:"v3.pdf",contentBase64:"bmV3IGJ5dGVz"});
  });
  it("creates a reusable library document independently of any vacancy",async()=>{
    respond([]);respond(fixture());render(<DocumentLibraryPage/>);await screen.findByText("No documents in this view.");
    await userEvent.click(screen.getByRole("button",{name:"Import new document"}));const region=screen.getByRole("region",{name:"New library document"});
    await userEvent.type(within(region).getByLabelText("Document name"),"Engineering CV");
    await userEvent.upload(within(region).getByLabelText("Document file (maximum 5 MiB)"),new File(["cv"],"cv.pdf"));submitImport(region);
    expect(await screen.findByRole("button",{name:"Engineering CV"})).toBeInTheDocument();
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toMatchObject({kind:"CV",name:"Engineering CV"});
    expect(String(fetchMock.mock.calls[1]?.[0])).not.toContain("vacancies");
  });
  it("retains missing/corrupt history and offers no invalid download or delete",async()=>{
    respond(fixture().map(d=>({...d,versions:d.versions.map((v,i)=>({...v,integrity:i===0?"MISSING" as const:"CORRUPT" as const}))})));render(<DocumentLibraryPage/>);const detail=await openCv();
    expect(within(detail).getAllByRole("status")).toHaveLength(2);expect(within(detail).queryByRole("button",{name:/Download/})).not.toBeInTheDocument();
    expect(within(detail).getByText(/2 references/)).toBeInTheDocument();expect(within(detail).queryByRole("button",{name:/delete/i})).not.toBeInTheDocument();
  });
});
