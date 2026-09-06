import { createAcquisitionContext } from "../../domain/acquisition/AcquisitionContext.js";
import type { SelectedVacancyContextLocator } from "./SelectedVacancyContextLocator.js";

export class CadremploiSelectedVacancyContextLocator implements SelectedVacancyContextLocator {
  locate(input: Parameters<SelectedVacancyContextLocator["locate"]>[0]) {
    if (input.providerKey !== "CADREMPLOI" || input.externalId === undefined) return undefined;
    const root = input.html.match(/<main\b[\s\S]*?<\/main>/iu)?.[0] ?? input.html;
    const text = htmlToText(root);
    if (text.length === 0) return undefined;
    return createAcquisitionContext({ kind: "SELECTED_VACANCY", associationMethod: "PROVIDER_LOCATOR", providerKey: "CADREMPLOI", providerExternalId: input.externalId, associationEvidence: ["URL_EXTERNAL_ID", "CADREMPLOI_DETAIL_PAGE"], text, html: root });
  }
}

function htmlToText(html: string): string { return html.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/giu, " ").replace(/<br\s*\/?\s*>/giu, "\n").replace(/<[^>]+>/gu, " ").replace(/&(?:amp|lt|gt|quot|apos|nbsp);/giu, " ").replace(/\s+/gu, " ").trim(); }