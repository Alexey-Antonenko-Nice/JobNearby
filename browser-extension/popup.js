import { createBrowserCapturePayload } from "./capture-page.js";

export function captureFeedback(body) {
  if (body.processing.status === "FAILED") {
    return "Captured, but processing did not finish.";
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

function initializePopup(button, status) {
  button.addEventListener("click", async () => {
  button.disabled = true;
  status.textContent = "Capturing…";
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab.id === undefined) throw new Error("No active browser tab is available.");
    const [result] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: captureDocumentSnapshot,
    });
    const payload = createBrowserCapturePayload(result.result, new Date().toISOString());
    const response = await fetch("http://127.0.0.1:4317/acquisition/browser", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = await response.json();
    if (!response.ok || body.success !== true) {
      throw new Error(body.error ?? `Capture service returned ${response.status}.`);
    }
    status.textContent = captureFeedback(body);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    status.textContent = `Capture failed: ${message}`;
  } finally {
    button.disabled = false;
  }
  });
}

if (typeof document !== "undefined") {
  const button = document.querySelector("#capture");
  const status = document.querySelector("#status");
  if (button !== null && status !== null) {
    initializePopup(button, status);
  }
}
