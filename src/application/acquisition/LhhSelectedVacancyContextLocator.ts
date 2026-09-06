import { createAcquisitionContext } from "../../domain/acquisition/AcquisitionContext.js";
import type { SelectedVacancyContextLocator } from "./SelectedVacancyContextLocator.js";

export class LhhSelectedVacancyContextLocator implements SelectedVacancyContextLocator {
  locate(input: Parameters<SelectedVacancyContextLocator["locate"]>[0]) {
    if (input.providerKey !== "LHH" || input.externalId === undefined) return undefined;
    const main = input.html.match(/<main\b[\s\S]*?<\/main>/iu)?.[0] ?? input.html;
    const text = main.replace(/<script\b[^>]*>[\s\S]*?<\/script>/giu, " ").replace(/<[^>]+>/gu, " ").replace(/&(?:amp|lt|gt|quot|apos|nbsp);/giu, " ").replace(/\s+/gu, " ").trim();
    if (!/Responsable\s+maintenance|offres-emploi|recherche\s+pour\s+son\s+client/iu.test(text)) return undefined;
    return createAcquisitionContext({ kind: "SELECTED_VACANCY", associationMethod: "PROVIDER_LOCATOR", providerKey: "LHH", providerExternalId: input.externalId, associationEvidence: ["URL_EXTERNAL_ID", "LHH_DETAIL_PAGE"], text, html: main });
  }
}