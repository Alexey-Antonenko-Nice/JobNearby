import { describe, expect, it } from "vitest";

import { createBrowserCapturePayload } from "../../browser-extension/capture-page.js";

describe("browser extension page capture", () => {
  it("captures a generic fixture page as visible text without interpreting it", () => {
    const visibleText = `
Technicien Maintenance H/F

ACTUA SAVERNE

Nous recherchons pour l'un de nos clients,
HEUFT France...

CDI
Brumath
`;
    const result = createBrowserCapturePayload({
      pageUrl: "https://example.test/vacancy",
      pageTitle: "Fixture vacancy page",
      visibleText,
      html: "<html><body>fixture</body></html>",
    }, "2026-08-28T10:30:00.000Z");
    expect(result).toMatchObject({
      pageUrl: "https://example.test/vacancy",
      pageTitle: "Fixture vacancy page",
      capturedAt: "2026-08-28T10:30:00.000Z",
      html: "<html><body>fixture</body></html>",
    });
    expect(result.visibleText).toContain("ACTUA SAVERNE");
    expect(result.visibleText).toContain("HEUFT France");
    expect(result).not.toHaveProperty("employer");
    expect(result).not.toHaveProperty("title");
    expect(result).not.toHaveProperty("contract");
    expect(result).not.toHaveProperty("location");
  });
});
