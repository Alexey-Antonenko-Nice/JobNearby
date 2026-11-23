import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { clearPairingCode, readPairingCode, savePairingCode } from "../../browser-extension/popup.js";

const sessionStore = new Map();
const localStore = new Map();

function storageArea(store) {
  return {
    get: vi.fn(async (key) => (store.has(key) ? { [key]: store.get(key) } : {})),
    set: vi.fn(async (values) => { for (const [key, value] of Object.entries(values)) store.set(key, value); }),
    remove: vi.fn(async (key) => { store.delete(key); }),
  };
}

beforeEach(() => {
  sessionStore.clear();
  localStore.clear();
  globalThis.chrome = { storage: { session: storageArea(sessionStore), local: storageArea(localStore) } };
});

afterEach(() => {
  delete globalThis.chrome;
});

describe("extension pairing storage", () => {
  it("stores the pairing credential in session storage rather than local storage", async () => {
    await savePairingCode("pairing-code-for-the-desktop-session");
    expect(await readPairingCode()).toBe("pairing-code-for-the-desktop-session");
    expect(sessionStore.size).toBe(1);
    expect(localStore.size).toBe(0);
  });

  it("clears a stale credential", async () => {
    await savePairingCode("stale-code");
    await clearPairingCode();
    expect(await readPairingCode()).toBe("");
  });

  it("falls back to local storage only when session storage is unavailable", async () => {
    globalThis.chrome = { storage: { local: storageArea(localStore) } };
    await savePairingCode("fallback-code");
    expect(await readPairingCode()).toBe("fallback-code");
    expect(localStore.size).toBe(1);
  });

  it("returns an empty code when no storage area exists", async () => {
    globalThis.chrome = {};
    expect(await readPairingCode()).toBe("");
    await expect(savePairingCode("code")).rejects.toThrow(/storage is unavailable/u);
  });
});
