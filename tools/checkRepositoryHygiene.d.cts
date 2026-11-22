export interface TrackedPathClassification {
  category: string;
  reason: string;
}

export interface RepositoryFinding {
  path: string;
  category: string;
  reason: string;
}

export declare function checkTrackedFiles(rootDir: string, files: string[]): RepositoryFinding[];
export declare function classifyTrackedPath(filePath: string): TrackedPathClassification | null;
export declare function findSecret(content: string): { line: number; category: string } | null;
export declare function normalizeTrackedPath(filePath: string): string;
