const route = /^\/emploi\/[^/]+_([a-z0-9]+(?:-[a-z0-9]+)+_[a-z0-9]+)\/?$/iu;

export function extractRandstadVacancyId(url: URL): string | undefined {
  if (normalizeHostname(url.hostname) !== "randstad.fr") return undefined;
  return route.exec(url.pathname)?.[1];
}

export function normalizeRandstadVacancyUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    if (extractRandstadVacancyId(url) === undefined) return undefined;
    url.protocol = "https:";
    url.hostname = "www.randstad.fr";
    url.search = "";
    url.hash = "";
    url.pathname = url.pathname.endsWith("/") ? url.pathname : `${url.pathname}/`;
    return url.toString();
  } catch {
    return undefined;
  }
}

function normalizeHostname(hostname: string): string {
  const value = hostname.toLocaleLowerCase();
  return value.startsWith("www.") ? value.slice(4) : value;
}