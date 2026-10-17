/**
 * The session secret that signs a storefront's session cookie (`SESSION_SECRET`).
 */

import { randomBytes } from 'node:crypto';

/**
 * Nitrogen's own minimum (`MIN_SESSION_SECRET_LENGTH` in `@cloudcart/nitrogen` 2.0): with a shorter secret the
 * storefront stops at its first request.
 */
export const MIN_SESSION_SECRET_LENGTH = 32;

/** A new secret for one project: 32 random bytes as 64 hex characters, as the platform makes each storefront's. */
export function newSessionSecret(): string {
  return randomBytes(32).toString('hex');
}

/**
 * The project's secret when Nitrogen accepts it, otherwise a new one. Projects made by `init` before 2.0 all
 * had the same short secret (B-461), which `env pull` must not keep.
 */
export function usableSessionSecret(current: string | undefined): { value: string; replaced: boolean } {
  if (current && current.length >= MIN_SESSION_SECRET_LENGTH) return { value: current, replaced: false };
  return { value: newSessionSecret(), replaced: Boolean(current) };
}
