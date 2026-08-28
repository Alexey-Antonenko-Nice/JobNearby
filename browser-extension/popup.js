import { createBrowserCapturePayload } from "./capture-page.js";

const button = document.querySelector("#capture");
const status = document.querySelector("#status");

button.addEventListener("click", async () => {
  button.disabled = true;
  status.textContent = "Capturing…";
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab.id === undefined) throw new Error("No active browser tab is available.");
    const [result] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => ({
        pageUrl: window.location.href,
        pageTitle: document.title,
        visibleText: document.body?.innerText ?? "",
        html: document.documentElement?.outerHTML,
      }),
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
    status.textContent = `Captured: ${body.sourceObservationId}`;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    status.textContent = `Capture failed: ${message}`;
  } finally {
    button.disabled = false;
  }
});
