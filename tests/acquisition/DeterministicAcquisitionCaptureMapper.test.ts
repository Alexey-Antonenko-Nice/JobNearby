import { describe, expect, it } from "vitest";

import { DeterministicAcquisitionCaptureMapper } from "../../src/application/acquisition/DeterministicAcquisitionCaptureMapper.js";
import {
  createAcquisitionPackage,
  type AcquisitionPackage,
  type AcquisitionSourceType,
} from "../../src/domain/acquisition/AcquisitionPackage.js";

const acquiredAt = new Date("2026-08-20T10:00:00Z");
const publishedAt = new Date("2026-08-19T08:00:00Z");
const mapper = new DeterministicAcquisitionCaptureMapper();

function packageWith(overrides: Partial<AcquisitionPackage> = {}): AcquisitionPackage {
  return {
    acquisitionId: "acquisition-1",
    acquiredAt,
    source: { sourceType: "MANUAL", sourceName: "Manual paste" },
    content: { text: "Raw vacancy text" },
    metadata: {},
    ...overrides,
  };
}

describe("AcquisitionPackage validation", () => {
  it("rejects an empty acquisition ID", () => {
    expect(() => createAcquisitionPackage(packageWith({ acquisitionId: " " }))).toThrow(
      "Acquisition ID is required.",
    );
  });

  it("rejects an empty source name", () => {
    expect(() => createAcquisitionPackage(packageWith({
      source: { sourceType: "MANUAL", sourceName: " " },
    }))).toThrow("Acquisition source name is required.");
  });

  it("rejects unsupported source types", () => {
    expect(() => createAcquisitionPackage(packageWith({
      source: { sourceType: "PROVIDER" as AcquisitionSourceType, sourceName: "X" },
    }))).toThrow("Acquisition source type is invalid.");
  });

  it("rejects packages with no usable content", () => {
    expect(() => createAcquisitionPackage(packageWith({ content: {} }))).toThrow(
      "Acquisition content requires text, HTML, or a structured payload.",
    );
    expect(() => createAcquisitionPackage(packageWith({ content: { text: "  " } }))).toThrow();
  });

  it("rejects invalid acquisition and publication dates", () => {
    expect(() => createAcquisitionPackage(packageWith({ acquiredAt: new Date("invalid") }))).toThrow(
      "Acquisition date must be a valid Date.",
    );
    expect(() => createAcquisitionPackage(packageWith({
      structuredFields: { publishedAt: new Date("invalid") },
    }))).toThrow("Publication date must be a valid Date.");
  });

  it("accepts extensible structured payloads and metadata", () => {
    const result = createAcquisitionPackage(packageWith({
      content: { structuredPayload: { nested: [1, { active: true }] } },
      metadata: { request: { locale: "fr-FR" } },
    }));
    expect(result.content.structuredPayload).toEqual({ nested: [1, { active: true }] });
    expect(result.metadata).toEqual({ request: { locale: "fr-FR" } });
  });
});

describe("DeterministicAcquisitionCaptureMapper", () => {
  it("maps a manual text package without inventing optional fields", () => {
    const observation = mapper.toSourceObservation(packageWith(), "observation-manual");
    expect(observation).toEqual({
      id: "observation-manual",
      source: { sourceType: "MANUAL", sourceName: "Manual paste" },
      observedAt: acquiredAt,
      rawContent: "Raw vacancy text",
      metadata: { acquisition: { acquisitionId: "acquisition-1", metadata: {} } },
    });
    expect("publishedAt" in observation).toBe(false);
  });

  it("maps every transport-neutral source type to the closest capture source type", () => {
    const mappings = {
      BROWSER: "BROWSER_CAPTURE",
      JOB_BOARD: "JOB_BOARD",
      EMPLOYER_WEBSITE: "EMPLOYER_WEBSITE",
      PUBLIC_API: "PUBLIC_API",
      EMAIL: "EMAIL",
      MANUAL: "MANUAL",
      IMPORT: "OTHER",
      OTHER: "OTHER",
    } as const;
    for (const [sourceType, expected] of Object.entries(mappings)) {
      const observation = mapper.toSourceObservation(packageWith({
        source: { sourceType: sourceType as AcquisitionSourceType, sourceName: "Source name" },
      }), `observation-${sourceType}`);
      expect(observation.source).toEqual({ sourceType: expected, sourceName: "Source name" });
    }
  });

  it("preserves browser text and HTML, selecting text as raw content", () => {
    const observation = mapper.toSourceObservation(packageWith({
      source: { sourceType: "BROWSER", sourceName: "Browser capture" },
      pageTitle: "Vacancy browser tab",
      content: { text: "  Visible page text  ", html: "<main>Vacancy</main>" },
    }), "browser-observation");
    expect(observation.rawContent).toBe("  Visible page text  ");
    expect(observation.metadata).toEqual({
      acquisition: {
        acquisitionId: "acquisition-1",
        metadata: {},
        pageTitle: "Vacancy browser tab",
        html: "<main>Vacancy</main>",
      },
    });
    expect("title" in observation).toBe(false);
  });

  it("uses HTML as raw content when text is absent", () => {
    const observation = mapper.toSourceObservation(packageWith({
      content: { html: "<article>Job</article>" },
    }), "html-observation");
    expect(observation.rawContent).toBe("<article>Job</article>");
  });

  it("maps job-board structured fields, source URL, and external ID without interpretation", () => {
    const observation = mapper.toSourceObservation(packageWith({
      source: { sourceType: "JOB_BOARD", sourceName: "Hellowork" },
      sourceUrl: "https://example.test/jobs/42?tracking=kept",
      externalId: "provider-42",
      structuredFields: {
        title: "Technicien de maintenance",
        displayedCompanyName: "ACTUA SAVERNE",
        locationText: "Saverne",
        salaryText: "35–40 k€",
        contractText: "CDI",
        contactText: "Contact recrutement",
        publishedAt,
      },
    }), "observation-job-board");
    expect(observation).toMatchObject({
      id: "observation-job-board",
      source: {
        sourceType: "JOB_BOARD",
        sourceName: "Hellowork",
        sourceUrl: "https://example.test/jobs/42?tracking=kept",
        externalId: "provider-42",
      },
      observedAt: acquiredAt,
      publishedAt,
      title: "Technicien de maintenance",
      displayedCompanyName: "ACTUA SAVERNE",
      locationText: "Saverne",
      salaryText: "35–40 k€",
      contractText: "CDI",
      contactText: "Contact recrutement",
    });
    expect(observation).not.toHaveProperty("employer");
  });

  it("serializes an API payload as raw content and preserves it in metadata", () => {
    const payload = { offer: { id: 7, title: "Engineer" } };
    const observation = mapper.toSourceObservation(packageWith({
      source: { sourceType: "PUBLIC_API", sourceName: "Public vacancies API" },
      content: { structuredPayload: payload },
      metadata: { responseStatus: 200 },
    }), "api-observation");
    expect(observation.rawContent).toBe(JSON.stringify(payload));
    expect(observation.metadata).toEqual({
      acquisition: {
        acquisitionId: "acquisition-1",
        metadata: { responseStatus: 200 },
        structuredPayload: payload,
      },
    });
  });

  it("preserves all extra representations when text, HTML, and payload coexist", () => {
    const observation = mapper.toSourceObservation(packageWith({
      content: { text: "text", html: "<p>html</p>", structuredPayload: { id: 1 } },
    }), "rich-observation");
    expect(observation.rawContent).toBe("text");
    expect(observation.metadata.acquisition).toEqual({
      acquisitionId: "acquisition-1",
      metadata: {},
      html: "<p>html</p>",
      structuredPayload: { id: 1 },
    });
  });

  it("keeps acquiredAt and publishedAt distinct", () => {
    const observation = mapper.toSourceObservation(packageWith({
      structuredFields: { publishedAt },
    }), "dated-observation");
    expect(observation.observedAt).toEqual(acquiredAt);
    expect(observation.publishedAt).toEqual(publishedAt);
    expect(observation.observedAt).not.toEqual(observation.publishedAt);
  });

  it("uses the caller's observation ID and never substitutes acquisition or external IDs", () => {
    const observation = mapper.toSourceObservation(packageWith({
      acquisitionId: "acquisition-event-id",
      externalId: "provider-id",
    }), "caller-observation-id");
    expect(observation.id).toBe("caller-observation-id");
    expect(observation.id).not.toBe("acquisition-event-id");
    expect(observation.id).not.toBe("provider-id");
  });

  it("rejects an empty caller-supplied observation ID", () => {
    expect(() => mapper.toSourceObservation(packageWith(), " ")).toThrow(
      "Source observation ID is required.",
    );
  });

  it("allows repeated capture of the same provider external ID as separate observations", () => {
    const first = mapper.toSourceObservation(packageWith({
      externalId: "d559a370adf21f3b",
    }), "observation-a");
    const second = mapper.toSourceObservation(packageWith({
      acquisitionId: "acquisition-2",
      acquiredAt: new Date("2026-08-21T10:00:00Z"),
      externalId: "d559a370adf21f3b",
    }), "observation-b");
    expect(first.id).not.toBe(second.id);
    expect(first.source.externalId).toBe(second.source.externalId);
  });

  it("preserves the ACTUA/HEUFT source wording without employer recognition", () => {
    const observation = mapper.toSourceObservation(packageWith({
      source: { sourceType: "JOB_BOARD", sourceName: "Hellowork" },
      content: { text: "Nous recherchons pour l'un de nos clients, HEUFT France." },
      structuredFields: { displayedCompanyName: "ACTUA SAVERNE" },
    }), "actua-observation");
    expect(observation.displayedCompanyName).toBe("ACTUA SAVERNE");
    expect(observation.rawContent).toContain("HEUFT France");
    expect(observation).not.toHaveProperty("employer");
    expect(observation).not.toHaveProperty("canonicalVacancyId");
  });

  it("does not mutate inputs and returns values independent from later caller mutation", () => {
    const payload = { nested: { value: 1 } };
    const metadata = { browser: { tabId: 7 } };
    const callerAcquiredAt = new Date("2026-08-20T10:00:00Z");
    const input = packageWith({
      acquiredAt: callerAcquiredAt,
      content: { structuredPayload: payload },
      structuredFields: { title: "Original", publishedAt },
      metadata,
    });
    const snapshot = structuredClone(input);
    const observation = mapper.toSourceObservation(input, "immutable-observation");
    expect(input).toEqual(snapshot);
    payload.nested.value = 2;
    metadata.browser.tabId = 8;
    callerAcquiredAt.setUTCFullYear(2000);
    expect(observation.observedAt.toISOString()).toBe("2026-08-20T10:00:00.000Z");
    expect(observation.metadata).toEqual({
      acquisition: {
        acquisitionId: "acquisition-1",
        metadata: { browser: { tabId: 7 } },
        structuredPayload: { nested: { value: 1 } },
      },
    });
  });

  it("is deterministic for the same package and observation ID", () => {
    const input = packageWith({ structuredFields: { title: "Role" } });
    expect(mapper.toSourceObservation(input, "same-id")).toEqual(
      mapper.toSourceObservation(input, "same-id"),
    );
  });
});
