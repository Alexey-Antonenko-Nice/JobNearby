export type FixtureFindingSeverity = "error" | "warning";

export interface FixtureFinding {
  path: string;
  rule: string;
  severity: FixtureFindingSeverity;
  message: string;
}

export interface FixtureScanResult {
  directory: string;
  files: number;
  errors: number;
  warnings: number;
  findings: FixtureFinding[];
}

export declare const FIXTURE_ALLOWLIST: ReadonlyMap<string, { rule: string; reason: string }>;
export declare const NORMAL_FIXTURE_BYTES: number;
export declare const EXCEPTIONAL_FIXTURE_BYTES: number;
export declare function formatReport(result: FixtureScanResult): string;
export declare function listFixtureFiles(rootDir: string): string[];
export declare function scanFixture(file: string, bytes: number, content: string): FixtureFinding[];
export declare function scanFixtures(options?: { rootDir?: string }): FixtureScanResult;
