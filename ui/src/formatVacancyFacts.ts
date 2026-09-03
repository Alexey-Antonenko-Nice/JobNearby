type RecordValue = Record<string, unknown>;

export function formatLocation(value: unknown): string {
  if (!isRecord(value)) return unknown(value);
  const components = [value.city, value.region, value.countryCode]
    .filter((part): part is string => typeof part === "string" && part.trim().length > 0);
  if (components.length > 0) return components.join(", ");
  return text(value.rawText);
}

export function formatEngagement(value: unknown): string {
  if (!isRecord(value)) return unknown(value);
  const normalized = strings(value.normalizedTerms).map(engagementLabel);
  const terms = normalized.length > 0 ? normalized : strings(value.rawTerms).map(readableTerm);
  return terms.length === 0 ? "Unknown" : terms.join(" · ");
}

export function formatCompensation(value: unknown): string {
  if (!isRecord(value)) return unknown(value);
  const rawText = text(value.rawText);
  if (rawText !== "Unknown") return formatRawCompensation(rawText);
  const minimum = typeof value.minimum === "number" ? value.minimum.toLocaleString("en-US") : undefined;
  const maximum = typeof value.maximum === "number" ? value.maximum.toLocaleString("en-US") : undefined;
  const currency = typeof value.currency === "string" ? value.currency : undefined;
  const period = typeof value.period === "string" ? value.period.toLocaleLowerCase() : undefined;
  const range = minimum === undefined ? maximum : maximum === undefined ? minimum : `${minimum}–${maximum}`;
  return range === undefined ? "Unknown" : [range, currency, period === undefined ? undefined : `/ ${period}`].filter(Boolean).join(" ");
}

export function formatWorkMode(value: unknown): string {
  if (typeof value === "string") return ({ REMOTE: "Remote", HYBRID: "Hybrid", ON_SITE: "On-site", ONSITE: "On-site" }[value] ?? readableTerm(value));
  if (!isRecord(value)) return unknown(value);
  return text(value.rawText);
}

function formatRawCompensation(value: string): string {
  const match = /^(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)\s+([A-Z]+)\s*\/\s*([A-Z]+)$/u.exec(value);
  if (match === null) return value;
  return `${Number(match[1]).toLocaleString("en-US")}–${Number(match[2]).toLocaleString("en-US")} ${match[3]} / ${match[4]!.toLocaleLowerCase()}`;
}

function engagementLabel(value: string): string {
  return ({ INDEFINITE: "CDI", FIXED_TERM: "CDD" }[value] ?? readableTerm(value));
}

function readableTerm(value: string): string {
  return value.toLocaleLowerCase().replace(/_/gu, " ").replace(/\b\w/gu, (letter) => letter.toLocaleUpperCase());
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function text(value: unknown): string {
  return typeof value === "string" && value.trim().length > 0 ? value : "Unknown";
}

function unknown(value: unknown): string {
  return value === null || value === undefined || value === "" ? "Unknown" : String(value);
}

function isRecord(value: unknown): value is RecordValue {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}