import { createBrowserCapturePayload } from "./capture-page.js";

export function captureFeedback(body) {
  if (body.processing.status === "FAILED") {
    return "Captured, but processing did not finish.";
  }
  if (body.processing.status === "VACANCY_NOT_DETECTED") {
    return "Vacancy not detected. This page was not added.";
  }
  const messages = [
    body.processing.vacancyOutcome === "CREATED"
      ? "Captured into a new vacancy record."
      : "Captured and added to an existing vacancy record.",
  ];
  const employerMessage = body.processing.employerStatus === "MATCHED_EXISTING_RECORD"
    ? "Linked to an existing employer record."
    : body.processing.employerStatus === "IDENTIFIED_NEW_RECORD"
      ? identifiedEmployerMessage(body.processing.employerDisplayName)
      : body.processing.employerStatus === "REVIEW_REQUIRED"
        ? "Employer match needs review."
        : body.processing.employerStatus === "NO_EMPLOYER_EVIDENCE"
          ? "Employer evidence was not present in this capture."
        : "Employer not identified yet.";
  messages.push(employerMessage);
  if (body.processing.canonicalizationStatus === "CONFLICTED") {
    messages.push("Some captured vacancy details conflict.");
  }
  return messages.join(" ");
}

function identifiedEmployerMessage(value) {
  const name = typeof value === "string" ? value.trim() : "";
  if (name.length === 0 || /^unknown\s+employer(?:\s*[—-].*)?$/iu.test(name)) {
    return "Employer not identified yet.";
  }
  return `Employer identified: ${name}.`;
}

// Injected into the page, so it must stay self-contained. Open shadow roots are
// not part of outerHTML; copy them under their host in a marked wrapper.
export function captureDocumentSnapshot() {
  const doc = document;
  const inlineShadowRoots = (original, copy) => {
    const originals = original.querySelectorAll("*");
    const copies = copy.querySelectorAll("*");
    for (let index = 0; index < originals.length; index += 1) {
      const shadow = originals[index].shadowRoot;
      if (!shadow || !copies[index]) continue;
      const wrapper = doc.createElement("div");
      wrapper.setAttribute("data-jn-shadow-root", "open");
      for (const child of Array.from(shadow.childNodes)) wrapper.appendChild(child.cloneNode(true));
      inlineShadowRoots(shadow, wrapper);
      copies[index].appendChild(wrapper);
    }
  };
  let html;
  try {
    const clone = doc.documentElement.cloneNode(true);
    inlineShadowRoots(doc.documentElement, clone);
    html = clone.outerHTML;
  } catch {
    html = doc.documentElement?.outerHTML;
  }
  return {
    pageUrl: window.location.href,
    pageTitle: doc.title,
    visibleText: doc.body?.innerText ?? "",
    html,
  };
}

const STORAGE_KEY = "job-nearby-extension-session";
const CAPTURE_ENDPOINT = "http://127.0.0.1:4317/acquisition/browser";

// Prefer per-browser-session storage; fall back only when the browser lacks it.
function pairingStorage() {
  return chrome.storage?.session ?? chrome.storage?.local ?? null;
}

export async function readPairingCode() {
  const storage = pairingStorage();
  if (storage === null) return "";
  const values = await storage.get(STORAGE_KEY);
  const value = values?.[STORAGE_KEY];
  return typeof value === "string" ? value : "";
}

export async function savePairingCode(code) {
  const storage = pairingStorage();
  if (storage === null) throw new Error("Browser storage is unavailable.");
  await storage.set({ [STORAGE_KEY]: code });
}

export async function clearPairingCode() {
  const storage = pairingStorage();
  if (storage !== null) await storage.remove(STORAGE_KEY);
}

function initializePopup(button, status, pairingInput, pairButton) {
  let pairingCode = "";

  const setConnected = (connected) => {
    button.disabled = !connected;
    status.textContent = connected
      ? "Connected to Job Nearby. Capture this page when ready."
      : "Pair the extension with Job Nearby first.";
  };

  const refresh = async () => {
    try {
      pairingCode = await readPairingCode();
      setConnected(pairingCode.length > 0);
    } catch {
      setConnected(false);
    }
  };

  pairButton.addEventListener("click", async () => {
    const code = pairingInput.value.trim();
    if (code.length < 32) {
      status.textContent = "Paste the full pairing code shown by Job Nearby.";
      return;
    }
    try {
      await savePairingCode(code);
      pairingInput.value = "";
      pairingCode = code;
      setConnected(true);
    } catch (error) {
      status.textContent = `Could not save pairing code: ${error instanceof Error ? error.message : String(error)}`;
    }
  });

  button.addEventListener("click", async () => {
    button.disabled = true;
    status.textContent = "Capturing…";
    try {
      if (pairingCode.length === 0) {
        setConnected(false);
        return;
      }
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab.id === undefined) throw new Error("No active browser tab is available.");
      const [result] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: captureDocumentSnapshot,
      });
      const payload = createBrowserCapturePayload(result.result, new Date().toISOString());
      const response = await fetch(CAPTURE_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Job-Nearby-Extension": pairingCode,
        },
        body: JSON.stringify(payload),
      });
      if (response.status === 401 || response.status === 403) {
        await clearPairingCode();
        pairingCode = "";
        setConnected(false);
        status.textContent = "Job Nearby is not connected. Open Job Nearby and paste a new pairing code.";
        return;
      }
      const body = await response.json();
      if (!response.ok || body.success !== true) {
        throw new Error(body.error ?? `Capture service returned ${response.status}.`);
      }
      status.textContent = captureFeedback(body);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      status.textContent = `Capture failed: ${message}`;
    } finally {
      button.disabled = pairingCode.length === 0;
    }
  });

  void refresh();
}

if (typeof document !== "undefined") {
  const button = document.querySelector("#capture");
  const status = document.querySelector("#status");
  const pairingInput = document.querySelector("#pairing-code");
  const pairButton = document.querySelector("#pair");
  if (button !== null && status !== null && pairingInput !== null && pairButton !== null) {
    initializePopup(button, status, pairingInput, pairButton);
  }
}
