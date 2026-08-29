export function normalizeEmployerClusterSearchHint(
  value: string | undefined,
): string | undefined {
  const normalized = value?.trim().toLocaleLowerCase();
  return normalized === undefined || normalized.length === 0
    ? undefined
    : normalized;
}
