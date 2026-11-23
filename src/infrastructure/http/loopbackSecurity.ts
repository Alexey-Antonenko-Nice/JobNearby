import { randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Server-side authorization for Job Nearby's loopback HTTP interfaces (M25.2).
 *
 * Loopback binding alone is not an authorization boundary: local web content can
 * attempt cross-origin requests and DNS rebinding can forge Host/Origin. Every
 * request therefore has to match the expected Host, an allowed Origin (when one is
 * present), and a per-process session credential before it reaches an API handler.
 */

export const SESSION_TOKEN_BYTES = 32;
export const DESKTOP_SESSION_HEADER = "x-job-nearby-session";
export const EXTENSION_SESSION_HEADER = "x-job-nearby-extension";

export type LoopbackRole = "desktop" | "extension";

export interface CaptureRateLimitOptions {
  /** Maximum burst of authorized capture requests. */
  readonly capacity: number;
  /** Sustained refill rate, requests per second. */
  readonly refillPerSecond: number;
  readonly now: () => number;
}

export interface LoopbackSecurityOptions {
  readonly role: LoopbackRole;
  readonly desktopToken: string;
  readonly extensionToken: string;
  /** Development-only Vite origin(s). Never configured by the packaged desktop app. */
  readonly developmentUiOrigins?: readonly string[];
  readonly captureRateLimit?: Partial<Omit<CaptureRateLimitOptions, "now">> & { readonly now?: () => number };
}

/** 256 bits of per-process randomness, base64url encoded. */
export function generateSessionToken(): string {
  return randomBytes(SESSION_TOKEN_BYTES).toString("base64url");
}

export function expectedToken(role: LoopbackRole, security: LoopbackSecurityOptions): string {
  return role === "extension" ? security.extensionToken : security.desktopToken;
}

export function tokenHeaderName(role: LoopbackRole): string {
  return role === "extension" ? EXTENSION_SESSION_HEADER : DESKTOP_SESSION_HEADER;
}

/** Constant-time comparison that also hides length differences. */
export function sessionTokenMatches(expected: string, provided: string | string[] | undefined): boolean {
  if (typeof provided !== "string" || provided.length === 0) return false;
  const expectedBytes = Buffer.from(expected, "utf8");
  const providedBytes = Buffer.from(provided, "utf8");
  if (expectedBytes.length !== providedBytes.length) {
    // Compare something fixed-length so the failure path does not short-circuit by length.
    timingSafeEqual(expectedBytes, expectedBytes);
    return false;
  }
  return timingSafeEqual(expectedBytes, providedBytes);
}

/** Host must name exactly the loopback address and the port this listener bound. */
export function hostHeaderMatches(hostHeader: string | undefined, localPort: number | undefined): boolean {
  if (typeof hostHeader !== "string" || localPort === undefined) return false;
  return hostHeader === `127.0.0.1:${localPort}`;
}

/**
 * Origin policy. Absent Origin is accepted for non-browser clients and same-origin
 * GET requests; the session credential is still mandatory. Any present Origin must
 * match the expected same-origin/extension class (or an explicitly configured
 * development origin).
 */
export function originAllowed(
  origin: string | string[] | undefined,
  role: LoopbackRole,
  localPort: number | undefined,
  developmentUiOrigins: readonly string[] = [],
): boolean {
  if (origin === undefined) return true;
  if (typeof origin !== "string" || origin.length === 0) return false;
  if (origin === "null") return false;
  if (role === "extension") {
    return /^(?:chrome|moz)-extension:\/\//u.test(origin);
  }
  if (localPort === undefined) return false;
  if (origin === `http://127.0.0.1:${localPort}`) return true;
  return developmentUiOrigins.includes(origin);
}

export function isDevelopmentOrigin(origin: string | undefined, developmentUiOrigins: readonly string[]): boolean {
  return origin !== undefined && developmentUiOrigins.includes(origin);
}

export interface CaptureRateLimiter {
  /** Returns true when the request may proceed. */
  tryAcquire(): boolean;
}

/** Simple in-memory token bucket; resets with the process. */
export function createCaptureRateLimiter(options: Partial<CaptureRateLimitOptions> = {}): CaptureRateLimiter {
  const capacity = options.capacity ?? 30;
  const refillPerSecond = options.refillPerSecond ?? 0.5;
  const now = options.now ?? (() => Date.now());
  let tokens = capacity;
  let last = now();
  return {
    tryAcquire() {
      const current = now();
      const elapsedSeconds = Math.max(0, (current - last) / 1000);
      tokens = Math.min(capacity, tokens + elapsedSeconds * refillPerSecond);
      last = current;
      if (tokens < 1) return false;
      tokens -= 1;
      return true;
    },
  };
}
