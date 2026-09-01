import { describe, expect, it } from "vitest";

import { diagnoseLinkedInDirectViewDom } from "../../src/infrastructure/database/LinkedInDirectViewDomDiagnostic.js";

describe("diagnoseLinkedInDirectViewDom", () => {
  it("reports exact-ID markers and bounded semantic ancestry without dumping the page", () => {
    const id = "4449077982";
    const diagnostic = diagnoseLinkedInDirectViewDom(`
      <div data-sdui-screen="com.linkedin.sdui.flagshipnav.jobs.JobDetails">
        <div data-testid="lazy-column" data-component-type="LazyColumn">
          <div class="${"header-detail ".repeat(30)}">
            <a href="/jobs/view/ingenieur-at-akkodis-${id}/">Selected vacancy</a>
          </div>
          <div>
            <div id="JobDetails_AboutTheJob_${id}"
                 componentkey="JobDetails_AboutTheJob_${id}"
                 data-view-name="job-details-about-the-job">
              <h2>À propos de l'offre d'emploi</h2>
              <p>${"Bounded description. ".repeat(30)}</p>
            </div>
          </div>
        </div>
      </div>
      <div>Unrelated whole-page content ${"must not be reported ".repeat(100)}</div>
    `, id);

    expect(diagnostic.markers).toEqual({
      primaryJobDetailsCount: 2,
      jobCardComponentReferenceCount: 0,
    });
    expect(diagnostic.exactIdAttributeElements).toEqual(expect.arrayContaining([
      expect.objectContaining({
        tag: "a",
        attributes: expect.objectContaining({ href: `/jobs/view/ingenieur-at-akkodis-${id}/` }),
      }),
      expect.objectContaining({
        tag: "div",
        attributes: expect.objectContaining({
          id: `JobDetails_AboutTheJob_${id}`,
          componentkey: `JobDetails_AboutTheJob_${id}`,
        }),
      }),
    ]));
    expect(diagnostic.semanticContainers.map(({ kind }) => kind)).toEqual([
      "JOB_DETAILS_SCREEN",
      "LAZY_COLUMN",
      "ABOUT_THE_JOB",
    ]);
    expect(diagnostic.semanticContainers.every(({ textPreview }) => textPreview.length <= 240)).toBe(true);
    expect(JSON.stringify(diagnostic)).not.toContain("must not be reported");
  });
});
