import type { CanonicalVacancyId } from "./CanonicalVacancy.js";

export class CanonicalVacancyStaleProjectionError extends Error {
  constructor(readonly canonicalVacancyId: CanonicalVacancyId) {
    super(
      `Canonical vacancy "${canonicalVacancyId}" was derived from a stale observation claim set.`,
    );
    this.name = "CanonicalVacancyStaleProjectionError";
  }
}
