export interface WorkdayStructuredFields {
  readonly title?: string;
  readonly displayedCompanyName?: string;
  readonly locationText?: string;
  readonly locationTexts?: readonly string[];
  readonly contractText?: string;
}

export function isWorkdaySource(sourceName: string, sourceUrl: string): boolean {
  try {
    const hostname = new URL(sourceUrl).hostname.toLocaleLowerCase();
    return hostname === sourceName && hostname.endsWith(".myworkdayjobs.com");
  } catch {
    return false;
  }
}

export function extractWorkdayVacancyId(sourceUrl: string): string | undefined {
  try {
    const url = new URL(sourceUrl);
    const match = /^\/[a-z]{2}(?:-[a-z]{2})?\/[^/]+\/details\/[^/]+_(JR-[A-Z0-9]+(?:-[A-Z0-9]+)*)\/?$/iu.exec(url.pathname);
    return match?.[1]?.toUpperCase();
  } catch {
    return undefined;
  }
}

export function extractWorkdayStructuredFields(html: string, sourceUrl?: string): WorkdayStructuredFields | undefined {
  const header = automationElement(html, "jobPostingHeader") ?? html;
  const title = automationText(header, "jobTitle") ?? htmlToText(header);
  const requisition = sourceUrl === undefined ? undefined : extractWorkdayVacancyId(sourceUrl);
  const subtitle = findMatchingSubtitle(html, requisition);
  const locations = splitLocations(subtitle ?? automationText(header, "locations") ?? automationText(header, "subtitle"));
  const company = automationText(header, "company") ?? automationText(header, "jobCompany")
    ?? automationText(html, "headerTitle")?.replace(/\s+careers?$/iu, "");
  const contractText = automationText(html, "timeType")
    ?? /\b(?:full\s+time|part\s+time|temps?\s+plein|temps?\s+partiel)\b/iu.exec(htmlToText(header))?.[0];
  const fields: { title?: string; displayedCompanyName?: string; locationText?: string; locationTexts?: readonly string[]; contractText?: string } = {};
  if (title !== undefined) fields.title = title;
  if (company !== undefined) fields.displayedCompanyName = company;
  if (locations.length === 1 && locations[0] !== undefined) fields.locationText = locations[0];
  if (locations.length > 1) fields.locationTexts = locations;
  if (contractText !== undefined) fields.contractText = contractText;
  return Object.keys(fields).length === 0 ? undefined : fields;
}

function automationElement(html: string, id: string): string | undefined {
  const marker = `data-automation-id="${id}"`;
  const index = html.indexOf(marker);
  if (index < 0) return undefined;
  const start = html.lastIndexOf("<", index);
  const tagEnd = html.indexOf(">", index);
  if (start < 0 || tagEnd < 0) return undefined;
  const name = /^<([a-z][\w-]*)/iu.exec(html.slice(start, tagEnd + 1))?.[1];
  if (name === undefined) return undefined;
  const pattern = new RegExp(`<\\/?${name}\\b[^>]*>`, "giu");
  pattern.lastIndex = start;
  let depth = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(html)) !== null) {
    depth += match[0].startsWith("</") ? -1 : 1;
    if (depth === 0) return html.slice(start, pattern.lastIndex);
  }
  return undefined;
}

function automationText(html: string, id: string): string | undefined {
  const element = automationElement(html, id);
  return element === undefined ? undefined : htmlToText(element);
}

function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/giu, " ")
    .replace(/<br\s*\/?\s*>/giu, "\n")
    .replace(/<[^>]+>/gu, " ")
    .replace(/&(?:amp|lt|gt|quot|apos|nbsp);/giu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function findMatchingSubtitle(html: string, requisition: string | undefined): string | undefined {
  const subtitles = automationTexts(html, "subtitle");
  return requisition === undefined ? subtitles[0] : subtitles.find((value) => value.includes(requisition));
}

function splitLocations(value: string | undefined): string[] {
  if (value === undefined) return [];
  const beforeRequisition = value.split(/\s+JR-[A-Z0-9-]+\b/iu)[0] ?? value;
  return [...new Set(beforeRequisition.split(";").map((part) => part.trim()).filter((part) =>
    part.length > 0 && !/^JR-[A-Z0-9-]+$/iu.test(part) && !/\b(?:H\/F|M\/W\/D)\b/iu.test(part)))];
}

function automationTexts(html: string, id: string): string[] {
  const marker = `data-automation-id="${id}"`;
  const values: string[] = [];
  let index = 0;
  while ((index = html.indexOf(marker, index)) >= 0) {
    const element = automationElement(html.slice(Math.max(0, html.lastIndexOf("<", index))), id);
    if (element !== undefined) values.push(htmlToText(element));
    index += marker.length;
  }
  return values;
}