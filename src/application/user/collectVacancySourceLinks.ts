import type { SourceObservation } from "../../domain/capture/SourceObservation.js";
import type { VacancySourceLink } from "../../domain/user/VacancySourceLink.js";

export function collectVacancySourceLinks(
  observations: readonly SourceObservation[],
): readonly VacancySourceLink[] {
  const candidates = observations.flatMap((observation) => {
    const url = observation.source.sourceUrl;
    return url === undefined || !isHttpUrl(url) ? [] : [{
      sourceObservationId: observation.id,
      provider: observation.source.sourceName,
      url,
      observedAt: observation.observedAt,
    }];
  }).sort((left, right) =>
    right.observedAt.getTime() - left.observedAt.getTime()
    || left.sourceObservationId.localeCompare(right.sourceObservationId));
  const urls = new Set<string>();
  return candidates.filter(({ url }) => !urls.has(url) && (urls.add(url), true));
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}