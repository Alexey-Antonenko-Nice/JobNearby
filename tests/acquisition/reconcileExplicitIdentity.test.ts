import { describe, expect, it } from "vitest";
import { reconcileExplicitIdentity } from "../../src/application/acquisition/reconcileExplicitIdentity.js";

describe("reconcileExplicitIdentity", () => {
  it("allows no associated identities when proof is optional", () => {
    expect(reconcileExplicitIdentity("8312", [])).toEqual({ status: "MATCH" });
  });
  it("requires explicit proof only when requested", () => {
    expect(reconcileExplicitIdentity("8312", [], { requireExplicitMatch: true })).toEqual({ status: "MISSING_REQUIRED_PROOF" });
    expect(reconcileExplicitIdentity("8312", ["8312"], { requireExplicitMatch: true })).toEqual({ status: "MATCH" });
  });
  it.each([
    ["8312", ["8312"]],
    ["8312", ["8312", "8312"]],
    ["jn-102026-7118382", ["jn-102026-7118382", "jn-102026-7118382", "jn-102026-7118382"]],
    ["JR100451", ["JR100451"]],
    ["01234567-89ab-cdef-0123-456789abcdef:part", ["01234567-89ab-cdef-0123-456789abcdef:part"]],
  ])("matches opaque already-normalized ID %s", (primary, associated) => {
    const before = [...associated];
    expect(reconcileExplicitIdentity(primary, associated)).toEqual({ status: "MATCH" });
    expect(associated).toEqual(before);
  });
  it.each([
    ["8312", ["8313"]],
    ["8312", ["8312", "8313"]],
    ["jn-102026-7118382", ["jn-102026-7118383"]],
    ["JR100451", ["jr100451"]],
    ["8312", [" 8312"]],
  ])("reports conflict without normalizing %s", (primary, associated) => {
    expect(reconcileExplicitIdentity(primary, associated)).toEqual({ status: "CONFLICT" });
  });
  it.each([
    ["", []],
    ["  ", ["8312"]],
    ["8312", [""]],
    ["8312", ["8312", " \t"]],
  ])("reports empty or whitespace-only IDs as invalid", (primary, associated) => {
    expect(reconcileExplicitIdentity(primary, associated, { requireExplicitMatch: true })).toEqual({ status: "INVALID_ID" });
  });
  it("compares malformed nonempty IDs literally rather than coercing them", () => {
    expect(reconcileExplicitIdentity("8312", ["8312x"])).toEqual({ status: "CONFLICT" });
    expect(reconcileExplicitIdentity("8312", ["8312x"].filter(id => /^[1-9]\d*$/u.test(id)), { requireExplicitMatch: true }))
      .toEqual({ status: "MISSING_REQUIRED_PROOF" });
  });
});
