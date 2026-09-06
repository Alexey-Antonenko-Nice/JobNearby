export function extractBurkertApplyId(html: string): string | undefined {
  for (const match of html.matchAll(/https?:\/\/[^"'\s<>]+\/apply(?:\?[^"'\s<>]*)?/giu)) {
    const id = /(?:^|[_-])(JR_\d+)(?:[/?#&_]|$)/iu.exec(match[0])?.[1];
    if (id !== undefined) return id.toUpperCase();
  }
  return undefined;
}