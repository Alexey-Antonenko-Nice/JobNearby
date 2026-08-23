import { describe, expect, it } from "vitest";

import { areEmployerIndustriesIncompatible } from "../../src/domain/recognition/EmployerIndustryCompatibility.js";

describe("EmployerIndustryCompatibility", () => {
  it.each([
    ["food solutions", "concrete manufacturing"],
    ["food manufacturing", "railway rolling-stock manufacturing"],
    ["concrete manufacturing", "railway rolling stock manufacturing"],
  ])("keeps known concrete industries incompatible: %s / %s", (left, right) => {
    expect(areEmployerIndustriesIncompatible(left, right)).toBe(true);
    expect(areEmployerIndustriesIncompatible(right, left)).toBe(true);
  });

  it.each([
    ["food solutions", "food manufacturing"],
    ["concrete manufacturing", "concrete manufacturing"],
    ["paper manufacturing", "concrete manufacturing"],
    ["17 sites", "1,150 employees"],
  ])("does not invent incompatibility: %s / %s", (left, right) => {
    expect(areEmployerIndustriesIncompatible(left, right)).toBe(false);
  });
});
