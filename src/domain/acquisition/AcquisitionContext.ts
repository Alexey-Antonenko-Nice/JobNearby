import type { ProviderKey } from "./ProviderKey.js";

export type AcquisitionContextKind = "SELECTED_VACANCY";

export type AcquisitionContextAssociationMethod =
  | "GENERIC_SEMANTIC"
  | "PROVIDER_LOCATOR"
  | "USER_SELECTED";

export interface AcquisitionContext {
  readonly kind: AcquisitionContextKind;
  readonly associationMethod: AcquisitionContextAssociationMethod;
  readonly text?: string;
  readonly html?: string;
  readonly providerKey?: ProviderKey;
  readonly providerExternalId?: string;
  readonly associationEvidence?: readonly string[];
  readonly metadata?: Readonly<Record<string, unknown>>;
}

const contextKinds: readonly AcquisitionContextKind[] = ["SELECTED_VACANCY"];
const associationMethods: readonly AcquisitionContextAssociationMethod[] = [
  "GENERIC_SEMANTIC",
  "PROVIDER_LOCATOR",
  "USER_SELECTED",
];

export function createAcquisitionContext(input: AcquisitionContext): AcquisitionContext {
  if (!contextKinds.includes(input.kind)) {
    throw new Error("Acquisition context kind is invalid.");
  }
  if (!associationMethods.includes(input.associationMethod)) {
    throw new Error("Acquisition context association method is invalid.");
  }

  const text = optionalRawContent(input.text);
  const html = optionalRawContent(input.html);
  if (text === undefined && html === undefined) {
    throw new Error("Acquisition context requires text or HTML.");
  }

  const associationEvidence = input.associationEvidence?.map((value) =>
    requireText(value, "Acquisition context association evidence"));
  if (
    input.providerKey !== undefined &&
    input.providerKey !== "FRANCE_TRAVAIL" &&
    input.providerKey !== "INDEED" &&
    input.providerKey !== "LINKEDIN"
  ) {
    throw new Error("Acquisition context provider key is invalid.");
  }

  return {
    kind: input.kind,
    associationMethod: input.associationMethod,
    ...(text !== undefined ? { text } : {}),
    ...(html !== undefined ? { html } : {}),
    ...(input.providerKey !== undefined ? { providerKey: input.providerKey } : {}),
    ...(optionalText(input.providerExternalId) !== undefined
      ? { providerExternalId: input.providerExternalId!.trim() }
      : {}),
    ...(associationEvidence !== undefined ? { associationEvidence } : {}),
    ...(input.metadata !== undefined ? { metadata: structuredClone(input.metadata) } : {}),
  };
}

function optionalText(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new Error("Acquisition context text values must be strings.");
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

function optionalRawContent(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new Error("Acquisition context content must be a string.");
  return value.trim().length === 0 ? undefined : value;
}

function requireText(value: unknown, label: string): string {
  const text = optionalText(value);
  if (text === undefined) throw new Error(`${label} is required.`);
  return text;
}
