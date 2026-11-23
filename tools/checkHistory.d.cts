export type HistoryFindingSeverity = "error";

export interface HistoryFinding {
  path: string;
  rule: string;
  severity: HistoryFindingSeverity;
  message: string;
}

export interface HistoryScanResult {
  ref: string;
  commit?: string;
  error?: string;
  commits: number;
  blobVersions: number;
  maxBlobBytes?: number;
  findings: HistoryFinding[];
  pass: boolean;
}

export declare const DEFAULT_ALLOWLIST: ReadonlyMap<string, string>;
export declare const DEFAULT_MAX_BLOB_BYTES: number;
export declare const FORBIDDEN_PATHS: ReadonlyArray<{ rule: string; pattern: RegExp }>;
export declare function forbiddenRuleFor(filePath: string): string | undefined;
export declare function formatReport(result: HistoryScanResult): string;
export declare function scanHistory(options?: {
  rootDir?: string;
  ref?: string;
  maxBlobBytes?: number;
  allowlist?: ReadonlyMap<string, string>;
  shaAllowlist?: ReadonlySet<string>;
}): HistoryScanResult;
