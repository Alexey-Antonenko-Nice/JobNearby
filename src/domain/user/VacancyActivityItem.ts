import type { ResolvedContact } from "./Contact.js";
/** Read-only projection; source records remain authoritative. */
export type VacancyActivityKind = "INTERACTION" | "PROCESS_TRANSITION" | "NOTE"
  | "ACTION_CREATED" | "ACTION_COMPLETED" | "ACTION_CANCELLED" | "ACTION_RESCHEDULED"
  | "REMINDER_SET" | "REMINDER_DISMISSED" | "DOCUMENT_SELECTED"
  | "CONTACT_LINKED" | "CONTACT_RELATIONSHIP_ENDED";
export interface VacancyActivityItem {
  readonly id:string;
  readonly vacancyId:string;
  readonly kind:VacancyActivityKind;
  readonly occurredAt:Date;
  readonly title:string;
  readonly summary:string;
  readonly details:readonly {readonly label:string;readonly value:string}[];
  readonly source:{readonly model:"InteractionEvent"|"ProcessTransition"|"VacancyNote"|"VacancyNextAction"|"ActionChange"|"DocumentAssociation"|"VacancyContact";readonly recordId:string};
  readonly contact?:ResolvedContact;
}
