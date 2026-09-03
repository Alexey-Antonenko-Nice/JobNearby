import { describe, expect, it } from "vitest";

import { formatCompensation, formatEngagement, formatLocation, formatWorkMode } from "./formatVacancyFacts";

describe("formatVacancyFacts", () => {
  it("formats raw and structured locations", () => {
    expect(formatLocation({ rawText: "Benfeld, Bas-Rhin, FR" })).toBe("Benfeld, Bas-Rhin, FR");
    expect(formatLocation({ city: "Strasbourg", region: "Grand Est", countryCode: "FR" })).toBe("Strasbourg, Grand Est, FR");
    expect(formatLocation(null)).toBe("Unknown");
  });

  it("formats normalized and raw engagement terms", () => {
    expect(formatEngagement({ normalizedTerms: ["INDEFINITE"] })).toBe("CDI");
    expect(formatEngagement({ rawTerms: ["CONTRACTOR"], normalizedTerms: [] })).toBe("Contractor");
    expect(formatEngagement({ normalizedTerms: ["INDEFINITE", "FIXED_TERM"] })).toBe("CDI · CDD");
    expect(formatEngagement(null)).toBe("Unknown");
  });

  it("formats stored compensation without repairing its bounds", () => {
    expect(formatCompensation({ rawText: "30000 - 35000 EUR / YEAR" })).toBe("30,000–35,000 EUR / year");
    expect(formatCompensation({ rawText: "2100 - 0 EUR / MONTH" })).toBe("2,100–0 EUR / month");
    expect(formatCompensation({ rawText: "12.66 - 0 EUR / HOUR" })).toBe("12.66–0 EUR / hour");
    expect(formatCompensation(null)).toBe("Unknown");
  });

  it("formats known work modes and raw fallbacks", () => {
    expect(formatWorkMode("REMOTE")).toBe("Remote");
    expect(formatWorkMode({ rawText: "Travail a distance" })).toBe("Travail a distance");
    expect(formatWorkMode(null)).toBe("Unknown");
  });
});