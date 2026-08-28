export type RawSchemaOrgJobPosting = Readonly<Record<string, unknown>>;

export class SchemaOrgJobPostingExtractor {
  extract(documents: readonly unknown[]): readonly RawSchemaOrgJobPosting[] {
    const postings: RawSchemaOrgJobPosting[] = [];
    for (const document of documents) collect(document, postings);
    return structuredClone(postings);
  }
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
