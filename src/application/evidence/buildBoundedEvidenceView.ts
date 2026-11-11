import type { AcquisitionContext } from "../../domain/acquisition/AcquisitionContext.js";
import type {
  VacancyEvidenceExtractionInput,
  VacancyEvidenceInput,
} from "../../domain/evidence/VacancyEvidenceInput.js";
import { normalizeVacancyEvidenceInput } from "../../domain/evidence/VacancyEvidenceInput.js";

/**
 * Approved projection of provider-specific facts that are safe to restore
 * into a bounded evidence view after selected-vacancy scoping.
 *
 * Only explicitly approved fields should be included.
 */
export interface ApprovedProviderProjection {
  readonly title?: string;
  readonly displayedCompanyName?: string;
  readonly locationText?: string;
  readonly salaryText?: string;
  readonly contractText?: string;
  readonly description?: string;
  readonly publishedAt?: Date;
}

/**
 * Constructs a safe, transient evidence input from a validated selected vacancy context.
 *
 * This helper ensures contamination is impossible by default:
 * - Replaces whole-page text and HTML with selected-context equivalents
 * - Clears unsafe page-level structured fields
 * - Clears page-level metadata fields (title, company name, location, salary, etc.)
 * - Restores only explicitly approved provider projections
 *
 * The helper does not mutate any input; it returns a new transient object.
 * If no context is supplied, returns a safe empty view without falling back to whole-page.
 *
 * @param input - Original acquisition source (either SourceObservation or VacancyEvidenceInput)
 * @param selectedContext - Already validated SELECTED_VACANCY context from provider locator
 * @param approvedProjection - Explicitly approved provider-specific facts to restore (optional)
 * @returns A new transient evidence input safe for extraction
 *
 * @throws Error if selectedContext is not a valid SELECTED_VACANCY context
 */
export function buildBoundedEvidenceView(
  input: VacancyEvidenceExtractionInput,
  selectedContext: AcquisitionContext | undefined,
  approvedProjection?: ApprovedProviderProjection,
): VacancyEvidenceInput {
  const normalized = normalizeVacancyEvidenceInput(input);

  if (selectedContext === undefined) {
    // No selected context: return a safe empty view without falling back to whole page.
    // Do not allow projections without validated context to become evidence.
    const result: VacancyEvidenceInput = {
      id: normalized.id,
      source: normalized.source,
      observedAt: normalized.observedAt,
      ...(normalized.contactText !== undefined ? { contactText: normalized.contactText } : {}),
      metadata: {
        ...normalized.metadata,
        acquisition: undefined,
      },
      evidenceContent: { kind: "SOURCE_OBSERVATION" },
    };
    return result;
  }

  if (selectedContext.kind !== "SELECTED_VACANCY") {
    throw new Error("Bounded evidence view requires a SELECTED_VACANCY context.");
  }

  // Build the bounded evidence view: scope text/html from selected context,
  // clear unsafe page-level fields, and restore only approved projections.
  // Construct acquisition object from scratch (allowlist only, no passthrough).
  const scoped: VacancyEvidenceInput = {
    id: normalized.id,
    source: normalized.source,
    observedAt: normalized.observedAt,
    ...(approvedProjection?.title !== undefined ? { title: approvedProjection.title } : {}),
    ...(approvedProjection?.displayedCompanyName !== undefined
      ? { displayedCompanyName: approvedProjection.displayedCompanyName }
      : {}),
    ...(approvedProjection?.locationText !== undefined
      ? { locationText: approvedProjection.locationText }
      : {}),
    ...(approvedProjection?.salaryText !== undefined ? { salaryText: approvedProjection.salaryText } : {}),
    ...(approvedProjection?.contractText !== undefined
      ? { contractText: approvedProjection.contractText }
      : {}),
    ...(approvedProjection?.description !== undefined
      ? { description: approvedProjection.description }
      : {}),
    ...(approvedProjection?.publishedAt !== undefined ? { publishedAt: approvedProjection.publishedAt } : {}),
    ...(normalized.contactText !== undefined ? { contactText: normalized.contactText } : {}),
    rawContent: selectedContext.text ?? "",
    metadata: {
      ...normalized.metadata,
      acquisition: {
        html: selectedContext.html ?? "",
        contexts: [selectedContext],
        metadata: { vacancyEvidenceScope: "SELECTED_VACANCY_REQUIRED" },
      },
    },
    evidenceContent: {
      kind: "SELECTED_VACANCY_CONTEXT",
      context: selectedContext,
    },
  };

  return scoped;
}
