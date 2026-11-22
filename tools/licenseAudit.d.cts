export type LicenseKind = "accepted" | "review" | "unknown";
export type LicenseSeverity = "none" | "warning" | "blocker";

export interface LicenseClassification {
  expression: string;
  licenseIds: string[];
  kind: LicenseKind;
  parsed: boolean;
  reason: string;
}

export interface ResolvedLicense {
  license: string;
  source: string;
}

export interface AuditedPackage {
  name: string;
  version: string;
  license: string;
  licenseExpression: string;
  licenseSource: string;
  direct: boolean;
  production: boolean;
  distributed: boolean;
  distributedVia: string | null;
  status: "OK" | "REVIEW" | "UNKNOWN";
  severity: LicenseSeverity;
  reviewNote: string | null;
}

export interface AuditedComponent {
  name: string;
  version: string;
  license: string;
  distributed: boolean;
  distributionPoint: string;
  noticeLocation: string;
  source: string;
}

export interface LicenseInventory {
  schemaVersion: number;
  project: { name: string; version: string; license: string };
  source: { packageLock: string; lockfileVersion: number | null };
  policy: {
    accepted: string[];
    reviewRequired: string[];
    unknownRule: string;
    bundledDevDependencies: string[];
  };
  summary: {
    packages: number;
    direct: number;
    production: number;
    distributed: number;
    ok: number;
    warnings: number;
    blockers: number;
  };
  packages: AuditedPackage[];
  components: AuditedComponent[];
}

export declare const ACCEPTED_LICENSES: ReadonlyMap<string, string>;
export declare const REVIEW_LICENSES: ReadonlyMap<string, string>;
export declare const BUNDLED_DEV_DEPENDENCIES: ReadonlyMap<string, string>;

export declare function buildInventory(options: {
  rootDir: string;
  lock?: unknown;
  rootPackage?: unknown;
}): LicenseInventory;
export declare function classifyLicenseExpression(expression: string): LicenseClassification;
export declare function classifyLicenseId(identifier: string): {
  kind: LicenseKind;
  reason: string;
  licenseIds: string[];
};
export declare function detectLicenseFromText(text: string): string;
export declare function formatInventoryJson(inventory: LicenseInventory): string;
export declare function normalizeLicenseId(identifier: string): string;
export declare function parseLicenseExpression(expression: string): unknown | null;
export declare function resolveLicense(packageDir: string, declaredLicense: string | undefined): ResolvedLicense;
export declare function severityFor(kind: LicenseKind, distributed: boolean): LicenseSeverity;
export declare function summarize(inventory: LicenseInventory): string;
