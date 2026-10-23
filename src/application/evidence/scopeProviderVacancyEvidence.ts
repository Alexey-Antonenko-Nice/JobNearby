import { scopeAlstomVacancyEvidence } from "./scopeAlstomVacancyEvidence.js";
import { KELLY_WORKDAY_HOST } from "../acquisition/KellyWorkdayVacancy.js";
import { scopeKellyVacancyEvidence } from "./scopeKellyVacancyEvidence.js";
import { scopeApecVacancyEvidence } from "./scopeApecVacancyEvidence.js";
import { scopeGiGroupVacancyEvidence } from "./scopeGiGroupVacancyEvidence.js";
import { scopePromanVacancyEvidence } from "./scopePromanVacancyEvidence.js";
import { scopeStartPeopleVacancyEvidence } from "./scopeStartPeopleVacancyEvidence.js";
import { scopeActualVacancyEvidence } from "./scopeActualVacancyEvidence.js";
import { scopeCritVacancyEvidence } from "./scopeCritVacancyEvidence.js";
import { scopeSynergieVacancyEvidence } from "./scopeSynergieVacancyEvidence.js";
import { scopeRandstadVacancyEvidence } from "./scopeRandstadVacancyEvidence.js";
import { scopeManpowerVacancyEvidence } from "./scopeManpowerVacancyEvidence.js";
import type { VacancyEvidenceExtractionInput } from "../../domain/evidence/VacancyEvidenceInput.js";
import { fromSelectedVacancyContext } from "../../domain/evidence/VacancyEvidenceInput.js";
import { HelloWorkSelectedVacancyContextLocator, helloWorkHeaderFields, helloWorkJobPostings, helloWorkVacancyId } from "../acquisition/HelloWorkVacancy.js";
import { SchemaOrgJobPostingProjector } from "../acquisition/SchemaOrgJobPostingProjector.js";
import { scopeIndeedVacancyEvidence } from "./scopeIndeedVacancyEvidence.js";

import { scopeTalentVacancyEvidence } from "./scopeTalentVacancyEvidence.js";

import { scopeAdeccoVacancyEvidence } from "./scopeAdeccoVacancyEvidence.js";

const boundedHelloWorkInput = Symbol("boundedHelloWorkInput");

/** Reconstruct a transient, bounded view, including for pre-guard immutable captures. */
export function scopeProviderVacancyEvidence(input: VacancyEvidenceExtractionInput): VacancyEvidenceExtractionInput {
  if (input.source.sourceName === KELLY_WORKDAY_HOST) return scopeKellyVacancyEvidence(input);
  if (input.source.sourceName === "jobsearch.alstom.com") return scopeAlstomVacancyEvidence(input);
  if (input.source.sourceName === "apec.fr") return scopeApecVacancyEvidence(input);
  if (input.source.sourceName === "gigroup.com") return scopeGiGroupVacancyEvidence(input);
  if (input.source.sourceName === "mon-espace.proman-emploi.fr") return scopePromanVacancyEvidence(input);
  if (input.source.sourceName === "startpeople.fr") return scopeStartPeopleVacancyEvidence(input);
  if (input.source.sourceName === "actualgroup.com") return scopeActualVacancyEvidence(input);
  if (input.source.sourceName === "crit-job.com") return scopeCritVacancyEvidence(input);
  if (input.source.sourceName === "synergie.fr") return scopeSynergieVacancyEvidence(input);
  if (input.source.sourceName === "randstad.fr") return scopeRandstadVacancyEvidence(input);
  if (input.source.sourceName === "manpower.com") return scopeManpowerVacancyEvidence(input);
  if (input.source.sourceName === "adecco.com") return scopeAdeccoVacancyEvidence(input);
  if (input.source.sourceName === "talent.com") return scopeTalentVacancyEvidence(input);
  if (input.source.sourceName !== "hellowork.com") return scopeIndeedVacancyEvidence(input);
  if (boundedHelloWorkInput in input) return input;
  const acquisition = record(input.metadata.acquisition);
  const html = typeof acquisition?.html === "string" ? acquisition.html : "";
  const url = input.source.sourceUrl ?? "";
  // Revalidate the original DOM rather than trusting a stale stored context.
  const context = new HelloWorkSelectedVacancyContextLocator().locate({ providerKey: "HELLOWORK", sourceUrl: url, html,
    ...(input.source.externalId === undefined ? {} : { externalId: input.source.externalId }) });
  const postings = input.source.externalId === helloWorkVacancyId(url) ? helloWorkJobPostings(html, url) : [];
  const fields = { ...(context?.html === undefined ? {} : helloWorkHeaderFields(context.html)),
    ...(postings.length === 1 ? new SchemaOrgJobPostingProjector().project(postings[0]!) : {}) };
  const { title: _title, displayedCompanyName: _company, locationText: _location, salaryText: _salary,
    contractText: _contract, contactText: _contact, description: _description, rawContent: _raw, ...identity } = input;
  const scoped = { ...identity, ...fields, [boundedHelloWorkInput]: true, rawContent: context?.text ?? "", metadata: { ...input.metadata,
    acquisition: { ...acquisition, html: context?.html ?? "", structuredPayload: undefined,
      contexts: context === undefined ? [] : [context], metadata: { ...record(acquisition?.metadata), vacancyEvidenceScope: "SELECTED_VACANCY_REQUIRED" } },
  } };
  return context === undefined ? { ...scoped, evidenceContent: { kind: "SOURCE_OBSERVATION" } }
    : fromSelectedVacancyContext(scoped, context);
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : undefined;
}
