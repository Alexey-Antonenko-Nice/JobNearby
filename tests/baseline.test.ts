import { describe, expect, it } from "vitest";

import { projectName } from "../src/index.js";

describe("Job Nearby baseline", () => {
  it("loads the project module", () => {
    expect(projectName).toBe("Job Nearby");
  });
});