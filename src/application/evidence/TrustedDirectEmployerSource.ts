import type { SourceObservation } from "../../domain/capture/SourceObservation.js";

const TRUSTED_DIRECT_EMPLOYER_HOSTS = new Set(["jobsearch.daimlertruck.com", "burkert.com"]);

export function directEmployerOrganizationNames(
  observation: SourceObservation,
): readonly string[] {
  if (!isTrustedDirectEmployerSource(observation)) return [];
  return unique([
    observation.displayedCompanyName,
    ...structuredHiringOrganizationNames(observation.metadata),
  ]);
}

function isTrustedDirectEmployerSource(observation: SourceObservation): boolean {
  if (!TRUSTED_DIRECT_EMPLOYER_HOSTS.has(observation.source.sourceName)) return false;
  if (observation.source.sourceUrl === undefined) return false;
  try {
    const hostname = new URL(observation.source.sourceUrl).hostname.toLocaleLowerCase();
    return (hostname.startsWith("www.") ? hostname.slice(4) : hostname) === observation.source.sourceName;
  } catch {
    return false;
  }
}

function structuredHiringOrganizationNames(metadata: Readonly<Record<string, unknown>>): readonly string[] {
  const acquisition = record(metadata.acquisition);
  const structuredPayload = record(acquisition?.structuredPayload);
  const jobPostings = structuredPayload?.jobPostings;
  if (!Array.isArray(jobPostings)) return [];
  return jobPostings.flatMap((posting) => {
    const hiringOrganization = record(record(posting)?.hiringOrganization);
    const name = hiringOrganization?.name;
    return typeof name === "string" && name.trim().length > 0 ? [name.trim()] : [];
  });
}

function record(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Readonly<Record<string, unknown>>
    : undefined;
}

function unique(values: readonly (string | undefined)[]): readonly string[] {
  return [...new Set(values.flatMap((value) => value === undefined || value.trim().length === 0 ? [] : [value.trim()]))];
}