import { createExtractedVacancyEvidence } from "../../domain/evidence/ExtractedVacancyEvidence.js";
import type { VacancyEvidenceExtractor } from "../../domain/evidence/VacancyEvidenceExtractor.js";
import { normalizeVacancyEvidenceInput, type VacancyEvidenceExtractionInput } from "../../domain/evidence/VacancyEvidenceInput.js";

const PERIODS = { annuel: "YEAR", mensuel: "MONTH", horaire: "HOUR" } as const;
const AMOUNT = String.raw`(\d[\d\s\u00a0\u202f.,]*\d|\d)`;
// Real pane text: "Salaire Annuel de 24000.0 Euros à 55000.0 Euros" (colon optional).
const SALARY = new RegExp(
  String.raw`^Salaire\s*:?\s*(Annuel|Mensuel|Horaire)\s+de\s+${AMOUNT}\s*(?:Euros?|€)(?:\s+(?:à|a)\s+${AMOUNT}\s*(?:Euros?|€))?`,
  "iu",
);
const REMUNERATION = /^R[ée]mun[ée]ration\s*:/iu;
const SUPPLEMENT = /^Compl[ée]ment\s+de\s+salaire\s*:/iu;
const EMPLOYER_HEADING = /^(?:L['’]employeur|Entreprise)$/iu;

// Reads the "Salaire" criterion and the employer panel name (displayed-company evidence
// only). The description's remuneration sentence is kept in the raw text so a fixed +
// variable range is not mistaken for guaranteed base pay.
export class FranceTravailVacancyEvidenceExtractor implements VacancyEvidenceExtractor {
  async extract(input: VacancyEvidenceExtractionInput) {
    const observation = normalizeVacancyEvidenceInput(input);
    const content = observation.evidenceContent;
    if (content.kind !== "SELECTED_VACANCY_CONTEXT" || content.context.providerKey !== "FRANCE_TRAVAIL") {
      return createExtractedVacancyEvidence({ sourceObservationId: observation.id });
    }
    const lines = (content.context.text ?? "").split("\n").map((line) => line.trim());
    const provenance = {
      sourceObservationId: observation.id,
      extractionMethod: "TEXT_EXTRACTION" as const,
      confidence: 1,
      contentOrigin: "SELECTED_VACANCY_CONTEXT" as const,
    };
    const panel = lines.findIndex((line) =>     EMPLOYER_HEADING.test(line));
        const company = panel < 0 ? undefined : lines[panel + 1];
        const organizations = company !== undefined && company.length > 0 && company.length <= 80 && !/[:.]$/u.test(company)
      ? [{ value: company, role: "DISPLAYED_COMPANY" as const, provenance }]
      : [];
    const index = lines.findIndex((line) => SALARY.test(line));
    const match = index < 0 ? null : SALARY.exec(lines[index]!);
    if (match === null) return createExtractedVacancyEvidence({ sourceObservationId: observation.id, organizations });

    const first = amount(match[2]!);
    const second = match[3] === undefined ? undefined : amount(match[3]);
    const wording = [
      lines[index]!,
      lines.find((line) => REMUNERATION.test(line) && line.length <= 400),
      lines.slice(index + 1, index + 3).find((line) => SUPPLEMENT.test(line)),
    ].filter((value) => value !== undefined);
    return createExtractedVacancyEvidence({
      sourceObservationId: observation.id,
      organizations,
      compensations: [{
        rawText: wording.join("; "),
        currency: "EUR",
        minimum: second === undefined ? first : Math.min(first, second),
        ...(second === undefined ? {} : { maximum: Math.max(first, second) }),
        period: PERIODS[match[1]!.toLowerCase() as keyof typeof PERIODS],
        provenance,
      }],
    });
  }
}

function amount(value: string): number {
  const compact = value.replace(/[\s\u00a0\u202f]/gu, "");
  return Number(
    /^\d{1,3}(?:\.\d{3})+$/u.test(compact) ? compact.replaceAll(".", "") : compact.replace(",", "."),
  );
}
