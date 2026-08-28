export interface BrowserCapturePayload {
  readonly pageUrl: string;
  readonly pageTitle: string;
  readonly visibleText: string;
  readonly capturedAt: Date | string;
  readonly html?: string;
  readonly browserMetadata?: Readonly<Record<string, unknown>>;
}
