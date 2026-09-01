export function extractLinkedInVacancyId(url: URL): string | undefined {
  if (!url.pathname.startsWith("/jobs/")) return undefined;

  const queryId = optionalParameter(url, "currentJobId");
  const pathId = /^\/jobs\/view\/(?:[^/]+-)?([1-9]\d{5,19})\/?$/u.exec(
    url.pathname,
  )?.[1];
  if (queryId !== undefined && pathId !== undefined && queryId !== pathId) {
    return undefined;
  }
  return queryId ?? pathId;
}

function optionalParameter(url: URL, name: string): string | undefined {
  const value = url.searchParams.get(name);
  return value === null || value.trim().length === 0 ? undefined : value.trim();
}
