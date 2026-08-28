import { describe, expect, it } from "vitest";

import {
  BrowserCaptureAcquisitionAdapter,
  MAX_BROWSER_HTML_BYTES,
  MAX_BROWSER_VISIBLE_TEXT_BYTES,
} from "../../src/application/acquisition/BrowserCaptureAcquisitionAdapter.js";

const adapter = new BrowserCaptureAcquisitionAdapter();

function payload() {
  return {
    pageUrl: "https://www.hellowork.com/fr-fr/emplois/123?source=browser",
    pageTitle: "Technicien Maintenance H/F | Hellowork",
    visibleText: "Technicien Maintenance H/F\r\n\r\nACTUA SAVERNE\r\nHEUFT France",
    capturedAt: "2026-08-28T09:00:00.000Z",
    browserMetadata: { userAgentFamily: "Chromium" },
  } as const;
}

describe("BrowserCaptureAcquisitionAdapter", () => {
  it("maps the generic browser payload without vacancy interpretation", () => {
    const result = adapter.toAcquisitionPackage(payload(), "acquisition-browser-1");
    expect(result).toEqual({
      acquisitionId: "acquisition-browser-1",
      acquiredAt: new Date("2026-08-28T09:00:00.000Z"),
      source: { sourceType: "BROWSER", sourceName: "hellowork.com" },
      sourceUrl: payload().pageUrl,
      externalId: "123",
      pageTitle: payload().pageTitle,
      content: {
        text: "Technicien Maintenance H/F\n\nACTUA SAVERNE\nHEUFT France",
      },
      metadata: { userAgentFamily: "Chromium" },
    });
    expect(result.externalId).toBe("123");
    expect(result.structuredFields).toBeUndefined();
    expect(result).not.toHaveProperty("employer");
  });

  it("preserves the URL exactly and uses the capture timestamp", () => {
    const result = adapter.toAcquisitionPackage(payload(), "acquisition-browser-2");
    expect(result.sourceUrl).toBe(payload().pageUrl);
    expect(result.acquiredAt.toISOString()).toBe(payload().capturedAt);
  });

  it.each([
    ["https://www.hellowork.com/job", "hellowork.com"],
    ["https://fr.indeed.com/viewjob", "indeed.com"],
    ["https://www.meteojob.com/jobs/1", "meteojob.com"],
  ])("derives a conservative source name from %s", (pageUrl, sourceName) => {
    const result = adapter.toAcquisitionPackage({ ...payload(), pageUrl }, "acquisition-host");
    expect(result.source.sourceName).toBe(sourceName);
  });

  it("uses the browser fallback when a valid URL has no hostname", () => {
    const result = adapter.toAcquisitionPackage({
      ...payload(),
      pageUrl: "file:///tmp/vacancy.html",
    }, "acquisition-fallback");
    expect(result.source.sourceName).toBe("browser");
  });

  it("allows empty page titles without promoting them to vacancy titles", () => {
    const result = adapter.toAcquisitionPackage({ ...payload(), pageTitle: "" }, "acquisition-no-title");
    expect(result.pageTitle).toBeUndefined();
    expect(result.structuredFields).toBeUndefined();
  });

  it("preserves optional HTML without parsing it", () => {
    const html = "<html><body><p>HEUFT France</p></body></html>";
    const result = adapter.toAcquisitionPackage({ ...payload(), html }, "acquisition-html");
    expect(result.content.html).toBe(html);
    expect(result.content.text).toContain("HEUFT France");
  });

  it("creates separate packages for repeated captures of the same URL", () => {
    const first = adapter.toAcquisitionPackage(payload(), "acquisition-a");
    const second = adapter.toAcquisitionPackage(payload(), "acquisition-b");
    expect(first.acquisitionId).not.toBe(second.acquisitionId);
    expect(first.sourceUrl).toBe(second.sourceUrl);
  });

  it("does not mutate the browser payload", () => {
    const input = { ...payload(), browserMetadata: { nested: { tabId: 4 } } };
    const snapshot = structuredClone(input);
    const result = adapter.toAcquisitionPackage(input, "acquisition-immutable");
    expect(input).toEqual(snapshot);
    input.browserMetadata.nested.tabId = 8;
    expect(result.metadata).toEqual({ nested: { tabId: 4 } });
  });

  it("rejects missing or malformed URLs", () => {
    expect(() => adapter.toAcquisitionPackage({ ...payload(), pageUrl: "" }, "id")).toThrow(
      "Browser page URL is required.",
    );
    expect(() => adapter.toAcquisitionPackage({ ...payload(), pageUrl: "not a URL" }, "id")).toThrow(
      "Browser page URL must be a valid URL.",
    );
  });

  it("rejects blank visible text and invalid timestamps", () => {
    expect(() => adapter.toAcquisitionPackage({ ...payload(), visibleText: " \n " }, "id")).toThrow(
      "Visible page text is required.",
    );
    expect(() => adapter.toAcquisitionPackage({ ...payload(), capturedAt: "not-a-date" }, "id")).toThrow(
      "Browser capture timestamp must be a valid date.",
    );
  });

  it("rejects oversized text and HTML rather than truncating", () => {
    expect(() => adapter.toAcquisitionPackage({
      ...payload(), visibleText: "x".repeat(MAX_BROWSER_VISIBLE_TEXT_BYTES + 1),
    }, "id")).toThrow(`${MAX_BROWSER_VISIBLE_TEXT_BYTES}-byte limit`);
    expect(() => adapter.toAcquisitionPackage({
      ...payload(), html: "x".repeat(MAX_BROWSER_HTML_BYTES + 1),
    }, "id")).toThrow(`${MAX_BROWSER_HTML_BYTES}-byte limit`);
  });
});
