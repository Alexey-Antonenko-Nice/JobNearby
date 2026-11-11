export type ExplicitIdentityReconciliation =
  | { readonly status: "MATCH" }
  | { readonly status: "MISSING_REQUIRED_PROOF" }
  | { readonly status: "CONFLICT" }
  | { readonly status: "INVALID_ID" };

export function reconcileExplicitIdentity(
  primaryId: string,
  associatedIds: readonly string[],
  options: { readonly requireExplicitMatch?: boolean } = {},
): ExplicitIdentityReconciliation {
  if (!primaryId.trim() || associatedIds.some(id => !id.trim())) return { status: "INVALID_ID" };
  if (associatedIds.some(id => id !== primaryId)) return { status: "CONFLICT" };
  if (options.requireExplicitMatch && associatedIds.length === 0) return { status: "MISSING_REQUIRED_PROOF" };
  return { status: "MATCH" };
}
