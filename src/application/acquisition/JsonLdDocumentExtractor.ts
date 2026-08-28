export interface JsonLdDocumentExtractor {
  extract(html: string): readonly unknown[];
}
