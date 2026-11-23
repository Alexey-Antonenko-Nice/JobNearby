import { describe, expect, it } from "vitest";

import {
  EXCEPTIONAL_FIXTURE_BYTES,
  FIXTURE_ALLOWLIST,
  formatReport,
  scanFixture,
  scanFixtures,
} from "../../tools/checkFixtures.cjs";

const rules = (file: string, bytes: number, content: string) => scanFixture(file, bytes, content).map((f) => f.rule);

describe("fixture size policy", () => {
  it("rejects an oversized fixture", () => {
    const findings = scanFixture("huge.html", EXCEPTIONAL_FIXTURE_BYTES + 1, "<div>ok</div>");
    expect(findings).toContainEqual(expect.objectContaining({ rule: "oversize", severity: "error" }));
  });

  it("accepts a normal minimal fixture", () => {
    expect(scanFixture("minimal.html", 1000, "<div>job title</div>")).toEqual([]);
  });

  it("only allowlists oversize fixtures and requires a reason", () => {
    expect(FIXTURE_ALLOWLIST.size).toBeLessThan(8);
    for (const [file, entry] of FIXTURE_ALLOWLIST) {
      expect(entry.rule, file).toBe("oversize");
      expect(entry.reason.length, file).toBeGreaterThan(20);
    }
  });

  it("does not let an allowlisted fixture hide other violations", () => {
    expect(rules("linkedinSearchResultsWestinghouse.html", 150 * 1024, "https://x.test/?utm_source=alert")).toContain(
      "tracking-parameter",
    );
  });
});

describe("contact data", () => {
  it("accepts reserved .test addresses", () => {
    expect(rules("a.html", 100, '<a href="mailto:recruiter@example.test">recruiter@example.test</a>')).not.toContain(
      "real-email",
    );
  });

  it("flags a real-looking contact email", () => {
    expect(rules("a.html", 100, "mailto:recruiter@acme-recruiting.invalid")).toContain("real-email");
  });

  it("flags a phone-style number but not salaries, decimals or SIRETs", () => {
    expect(rules("a.html", 100, "Appelez l'agence 03 88 05 05 75")).toContain("real-phone");
    expect(rules("a.html", 100, "De 22 000 â‚¬ Ã  27 000 â‚¬ par an ; 0.515625 80300353200014")).not.toContain("real-phone");
    expect(rules("a.html", 100, "tel:01 00 00 00 00")).not.toContain("real-phone");
  });

  it("never echoes the matched contact value in output", () => {
    const result = {
      directory: "tests/fixtures",
      files: 1,
      errors: 1,
      warnings: 0,
      findings: scanFixture("a.html", 100, "mailto:recruiter@acme-recruiting.invalid"),
    };
    const output = formatReport(result);
    expect(output).toContain("real-email");
    expect(output).not.toContain("acme-recruiting");
  });
});

describe("URLs and session material", () => {
  it("flags tracking parameters", () => {
    expect(rules("a.html", 100, 'href="https://fr.indeed.com/viewjob?jk=123&utm_source=alert&tk=secret"')).toContain(
      "tracking-parameter",
    );
  });

  it("accepts identity-critical query parameters", () => {
    expect(
      rules("a.html", 100, 'href="https://fr.indeed.com/viewjob?jk=469914f6362f9354" href="https://www.linkedin.com/jobs/view/4483547375/"'),
    ).toEqual([]);
  });

  it("flags cookie and authorization material", () => {
    expect(rules("a.html", 100, "Authorization: Bearer abcdefghijklmnopqrstuvwxyz")).toContain("session-material");
    expect(rules("a.html", 100, "Set-Cookie: session=abc; document.cookie")).toContain("session-material");
  });

  it("flags secrets without printing them", () => {
    const key = ["-----BEGIN", "RSA PRIVATE KEY-----"].join(" ");
    const findings = scanFixture("a.html", 100, key);
    expect(findings).toContainEqual(expect.objectContaining({ rule: "secret-material" }));
    expect(JSON.stringify(findings)).not.toContain("PRIVATE KEY-----");
  });
});

describe("tracked artifacts", () => {
  it("flags a diagnostic dump filename", () => {
    expect(rules("linkedin-diagnostic.txt", 100, "{}")).toContain("diagnostic-dump");
  });

  it("flags a tracked database file", () => {
    expect(rules("capture.sqlite", 100, "")).toContain("tracked-database");
  });

  it("allows an intentionally synthetic tiny document", () => {
    expect(rules("synthetic-cv.pdf", 500, "%PDF synthetic")).toEqual([]);
    expect(rules("real-cv.pdf", 500, "%PDF")).toContain("document-fixture");
  });
});

describe("determinism and current corpus", () => {
  it("produces deterministic results", () => {
    const first = JSON.stringify(scanFixtures({ rootDir: process.cwd() }));
    const second = JSON.stringify(scanFixtures({ rootDir: process.cwd() }));
    expect(second).toBe(first);
  });

  it("keeps the committed fixture corpus free of public-release blockers", () => {
    const result = scanFixtures({ rootDir: process.cwd() });
    expect(result.files).toBeGreaterThan(0);
    expect(result.errors).toBe(0);
  });
});
