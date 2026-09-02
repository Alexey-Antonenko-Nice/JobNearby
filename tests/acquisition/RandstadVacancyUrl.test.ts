import { describe, expect, it } from "vitest";

import { extractRandstadVacancyId, normalizeRandstadVacancyUrl } from "../../src/application/acquisition/RandstadVacancyUrl.js";

describe("RandstadVacancyUrl", () => {
  it("extracts the native listing suffix and normalizes only supported vacancy URLs", () => {
    const url = "https://www.randstad.fr/emploi/monteur-assembleur-fh_molsheim_001-mmo-0000054_10l/?utm_source=chatgpt.com#details";
    expect(extractRandstadVacancyId(new URL(url))).toBe("001-mmo-0000054_10l");
    expect(normalizeRandstadVacancyUrl(url)).toBe("https://www.randstad.fr/emploi/monteur-assembleur-fh_molsheim_001-mmo-0000054_10l/");
  });

  it("accepts an equivalent host and rejects unsupported routes", () => {
    expect(extractRandstadVacancyId(new URL("https://randstad.fr/emploi/x_001-sel-1743760_01c"))).toBe("001-sel-1743760_01c");
    expect(normalizeRandstadVacancyUrl("https://www.randstad.fr/emploi/")).toBeUndefined();
  });
});