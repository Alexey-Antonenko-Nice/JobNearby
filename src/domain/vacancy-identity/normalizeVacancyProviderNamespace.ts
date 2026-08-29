export function normalizeVacancyProviderNamespace(value: string): string {
  return value.trim().replace(/\s+/gu, " ").toLocaleLowerCase();
}
