export type RawSchemaOrgJobPosting = Readonly<Record<string, unknown>>;

export class SchemaOrgJobPostingExtractor {
  extract(documents: readonly unknown[]): readonly RawSchemaOrgJobPosting[] {
    const postings: RawSchemaOrgJobPosting[] = [];
    for (const document of documents) collect(document, postings);
    return structuredClone(postings);
  }

  extractHtml(html: string): readonly RawSchemaOrgJobPosting[] {
    const article = findJobPostingArticle(html);
    if (article === undefined) return [];
    const posting: Record<string, unknown> = {};
    const title = itemText(article, "title");
    const employmentType = itemContent(article, "employmentType") ?? itemText(article, "employmentType");
    const organization = itemScope(article, "hiringOrganization", htmlHasSiblingJobLocationInAddress);
    const location = itemScope(article, "jobLocation");
    if (title !== undefined) posting.title = title;
    if (employmentType !== undefined) posting.employmentType = employmentType;
    if (organization !== undefined) posting.hiringOrganization = organization;
    if (location !== undefined) posting.jobLocation = location;
    return Object.keys(posting).length === 0 ? [] : [posting];
  }
}

function findJobPostingArticle(html: string): string | undefined {
  const match = /<article\b[^>]*itemtype=["']https:\/\/schema\.org\/JobPosting["'][^>]*>/iu.exec(html);
  return match === null ? undefined : balancedElement(html, "article", match.index);
}

function itemScope(
  html: string,
  property: string,
  reject?: (html: string, index: number) => boolean,
): Record<string, unknown> | undefined {
  const match = new RegExp(`<[^>]+itemprop=["']${property}["'][^>]*itemscope[^>]*>`, "iu").exec(html);
  if (match === null) return undefined;
  if (reject?.(html, match.index) === true) return undefined;
  const element = balancedElement(html, tagName(match[0])!, match.index);
  if (element === undefined) return undefined;
  const result: Record<string, unknown> = {};
  const name = itemTextDirect(element, "name");
  const sameAs = itemContent(element, "sameAs");
  const locality = itemContent(element, "addressLocality");
  const streetAddress = itemContent(element, "streetAddress");
  if (name !== undefined) result.name = name;
  if (sameAs !== undefined) result.sameAs = sameAs;
  if (locality !== undefined || streetAddress !== undefined) {
    result.address = {
      ...(locality === undefined ? {} : { addressLocality: locality }),
      ...(streetAddress === undefined ? {} : { streetAddress }),
    };
  }
  return Object.keys(result).length === 0 ? undefined : result;
}

function htmlHasSiblingJobLocationInAddress(html: string, index: number): boolean {
  const addressStart = html.lastIndexOf("<address", index);
  const addressEnd = html.lastIndexOf("</address", index);
  if (addressStart <= addressEnd) return false;
  const closingAddress = html.indexOf("</address", index);
  if (closingAddress < 0) return false;
  const remainder = html.slice(index, closingAddress);
  return /itemprop=["']jobLocation["']/iu.test(remainder);
}

function itemText(html: string, property: string): string | undefined {
  const match = new RegExp(`<[^>]+itemprop=["']${property}["'][^>]*>([\\s\\S]*?)<\\/[a-z][^>]*>`, "iu").exec(html);
  return match === null ? undefined : cleanText(match[1]!);
}

function itemTextDirect(html: string, property: string): string | undefined {
  const nestedScopes = nestedItemScopeRanges(html);
  for (const match of html.matchAll(new RegExp(`<[^>]+itemprop=["']${property}["'][^>]*>`, "giu"))) {
    const index = match.index ?? -1;
    if (nestedScopes.some(({ start, end }) => index >= start && index < end)) continue;
    const tagEnd = html.indexOf(">", index);
    if (tagEnd < 0) continue;
    const tag = match[0];
    if (/\b(?:meta|link|input)\b/iu.test(tag)) {
      const content = /(?:content|value)=["']([^"']+)["']/iu.exec(tag)?.[1];
      if (content !== undefined) return cleanText(content);
      continue;
    }
    const name = tagName(tag);
    if (name === undefined) continue;
    const close = new RegExp(`</${name}\\s*>`, "iu").exec(html.slice(tagEnd + 1));
    if (close !== null && close.index !== undefined) {
      const value = cleanText(html.slice(tagEnd + 1, tagEnd + 1 + close.index));
      if (value !== undefined) return value;
    }
  }
  return undefined;
}

function nestedItemScopeRanges(html: string): readonly { readonly start: number; readonly end: number }[] {
  const root = /<[^>]+itemscope[^>]*>/iu.exec(html);
  if (root === null || root.index === undefined) return [];
  const ranges: { start: number; end: number }[] = [];
  const pattern = /<[^>]+itemscope[^>]*>/giu;
  pattern.lastIndex = root.index + root[0].length;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(html)) !== null) {
    const name = tagName(match[0]);
    if (name === undefined) continue;
    const end = balancedElement(html, name, match.index);
    if (end !== undefined) ranges.push({ start: match.index, end: match.index + end.length });
  }
  return ranges;
}

function itemContent(html: string, property: string): string | undefined {
  const match = new RegExp(`<[^>]+itemprop=["']${property}["'][^>]*(?:content|value)=["']([^"']+)["'][^>]*>`, "iu").exec(html);
  return match === null ? undefined : cleanText(match[1]!);
}

function tagName(tag: string): string | undefined {
  return /^<([a-z][\w-]*)/iu.exec(tag)?.[1];
}

function balancedElement(html: string, name: string, start: number): string | undefined {
  const pattern = new RegExp(`<\\/?${name}\\b[^>]*>`, "giu");
  pattern.lastIndex = start;
  let depth = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(html)) !== null) {
    if (!match[0].startsWith("</")) depth += 1;
    else depth -= 1;
    if (depth === 0) return html.slice(start, pattern.lastIndex);
  }
  return undefined;
}

function cleanText(value: string): string | undefined {
  const text = value.replace(/<[^>]+>/gu, " ").replace(/&(?:amp|lt|gt|quot|apos|nbsp);/giu, " ").replace(/\s+/gu, " ").trim();
  return text.length === 0 ? undefined : text;
}

function collect(value: unknown, postings: RawSchemaOrgJobPosting[]): void {
  if (Array.isArray(value)) {
    for (const item of value) collect(item, postings);
    return;
  }
  if (!isRecord(value)) return;
  if (isJobPostingType(value["@type"])) postings.push(value);
  if (Array.isArray(value["@graph"])) collect(value["@graph"], postings);
}

function isJobPostingType(value: unknown): boolean {
  return value === "JobPosting" ||
    (Array.isArray(value) && value.some((item) => item === "JobPosting"));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
