import type { AcquisitionStructuredFields } from "../../domain/acquisition/AcquisitionPackage.js";
import type { RawSchemaOrgJobPosting } from "./SchemaOrgJobPostingExtractor.js";

export class SchemaOrgJobPostingProjector {
  project(posting: RawSchemaOrgJobPosting): AcquisitionStructuredFields | undefined {
    const title = usableString(posting.title);
    const displayedCompanyName = organizationName(posting.hiringOrganization);
    const locationText = location(posting.jobLocation);
    const publishedAt = validDate(posting.datePosted);
    const contractText = usableString(posting.employmentType);
    const salaryText = salary(posting.baseSalary);
    const fields: AcquisitionStructuredFields = {
      ...(title !== undefined ? { title } : {}),
      ...(displayedCompanyName !== undefined ? { displayedCompanyName } : {}),
      ...(locationText !== undefined ? { locationText } : {}),
      ...(salaryText !== undefined ? { salaryText } : {}),
      ...(contractText !== undefined ? { contractText } : {}),
      ...(publishedAt !== undefined ? { publishedAt } : {}),
    };
    return Object.keys(fields).length === 0 ? undefined : fields;
  }
}

function organizationName(value: unknown): string | undefined {
  return isRecord(value) ? usableString(value.name) : undefined;
}

function location(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined;
  const name = usableString(value.name);
  if (name !== undefined) return name;
  if (!isRecord(value.address)) return undefined;
  const address = value.address;
  const country = usableString(address.addressCountry) ??
    (isRecord(address.addressCountry) ? usableString(address.addressCountry.name) : undefined);
  const parts = [
    usableString(address.addressLocality),
    usableString(address.addressRegion),
    country,
  ].filter((part): part is string => part !== undefined);
  return parts.length > 0 ? parts.join(", ") : usableString(address.postalCode);
}

function validDate(value: unknown): Date | undefined {
  if (typeof value !== "string" || value.trim().length === 0) return undefined;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : undefined;
}

function salary(value: unknown): string | undefined {
  if (typeof value === "number" || typeof value === "string") {
    return usableScalar(value);
  }
  if (!isRecord(value)) return undefined;
  const currency = usableString(value.currency);
  const amount = value.value;
  if (typeof amount === "number" || typeof amount === "string") {
    return joinSalary(usableScalar(amount), currency, undefined);
  }
  if (!isRecord(amount)) return undefined;
  const exact = usableScalar(amount.value);
  const minimum = usableScalar(amount.minValue);
  const maximum = usableScalar(amount.maxValue);
  const unit = usableString(amount.unitText);
  const numeric = exact ??
    (minimum !== undefined && maximum !== undefined
      ? `${minimum} - ${maximum}`
      : minimum ?? maximum);
  return numeric === undefined ? undefined : joinSalary(numeric, currency, unit);
}

function joinSalary(amount: string | undefined, currency: string | undefined, unit: string | undefined): string | undefined {
  if (amount === undefined) return undefined;
  return `${amount}${currency === undefined ? "" : ` ${currency}`}${unit === undefined ? "" : ` / ${unit}`}`;
}

function usableScalar(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return usableString(value);
}

function usableString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
