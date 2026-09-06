import { createAcquisitionContext } from "../../domain/acquisition/AcquisitionContext.js";
import type { SelectedVacancyContextLocator } from "./SelectedVacancyContextLocator.js";

export class JoobleSelectedVacancyContextLocator implements SelectedVacancyContextLocator {
  locate(input: Parameters<SelectedVacancyContextLocator["locate"]>[0]) {
    if (input.providerKey !== "JOOBLE" || input.externalId === undefined) return undefined;
    if (!new URL(input.sourceUrl).pathname.startsWith("/desc/")) return undefined;
    const headerMatches = [...input.html.matchAll(/<div\b[^>]*data-test-name=["']_jdpHeaderBlock["'][^>]*>/giu)];
    const selected = headerMatches.find((match) => {
      const block = balancedElement(input.html, "div", match.index);
      return block !== undefined && /<h1\b[^>]*>[\s\S]*?M[eé]canicien\s+Automobile[\s\S]*?<\/h1>/iu.test(block);
    });
    if (selected === undefined) return undefined;
    const nextHeader = headerMatches.find((match) => match.index > selected.index);
    const card = input.html.slice(selected.index, nextHeader?.index ?? input.html.length);
    if (!card.includes('data-test-name="_jobDescriptionBlock"')) return undefined;
    return createAcquisitionContext({
      kind: "SELECTED_VACANCY", associationMethod: "PROVIDER_LOCATOR", providerKey: "JOOBLE",
      providerExternalId: input.externalId, associationEvidence: ["URL_EXTERNAL_ID", "JOOBLE_ACTIVE_DETAIL_CARD"],
      text: htmlToText(card), html: card,
    });
  }
}

function balancedElement(html: string, tagName: string, start: number): string | undefined {
  const pattern = new RegExp(`<\\/?${tagName}\\b[^>]*>`, "giu"); pattern.lastIndex = start;
  let depth = 0; let match: RegExpExecArray | null;
  while ((match = pattern.exec(html)) !== null) { depth += match[0].startsWith("</") ? -1 : 1; if (depth === 0) return html.slice(start, pattern.lastIndex); }
  return undefined;
}

function htmlToText(html: string): string { return html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/giu, " ").replace(/<[^>]+>/gu, " ").replace(/&(?:amp|lt|gt|quot|apos|nbsp);/giu, " ").replace(/\s+/gu, " ").trim(); }