import type { JsonLdDocumentExtractor } from "./JsonLdDocumentExtractor.js";

const scriptPattern = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/giu;
const jsonLdTypePattern = /\btype\s*=\s*(?:(["'])application\/ld\+json\1|application\/ld\+json(?:\s|$))/iu;

export class LiteralJsonLdDocumentExtractor implements JsonLdDocumentExtractor {
  extract(html: string): readonly unknown[] {
    const documents: unknown[] = [];
    for (const match of html.matchAll(scriptPattern)) {
      const attributes = match[1] ?? "";
      if (!jsonLdTypePattern.test(attributes)) continue;
      try {
        documents.push(JSON.parse(match[2] ?? ""));
      } catch {
        // Malformed optional JSON-LD must not prevent capture of the page itself.
      }
    }
    return documents;
  }
}
