import { describe, expect, it } from "vitest";
import { JSDOM } from "jsdom";

import { captureDocumentSnapshot } from "../../browser-extension/popup.js";

describe("browser extension shadow root serialization", () => {
  it("copies open shadow content under its host, including nested roots", () => {
    const dom = new JSDOM(`<!doctype html><html><body><my-host id="h"></my-host><p>light</p></body></html>`, {
      url: "https://candidat.francetravail.fr/offres/recherche/detail/213CWRC",
    });
    const host = dom.window.document.getElementById("h");
    const root = host.attachShadow({ mode: "open" });
    root.innerHTML = `<section>Critères de l'offre</section><inner-host></inner-host>`;
    root.querySelector("inner-host").attachShadow({ mode: "open" }).innerHTML = `<b>Entreprise MOBALPA</b>`;
    const saved = { document: globalThis.document, window: globalThis.window };
    globalThis.document = dom.window.document;
    globalThis.window = dom.window;
    try {
      const snapshot = captureDocumentSnapshot();
      expect(snapshot.html).toMatch(/<my-host id="h"><div data-jn-shadow-root="open"><section>Critères de l'offre<\/section><inner-host><div data-jn-shadow-root="open"><b>Entreprise MOBALPA<\/b>/u);
      expect(snapshot.html).toContain("<p>light</p>");
      expect(dom.window.document.documentElement.outerHTML).not.toContain("data-jn-shadow-root");
    } finally {
      globalThis.document = saved.document;
      globalThis.window = saved.window;
    }
  });
});
