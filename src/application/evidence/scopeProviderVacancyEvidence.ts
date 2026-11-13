import { scopeStellantisVacancyEvidence } from "./scopeStellantisVacancyEvidence.js";
import { scopeExpectraVacancyEvidence } from "./scopeExpectraVacancyEvidence.js";
import { scopeGreenhouseVacancyEvidence } from "./scopeGreenhouseVacancyEvidence.js";
import { scopeOranoVacancyEvidence } from "./scopeOranoVacancyEvidence.js";
import { scopeMichaelPageVacancyEvidence } from "./scopeMichaelPageVacancyEvidence.js";
import { isRenaultWorkdaySource } from "../acquisition/RenaultWorkdayVacancy.js";
import { scopeRenaultVacancyEvidence } from "./scopeRenaultVacancyEvidence.js";
import { scopeHaysVacancyEvidence } from "./scopeHaysVacancyEvidence.js";
import { scopeLhhVacancyEvidence } from "./scopeLhhVacancyEvidence.js";
import { scopeAlstomVacancyEvidence } from "./scopeAlstomVacancyEvidence.js";
import { KELLY_WORKDAY_HOST } from "../acquisition/KellyWorkdayVacancy.js";
import { scopeKellyVacancyEvidence } from "./scopeKellyVacancyEvidence.js";
import { scopeApecVacancyEvidence } from "./scopeApecVacancyEvidence.js";
import { scopeDirectEmploiVacancyEvidence } from "./scopeDirectEmploiVacancyEvidence.js";
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
import { scopeLinkedInVacancyEvidence } from "./scopeLinkedInVacancyEvidence.js";
import { scopeFranceTravailVacancyEvidence, FRANCE_TRAVAIL_SOURCE_NAME } from "./scopeFranceTravailVacancyEvidence.js";
import { BURKERT_SOURCE_NAME } from "../acquisition/BurkertVacancyIdentity.js";
import { scopeBurkertVacancyEvidence } from "./scopeBurkertVacancyEvidence.js";

import { scopeTalentVacancyEvidence } from "./scopeTalentVacancyEvidence.js";

import { scopeAdeccoVacancyEvidence } from "./scopeAdeccoVacancyEvidence.js";

const boundedHelloWorkInput = Symbol("boundedHelloWorkInput");

type ProviderScope = (input: VacancyEvidenceExtractionInput) => VacancyEvidenceExtractionInput;

/**
 * The single source of truth for explicit per-source scope routes. Sources with selected-vacancy
 * semantics must be listed here (or be Renault/HelloWork below) rather than reach the legacy fallback.
 */
const scopeRoutesBySourceName: ReadonlyMap<string, ProviderScope> = new Map<string, ProviderScope>([
  ["expectra.mc", scopeExpectraVacancyEvidence],
  ["job-boards.eu.greenhouse.io", scopeGreenhouseVacancyEvidence],
  ["jobs.groupe-psa.com", scopeStellantisVacancyEvidence],
  ["jobs.orano.group", scopeOranoVacancyEvidence],
  ["michaelpage.fr", scopeMichaelPageVacancyEvidence],
  [KELLY_WORKDAY_HOST, scopeKellyVacancyEvidence],
  ["m.hays.fr", scopeHaysVacancyEvidence],
  ["lhh.com", scopeLhhVacancyEvidence],
  ["jobsearch.alstom.com", scopeAlstomVacancyEvidence],
  ["apec.fr", scopeApecVacancyEvidence],
  ["directemploi.com", scopeDirectEmploiVacancyEvidence],
  ["gigroup.com", scopeGiGroupVacancyEvidence],
  ["mon-espace.proman-emploi.fr", scopePromanVacancyEvidence],
  ["startpeople.fr", scopeStartPeopleVacancyEvidence],
  ["actualgroup.com", scopeActualVacancyEvidence],
  ["crit-job.com", scopeCritVacancyEvidence],
  ["synergie.fr", scopeSynergieVacancyEvidence],
  ["randstad.fr", scopeRandstadVacancyEvidence],
  ["manpower.com", scopeManpowerVacancyEvidence],
  ["adecco.com", scopeAdeccoVacancyEvidence],
  ["talent.com", scopeTalentVacancyEvidence],
  ["linkedin.com", scopeLinkedInVacancyEvidence],
  [FRANCE_TRAVAIL_SOURCE_NAME, scopeFranceTravailVacancyEvidence],
  [BURKERT_SOURCE_NAME, scopeBurkertVacancyEvidence],
  ["indeed.com", scopeIndeedVacancyEvidence],
]);

/** True when the source has a deliberate scope decision rather than relying on the legacy fallback. */
export function hasExplicitVacancyEvidenceScopeRoute(sourceName: string, sourceUrl = ""): boolean {
  return scopeRoutesBySourceName.has(sourceName) || sourceName === "hellowork.com" || isRenaultWorkdaySource(sourceName, sourceUrl);
}

/** Reconstruct a transient, bounded view, including for pre-guard immutable captures. */
export function scopeProviderVacancyEvidence(input: VacancyEvidenceExtractionInput): VacancyEvidenceExtractionInput {
  if (isRenaultWorkdaySource(input.source.sourceName, input.source.sourceUrl ?? "")) return scopeRenaultVacancyEvidence(input);
  const route = scopeRoutesBySourceName.get(input.source.sourceName);
  if (route !== undefined) return route(input);
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
