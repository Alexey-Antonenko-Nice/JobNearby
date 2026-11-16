import { airbusDetailsRoute } from "../acquisition/AirbusSelectedPaneVacancy.js";
import { scopeAirbusSelectedPaneVacancyEvidence } from "./scopeAirbusSelectedPaneVacancyEvidence.js";
import type { VacancyEvidenceExtractionInput } from "../../domain/evidence/VacancyEvidenceInput.js";
import type { AcquisitionContext } from "../../domain/acquisition/AcquisitionContext.js";
import { AirbusDirectVacancyContextLocator, airbusDirectFacts, isAirbusWorkdaySource } from "../acquisition/AirbusWorkdayVacancy.js";
import { buildBoundedEvidenceView } from "./buildBoundedEvidenceView.js";

export function scopeAirbusWorkdayVacancyEvidence(input: VacancyEvidenceExtractionInput) {
  if (airbusDetailsRoute(input.source.sourceUrl ?? "")) return scopeAirbusSelectedPaneVacancyEvidence(input);
  const acquisition = record(input.metadata.acquisition);
  const identity = { id: input.id, source: { sourceType: input.source.sourceType, sourceName: input.source.sourceName,
    ...(input.source.sourceUrl === undefined ? {} : { sourceUrl: input.source.sourceUrl }) }, observedAt: input.observedAt, metadata: {} };
  const empty = () => buildBoundedEvidenceView(identity, undefined);
  if (!isAirbusWorkdaySource(input.source.sourceName, input.source.sourceUrl ?? "")) return empty();
  const locate = (html: string) => new AirbusDirectVacancyContextLocator().locate({ providerKey: "AIRBUS_WORKDAY", sourceUrl: input.source.sourceUrl!,
    html, ...(input.source.externalId === undefined ? {} : { externalId: input.source.externalId }) });
  let context = typeof acquisition?.html === "string" ? locate(acquisition.html) : undefined;
  if (acquisition?.html !== undefined && !context) return empty();
  if (acquisition?.contexts !== undefined && (!Array.isArray(acquisition.contexts) || acquisition.contexts.length !== 1)) return empty();
  const stored: unknown[] = Array.isArray(acquisition?.contexts) ? acquisition.contexts : [];
  const selected = "evidenceContent" in input && input.evidenceContent.kind === "SELECTED_VACANCY_CONTEXT" ? [input.evidenceContent.context] : [];
  for (const candidate of [...stored, ...selected]) {
    const value = record(candidate);
    if (!value || typeof value.html !== "string") return empty();
    const checked = locate(value.html);
    if (!checked || !sameContext(value, checked) || context && !sameContext(context, checked)) return empty();
    context = checked;
  }
  if (!context) return empty();
  const projection = airbusDirectFacts(context.html!);
  if (!projection) return empty();
  return buildBoundedEvidenceView({ ...identity, source: { ...identity.source, externalId: context.providerExternalId! } }, context, projection);
}
function sameContext(left: Record<string, unknown> | AcquisitionContext, right: AcquisitionContext): boolean {
  const keys = ["kind", "associationMethod", "providerKey", "providerExternalId", "html", "text", "metadata", "associationEvidence"] as const;
  return Object.keys(left).every(key => (keys as readonly string[]).includes(key))
    && keys.every(key => JSON.stringify(left[key]) === JSON.stringify(right[key]));
}
function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}
