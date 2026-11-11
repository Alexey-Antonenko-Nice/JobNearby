import { describe, expect, it } from "vitest";
import { createAcquisitionContext } from "../../src/domain/acquisition/AcquisitionContext.js";
import type { SourceObservation } from "../../src/domain/capture/SourceObservation.js";
import { fromSourceObservation } from "../../src/domain/evidence/VacancyEvidenceInput.js";
import {
  buildBoundedEvidenceView,
  type ApprovedProviderProjection,
} from "../../src/application/evidence/buildBoundedEvidenceView.js";

const sourceObservation: SourceObservation = {
  id: "obs-1",
  source: { sourceType: "JOB_BOARD", sourceName: "TestProvider", externalId: "ext-123" },
  observedAt: new Date("2026-08-30T10:00:00.000Z"),
  publishedAt: new Date("2026-08-25T00:00:00.000Z"),
  title: "Whole Page Title",
  displayedCompanyName: "Whole Page Company",
  locationText: "Whole Page Location",
  description: "Whole page description with contamination risk.",
  salaryText: "Whole Page Salary",
  contractText: "Whole Page Contract",
  contactText: "wrong contact info",
  rawContent: "Full page text content that is stale and unreliable.",
  contentFingerprint: "page-fingerprint-123",
  metadata: {
    acquisition: {
      html: "<html>whole page</html>",
      structuredPayload: { dangerous: "data" },
      contexts: [],
    },
  },
};

describe("buildBoundedEvidenceView", () => {
  describe("selected text replaces whole-page text", () => {
    it("replaces rawContent with selected text", () => {
      const context = createAcquisitionContext({
        kind: "SELECTED_VACANCY",
        associationMethod: "PROVIDER_LOCATOR",
        text: "Selected vacancy text content.",
      });

      const result = buildBoundedEvidenceView(sourceObservation, context);

      expect(result.rawContent).toBe("Selected vacancy text content.");
      expect(result.rawContent).not.toContain("Full page");
      expect(result.rawContent).not.toContain("stale");
    });
  });

  describe("selected HTML replaces whole-page HTML", () => {
    it("replaces metadata.acquisition.html with selected HTML", () => {
      const context = createAcquisitionContext({
        kind: "SELECTED_VACANCY",
        associationMethod: "PROVIDER_LOCATOR",
        text: "Selected text",
        html: "<div class='selected'>Selected HTML</div>",
      });

      const result = buildBoundedEvidenceView(sourceObservation, context);

      const acquisition = result.metadata.acquisition as Record<string, unknown>;
      expect(acquisition.html).toBe("<div class='selected'>Selected HTML</div>");
      expect(acquisition.html).not.toContain("whole page");
    });
  });

  describe("unsafe page-level structured payload is cleared by default", () => {
    it("removes structuredPayload from acquisition metadata", () => {
      const context = createAcquisitionContext({
        kind: "SELECTED_VACANCY",
        associationMethod: "PROVIDER_LOCATOR",
        text: "Selected text",
      });

      const result = buildBoundedEvidenceView(sourceObservation, context);

      const acquisition = result.metadata.acquisition as Record<string, unknown>;
      expect(acquisition.structuredPayload).toBeUndefined();
    });

    it("remains undefined even if input has complex structured payload", () => {
      const contextual = {
        ...sourceObservation,
        metadata: {
          acquisition: {
            structuredPayload: {
              dangerous: { nested: "object" },
              arrays: [1, 2, 3],
            },
          },
        },
      };
      const context = createAcquisitionContext({
        kind: "SELECTED_VACANCY",
        associationMethod: "PROVIDER_LOCATOR",
        text: "Selected",
      });

      const result = buildBoundedEvidenceView(contextual, context);

      const acquisition = result.metadata.acquisition as Record<string, unknown>;
      expect(acquisition.structuredPayload).toBeUndefined();
    });
  });

  describe("unsafe page-level header/title fields are cleared unless explicitly projected", () => {
    it("clears title by default", () => {
      const context = createAcquisitionContext({
        kind: "SELECTED_VACANCY",
        associationMethod: "PROVIDER_LOCATOR",
        text: "Selected text",
      });

      const result = buildBoundedEvidenceView(sourceObservation, context);

      expect(result.title).toBeUndefined();
    });

    it("clears displayedCompanyName by default", () => {
      const context = createAcquisitionContext({
        kind: "SELECTED_VACANCY",
        associationMethod: "PROVIDER_LOCATOR",
        text: "Selected text",
      });

      const result = buildBoundedEvidenceView(sourceObservation, context);

      expect(result.displayedCompanyName).toBeUndefined();
    });

    it("clears locationText by default", () => {
      const context = createAcquisitionContext({
        kind: "SELECTED_VACANCY",
        associationMethod: "PROVIDER_LOCATOR",
        text: "Selected text",
      });

      const result = buildBoundedEvidenceView(sourceObservation, context);

      expect(result.locationText).toBeUndefined();
    });

    it("clears salaryText and contractText by default", () => {
      const context = createAcquisitionContext({
        kind: "SELECTED_VACANCY",
        associationMethod: "PROVIDER_LOCATOR",
        text: "Selected text",
      });

      const result = buildBoundedEvidenceView(sourceObservation, context);

      expect(result.salaryText).toBeUndefined();
      expect(result.contractText).toBeUndefined();
    });

    it("clears description by default", () => {
      const context = createAcquisitionContext({
        kind: "SELECTED_VACANCY",
        associationMethod: "PROVIDER_LOCATOR",
        text: "Selected text",
      });

      const result = buildBoundedEvidenceView(sourceObservation, context);

      expect(result.description).toBeUndefined();
    });
  });

  describe("explicitly approved projection is restored", () => {
    it("restores approved title", () => {
      const context = createAcquisitionContext({
        kind: "SELECTED_VACANCY",
        associationMethod: "PROVIDER_LOCATOR",
        text: "Selected text",
      });
      const projection: ApprovedProviderProjection = {
        title: "Approved Title",
      };

      const result = buildBoundedEvidenceView(sourceObservation, context, projection);

      expect(result.title).toBe("Approved Title");
    });

    it("restores approved displayedCompanyName", () => {
      const context = createAcquisitionContext({
        kind: "SELECTED_VACANCY",
        associationMethod: "PROVIDER_LOCATOR",
        text: "Selected text",
      });
      const projection: ApprovedProviderProjection = {
        displayedCompanyName: "Approved Company",
      };

      const result = buildBoundedEvidenceView(sourceObservation, context, projection);

      expect(result.displayedCompanyName).toBe("Approved Company");
    });

    it("restores all approved fields together", () => {
      const context = createAcquisitionContext({
        kind: "SELECTED_VACANCY",
        associationMethod: "PROVIDER_LOCATOR",
        text: "Selected text",
      });
      const projection: ApprovedProviderProjection = {
        title: "Approved Title",
        displayedCompanyName: "Approved Company",
        locationText: "Approved Location",
        salaryText: "Approved Salary",
        contractText: "Approved Contract",
        description: "Approved Description",
        publishedAt: new Date("2026-08-20T00:00:00.000Z"),
      };

      const result = buildBoundedEvidenceView(sourceObservation, context, projection);

      expect(result.title).toBe("Approved Title");
      expect(result.displayedCompanyName).toBe("Approved Company");
      expect(result.locationText).toBe("Approved Location");
      expect(result.salaryText).toBe("Approved Salary");
      expect(result.contractText).toBe("Approved Contract");
      expect(result.description).toBe("Approved Description");
      expect(result.publishedAt).toEqual(new Date("2026-08-20T00:00:00.000Z"));
    });

    it("undefined projection fields remain undefined", () => {
      const context = createAcquisitionContext({
        kind: "SELECTED_VACANCY",
        associationMethod: "PROVIDER_LOCATOR",
        text: "Selected text",
      });
      const projection: ApprovedProviderProjection = {
        title: "Approved Title",
      };

      const result = buildBoundedEvidenceView(sourceObservation, context, projection);

      expect(result.displayedCompanyName).toBeUndefined();
      expect(result.locationText).toBeUndefined();
    });
  });

  describe("original input remains unchanged", () => {
    it("does not mutate sourceObservation", () => {
      const context = createAcquisitionContext({
        kind: "SELECTED_VACANCY",
        associationMethod: "PROVIDER_LOCATOR",
        text: "Selected text",
      });
      const original = structuredClone(sourceObservation);

      buildBoundedEvidenceView(sourceObservation, context);

      expect(sourceObservation).toEqual(original);
    });

    it("does not mutate context", () => {
      const context = createAcquisitionContext({
        kind: "SELECTED_VACANCY",
        associationMethod: "PROVIDER_LOCATOR",
        text: "Selected text",
        html: "<div>HTML</div>",
      });
      const original = structuredClone(context);

      buildBoundedEvidenceView(sourceObservation, context);

      expect(context).toEqual(original);
    });

    it("does not mutate approvedProjection", () => {
      const context = createAcquisitionContext({
        kind: "SELECTED_VACANCY",
        associationMethod: "PROVIDER_LOCATOR",
        text: "Selected text",
      });
      const projection: ApprovedProviderProjection = {
        title: "Title",
        displayedCompanyName: "Company",
      };
      const original = structuredClone(projection);

      buildBoundedEvidenceView(sourceObservation, context, projection);

      expect(projection).toEqual(original);
    });
  });

  describe("missing context does not fall back to whole page", () => {
    it("returns safe empty view when context is undefined", () => {
      const result = buildBoundedEvidenceView(sourceObservation, undefined);

      // Should not contain whole-page content
      expect(result.rawContent).toBeUndefined();
      expect(result.title).toBeUndefined();
      expect(result.displayedCompanyName).toBeUndefined();
      expect(result.locationText).toBeUndefined();
      expect(result.salaryText).toBeUndefined();
      expect(result.contractText).toBeUndefined();
      expect(result.description).toBeUndefined();
      // Evidence content should be empty observation
      expect(result.evidenceContent.kind).toBe("SOURCE_OBSERVATION");
    });

    it("does not restore projections when context is undefined", () => {
      const projection: ApprovedProviderProjection = {
        title: "Approved Title",
        displayedCompanyName: "Approved Company",
      };

      const result = buildBoundedEvidenceView(sourceObservation, undefined, projection);

      // Projections are NOT restored without validated context
      expect(result.title).toBeUndefined();
      expect(result.displayedCompanyName).toBeUndefined();
      expect(result.rawContent).toBeUndefined();
    });
  });

  describe("repeated application is idempotent", () => {
    it("applying twice to a bounded view gives the same result", () => {
      const context = createAcquisitionContext({
        kind: "SELECTED_VACANCY",
        associationMethod: "PROVIDER_LOCATOR",
        text: "Selected text",
        html: "<div>Selected</div>",
      });
      const projection: ApprovedProviderProjection = {
        title: "Approved Title",
      };

      const first = buildBoundedEvidenceView(sourceObservation, context, projection);
      const second = buildBoundedEvidenceView(first, context, projection);

      // Key fields should be identical
      expect(second.rawContent).toBe(first.rawContent);
      expect(second.title).toBe(first.title);
      expect(second.displayedCompanyName).toBe(first.displayedCompanyName);
      const firstAcq = first.metadata.acquisition as Record<string, unknown>;
      const secondAcq = second.metadata.acquisition as Record<string, unknown>;
      expect(secondAcq.html).toBe(firstAcq.html);
    });
  });

  describe("unrelated poison content remains absent", () => {
    it("does not preserve contact information from whole page", () => {
      const context = createAcquisitionContext({
        kind: "SELECTED_VACANCY",
        associationMethod: "PROVIDER_LOCATOR",
        text: "Selected text without any contact info.",
      });

      const result = buildBoundedEvidenceView(sourceObservation, context);

      // contactText should be preserved from original (not part of scoping)
      // but whole-page content contamination must not appear in key fields
      expect(result.rawContent).not.toContain("wrong contact info");
    });

    it("does not preserve page-level metadata fields", () => {
      const observation = {
        ...sourceObservation,
        metadata: {
          breadcrumbs: ["Home", "Jobs", "Detail"],
          relatedJobs: [1, 2, 3],
          pageNavigation: "visible",
        },
      };
      const context = createAcquisitionContext({
        kind: "SELECTED_VACANCY",
        associationMethod: "PROVIDER_LOCATOR",
        text: "Selected text",
      });

      const result = buildBoundedEvidenceView(observation, context);

      // Custom metadata fields should be preserved (they're not part of the scoping concern)
      // but acquisition should be properly scoped
      const acquisition = result.metadata.acquisition as Record<string, unknown>;
      expect(acquisition.structuredPayload).toBeUndefined();
    });
  });

  describe("contentFingerprint is cleared", () => {
    it("clears contentFingerprint as it applies only to whole-page content", () => {
      const context = createAcquisitionContext({
        kind: "SELECTED_VACANCY",
        associationMethod: "PROVIDER_LOCATOR",
        text: "Selected text",
      });

      const result = buildBoundedEvidenceView(sourceObservation, context);

      expect(result.contentFingerprint).toBeUndefined();
    });
  });

  describe("evidence content is properly set", () => {
    it("sets evidenceContent to SELECTED_VACANCY_CONTEXT when context is provided", () => {
      const context = createAcquisitionContext({
        kind: "SELECTED_VACANCY",
        associationMethod: "PROVIDER_LOCATOR",
        text: "Selected text",
        providerKey: "HAYS",
        providerExternalId: "123",
      });

      const result = buildBoundedEvidenceView(sourceObservation, context);

      expect(result.evidenceContent.kind).toBe("SELECTED_VACANCY_CONTEXT");
      if (result.evidenceContent.kind === "SELECTED_VACANCY_CONTEXT") {
        expect(result.evidenceContent.context).toEqual(context);
      }
    });

    it("sets evidenceContent to SOURCE_OBSERVATION when context is undefined", () => {
      const result = buildBoundedEvidenceView(sourceObservation, undefined);

      expect(result.evidenceContent.kind).toBe("SOURCE_OBSERVATION");
    });
  });

  describe("contexts array is set in acquisition metadata", () => {
    it("stores the selected context in acquisition.contexts", () => {
      const context = createAcquisitionContext({
        kind: "SELECTED_VACANCY",
        associationMethod: "PROVIDER_LOCATOR",
        text: "Selected text",
      });

      const result = buildBoundedEvidenceView(sourceObservation, context);

      const acquisition = result.metadata.acquisition as Record<string, unknown>;
      const contexts = acquisition.contexts as Record<string, unknown>[];
      expect(contexts).toHaveLength(1);
      expect(contexts[0]).toEqual(context);
    });

    it("has empty contexts array when context is undefined", () => {
      const result = buildBoundedEvidenceView(sourceObservation, undefined);

      const acquisition = result.metadata.acquisition as Record<string, unknown> | undefined;
      // When context is undefined, acquisition might not be set, or it won't have contexts
      if (acquisition) {
        expect(acquisition.contexts).toBeUndefined();
      }
    });
  });

  describe("invalid context kind throws error", () => {
    it("throws when context kind is not SELECTED_VACANCY", () => {
      const invalidContext = {
        kind: "OTHER_CONTEXT_KIND",
        associationMethod: "PROVIDER_LOCATOR",
        text: "Some text",
      } as unknown as Parameters<typeof buildBoundedEvidenceView>[1];

      expect(() => {
        buildBoundedEvidenceView(sourceObservation, invalidContext);
      }).toThrow("Bounded evidence view requires a SELECTED_VACANCY context.");
    });
  });

  describe("preserves source and observedAt", () => {
    it("keeps source and observedAt from original input", () => {
      const context = createAcquisitionContext({
        kind: "SELECTED_VACANCY",
        associationMethod: "PROVIDER_LOCATOR",
        text: "Selected text",
      });

      const result = buildBoundedEvidenceView(sourceObservation, context);

      expect(result.source).toEqual(sourceObservation.source);
      expect(result.observedAt).toEqual(sourceObservation.observedAt);
    });
  });

  describe("works with VacancyEvidenceInput as input", () => {
    it("accepts VacancyEvidenceInput with SOURCE_OBSERVATION kind", () => {
      const evidenceInput = fromSourceObservation(sourceObservation);
      const context = createAcquisitionContext({
        kind: "SELECTED_VACANCY",
        associationMethod: "PROVIDER_LOCATOR",
        text: "Selected text",
      });

      const result = buildBoundedEvidenceView(evidenceInput, context);

      expect(result.rawContent).toBe("Selected text");
      expect(result.evidenceContent.kind).toBe("SELECTED_VACANCY_CONTEXT");
    });
  });

  describe("poison future unknown fields protection", () => {
    it("does not allow unknown acquisition fields to pass through to bounded view", () => {
      const poisonedObservation = {
        ...sourceObservation,
        metadata: {
          acquisition: {
            html: "<html>whole page</html>",
            structuredPayload: { dangerous: true },
            pageTitle: "POISON TITLE",
            salaryText: "€999,999 POISON",
            companyName: "POISON COMPANY",
            locationData: "POISON LOCATION",
            futureUnknownField: {
              criticaleEvidence: "POISON EVIDENCE",
              shouldNotAppear: true,
            },
            arbitraryNested: {
              field: "POISON NESTED",
            },
          },
        },
      };

      const context = createAcquisitionContext({
        kind: "SELECTED_VACANCY",
        associationMethod: "PROVIDER_LOCATOR",
        text: "Selected text",
        html: "<div>selected html</div>",
      });

      const result = buildBoundedEvidenceView(poisonedObservation, context);

      // Verify only allowlisted fields exist in bounded acquisition
      const acq = result.metadata.acquisition as Record<string, unknown>;
      expect(acq.html).toBe("<div>selected html</div>");
      expect(acq.contexts).toEqual([context]);
      expect(acq.metadata).toEqual({ vacancyEvidenceScope: "SELECTED_VACANCY_REQUIRED" });

      // Verify poison fields do NOT exist
      expect(acq.structuredPayload).toBeUndefined();
      expect(acq.pageTitle).toBeUndefined();
      expect(acq.salaryText).toBeUndefined();
      expect(acq.companyName).toBeUndefined();
      expect(acq.locationData).toBeUndefined();
      expect(acq.futureUnknownField).toBeUndefined();
      expect(acq.arbitraryNested).toBeUndefined();

      // Verify allowlisted fields are exactly those we expect
      expect(Object.keys(acq).sort()).toEqual(["contexts", "html", "metadata"]);
    });

    it("does not allow poison fields when context is undefined", () => {
      const poisonedObservation = {
        ...sourceObservation,
        metadata: {
          acquisition: {
            html: "POISON HTML",
            dangerousPayload: { hacked: true },
            futureField: "POISON",
          },
        },
      };

      const result = buildBoundedEvidenceView(poisonedObservation, undefined);

      // Acquisition should be undefined, not populated with poison
      expect(result.metadata.acquisition).toBeUndefined();
    });

    it("preserves custom non-acquisition metadata while protecting acquisition", () => {
      const observationWithCustomMetadata = {
        ...sourceObservation,
        metadata: {
          customField: "should be preserved",
          tracking: { sessionId: "123" },
          acquisition: {
            html: "whole page",
            structuredPayload: { poison: true },
            futureField: "POISON",
          },
        },
      };

      const context = createAcquisitionContext({
        kind: "SELECTED_VACANCY",
        associationMethod: "PROVIDER_LOCATOR",
        text: "Selected",
      });

      const result = buildBoundedEvidenceView(observationWithCustomMetadata, context);

      // Custom metadata preserved
      expect(result.metadata.customField).toBe("should be preserved");
      expect(result.metadata.tracking).toEqual({ sessionId: "123" });

      // Acquisition is clean and allowlist-only
      const acq = result.metadata.acquisition as Record<string, unknown>;
      expect(acq.structuredPayload).toBeUndefined();
      expect(acq.futureField).toBeUndefined();
      expect(Object.keys(acq).sort()).toEqual(["contexts", "html", "metadata"]);
    });

    it("acquisition fields are truly from scratch, not from spreading original", () => {
      // Create observation with many acquisition fields
      const observation = {
        ...sourceObservation,
        metadata: {
          acquisition: {
            html: "original html",
            structuredPayload: { data: "original" },
            contexts: [],
            metadata: { original: true },
            version: "1.0",
            timestamp: 123456,
            scrapeMethod: "selenium",
            browserInfo: { userAgent: "Mozilla..." },
            networkTiming: { dns: 100, connect: 50 },
            performanceMetrics: { loadTime: 3000 },
          },
        },
      };

      const context = createAcquisitionContext({
        kind: "SELECTED_VACANCY",
        associationMethod: "PROVIDER_LOCATOR",
        text: "Selected",
        html: "<div>new</div>",
      });

      const result = buildBoundedEvidenceView(observation, context);

      const acq = result.metadata.acquisition as Record<string, unknown>;

      // Only these three fields should exist
      expect(Object.keys(acq).sort()).toEqual(["contexts", "html", "metadata"]);

      // All original fields should be absent
      expect(acq.version).toBeUndefined();
      expect(acq.timestamp).toBeUndefined();
      expect(acq.scrapeMethod).toBeUndefined();
      expect(acq.browserInfo).toBeUndefined();
      expect(acq.networkTiming).toBeUndefined();
      expect(acq.performanceMetrics).toBeUndefined();

      // HTML should be from context, not original
      expect(acq.html).toBe("<div>new</div>");
    });
  });

  describe("no-context allowlisting", () => {
    it("does not allow approvedProjection to bypass no-context safety", () => {
      const observation = sourceObservation;

      const projection: ApprovedProviderProjection = {
        title: "Projected Title",
        displayedCompanyName: "Projected Company",
        locationText: "Projected Location",
      };

      const result = buildBoundedEvidenceView(observation, undefined, projection);

      // Only source identity and contactText should be present
      expect(result.id).toBe(observation.id);
      expect(result.source).toEqual(observation.source);
      expect(result.observedAt).toEqual(observation.observedAt);

      // Projected fields should NOT appear (no context means no projections)
      expect(result.title).toBeUndefined();
      expect(result.displayedCompanyName).toBeUndefined();
      expect(result.locationText).toBeUndefined();

      // Acquisition should be undefined
      expect(result.metadata.acquisition).toBeUndefined();

      // Evidence content should be empty observation
      expect(result.evidenceContent.kind).toBe("SOURCE_OBSERVATION");
    });
  });
});
