import {cleanup,render,screen,within} from "@testing-library/react";
import {afterEach,describe,it,expect} from "vitest";
import {VacancyActivityTimeline} from "./VacancyActivityTimeline";
import type {ReviewView} from "./api";
afterEach(cleanup);
const item={id:"note:one",vacancyId:"v",kind:"NOTE" as const,occurredAt:"2026-11-19T12:00:00.000Z",title:"Note",summary:"Private context",details:[],source:{model:"VacancyNote" as const,recordId:"one"}};
describe("Vacancy timeline",()=>{
 it("shows neutral empty history",()=>{render(<VacancyActivityTimeline items={[]}/>);expect(screen.getByText("No recorded activity yet.")).toBeVisible();});
 it("renders the supplied ordering and kind labels with no editing controls",()=>{const items:NonNullable<ReviewView["activityTimeline"]>=[{...item,id:"action_created:a",kind:"ACTION_CREATED",title:"Action created",summary:"Call recruiter"},item];render(<VacancyActivityTimeline items={items}/>);const rows=screen.getAllByRole("listitem");expect(rows[0]).toHaveTextContent("Action created");expect(rows[1]).toHaveTextContent("Note");expect(screen.queryByRole("button")).toBeNull();expect(screen.getAllByText((_,e)=>e?.tagName==="TIME")[0]).toHaveAttribute("datetime",item.occurredAt);});
 it("shows archived current contact names and exact version-selection wording",()=>{render(<VacancyActivityTimeline items={[{...item,kind:"DOCUMENT_SELECTED",title:"CV selected",summary:"Engineering CV - v4",contact:{id:"c",displayName:"Current contact",archived:true},details:[{label:"Usage",value:"Selected; not proof of sending"}]}]}/>);expect(screen.getByText("Engineering CV - v4")).toBeVisible();expect(screen.getByText("Current contact (Archived contact)")).toBeVisible();expect(screen.getByText("Selected; not proof of sending")).toBeVisible();});
 it("escapes note text and does not expose source IDs",()=>{render(<VacancyActivityTimeline items={[{...item,summary:"<script>private</script>"}]}/>);const region=screen.getByRole("region",{name:"Vacancy activity timeline"});expect(region.querySelector("script")).toBeNull();expect(within(region).getByText("<script>private</script>")).toBeVisible();expect(region).not.toHaveTextContent("note:one");});
});
