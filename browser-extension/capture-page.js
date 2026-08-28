export function createBrowserCapturePayload(snapshot, capturedAt) {
  return {
    pageUrl: snapshot.pageUrl,
    pageTitle: snapshot.pageTitle,
    visibleText: snapshot.visibleText.replace(/\r\n?/g, "\n").trim(),
    capturedAt,
    ...(snapshot.html === undefined ? {} : { html: snapshot.html }),
    browserMetadata: { captureClient: "job-nearby-browser-extension", version: "0.1.0" },
  };
}
