import { createHash } from "node:crypto";

import type { SourceObservation } from "../../domain/capture/SourceObservation.js";

export function browserCaptureFingerprint(observation: SourceObservation): string {
  const acquisition = observation.metadata.acquisition;
  const contexts = isRecord(acquisition) && Array.isArray(acquisition.contexts)
    ? acquisition.contexts.map((context) => isRecord(context) ? {
      kind: context.kind, providerKey: context.providerKey, providerExternalId: context.providerExternalId,
      text: context.text, html: context.html,
    } : context)
    : [];
  const value = JSON.stringify({
    rawContent: observation.rawContent ?? null,
    title: observation.title ?? null, displayedCompanyName: observation.displayedCompanyName ?? null,
    locationText: observation.locationText ?? null, salaryText: observation.salaryText ?? null,
    contractText: observation.contractText ?? null, contactText: observation.contactText ?? null,
    contexts, structuredPayload: isRecord(acquisition) ? acquisition.structuredPayload ?? null : null,
  });
  return createHash("sha256").update(value).digest("hex");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}