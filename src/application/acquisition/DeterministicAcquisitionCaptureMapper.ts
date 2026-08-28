import {
  createAcquisitionPackage,
  type AcquisitionPackage,
  type AcquisitionSourceType,
} from "../../domain/acquisition/AcquisitionPackage.js";
import type { SourceObservation, SourceObservationId } from "../../domain/capture/SourceObservation.js";
import type { SourceReference, SourceType } from "../../domain/capture/SourceReference.js";
import type { AcquisitionCaptureMapper } from "./AcquisitionCaptureMapper.js";

const sourceTypeMapping: Readonly<Record<AcquisitionSourceType, SourceType>> = {
  BROWSER: "BROWSER_CAPTURE",
  JOB_BOARD: "JOB_BOARD",
  EMPLOYER_WEBSITE: "EMPLOYER_WEBSITE",
  PUBLIC_API: "PUBLIC_API",
  EMAIL: "EMAIL",
  MANUAL: "MANUAL",
  IMPORT: "OTHER",
  OTHER: "OTHER",
};

export class DeterministicAcquisitionCaptureMapper implements AcquisitionCaptureMapper {
  toSourceObservation(
    input: AcquisitionPackage,
    observationId: SourceObservationId,
  ): SourceObservation {
    const acquisition = createAcquisitionPackage(input);
    const id = observationId.trim();
    if (id.length === 0) throw new Error("Source observation ID is required.");

    const source: SourceReference = {
      sourceType: sourceTypeMapping[acquisition.source.sourceType],
      sourceName: acquisition.source.sourceName,
      ...(acquisition.sourceUrl !== undefined ? { sourceUrl: acquisition.sourceUrl } : {}),
      ...(acquisition.externalId !== undefined ? { externalId: acquisition.externalId } : {}),
    };
    const fields = acquisition.structuredFields;

    return {
      id,
      source,
      observedAt: new Date(acquisition.acquiredAt.getTime()),
      ...(fields?.publishedAt !== undefined
        ? { publishedAt: new Date(fields.publishedAt.getTime()) }
        : {}),
      ...mapStructuredFields(fields),
      rawContent: selectRawContent(acquisition),
      metadata: buildObservationMetadata(acquisition),
    };
  }
}

function mapStructuredFields(fields: AcquisitionPackage["structuredFields"]): Partial<SourceObservation> {
  if (fields === undefined) return {};
  return {
    ...(fields.title !== undefined ? { title: fields.title } : {}),
    ...(fields.displayedCompanyName !== undefined
      ? { displayedCompanyName: fields.displayedCompanyName }
      : {}),
    ...(fields.locationText !== undefined ? { locationText: fields.locationText } : {}),
    ...(fields.salaryText !== undefined ? { salaryText: fields.salaryText } : {}),
    ...(fields.contractText !== undefined ? { contractText: fields.contractText } : {}),
    ...(fields.contactText !== undefined ? { contactText: fields.contactText } : {}),
  };
}

function selectRawContent(acquisition: AcquisitionPackage): string {
  if (acquisition.content.text !== undefined) return acquisition.content.text;
  if (acquisition.content.html !== undefined) return acquisition.content.html;
  const serialized = JSON.stringify(acquisition.content.structuredPayload);
  if (serialized === undefined) {
    throw new Error("Structured acquisition payload cannot be serialized as raw content.");
  }
  return serialized;
}

function buildObservationMetadata(
  acquisition: AcquisitionPackage,
): Readonly<Record<string, unknown>> {
  return structuredClone({
    acquisition: {
      acquisitionId: acquisition.acquisitionId,
      metadata: acquisition.metadata,
      ...(acquisition.pageTitle !== undefined ? { pageTitle: acquisition.pageTitle } : {}),
      ...(acquisition.content.html !== undefined ? { html: acquisition.content.html } : {}),
      ...(acquisition.content.structuredPayload !== undefined
        ? { structuredPayload: acquisition.content.structuredPayload }
        : {}),
    },
  });
}
