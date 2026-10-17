import { describe, expect, it } from 'vitest';
import { MIN_SESSION_SECRET_LENGTH, newSessionSecret, usableSessionSecret } from './session-secret.js';

describe('newSessionSecret', () => {
  it('is 64 hex characters, different every time', () => {
    const secrets = new Set(Array.from({ length: 20 }, newSessionSecret));
    expect(secrets.size).toBe(20);
    for (const secret of secrets) expect(secret).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('usableSessionSecret', () => {
  it('keeps a secret Nitrogen accepts', () => {
    const current = 'k'.repeat(MIN_SESSION_SECRET_LENGTH);
    expect(usableSessionSecret(current)).toEqual({ value: current, replaced: false });
  });

  it('replaces a shorter one, as the old init wrote (29 characters)', () => {
    const result = usableSessionSecret('k'.repeat(29));
    expect(result.replaced).toBe(true);
    expect(result.value).toMatch(/^[0-9a-f]{64}$/);
  });

  it('makes one when there is none, without calling it a replacement', () => {
    const result = usableSessionSecret(undefined);
    expect(result.replaced).toBe(false);
    expect(result.value).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is Nitrogen\'s minimum', () => {
    expect(MIN_SESSION_SECRET_LENGTH).toBe(32);
  });
});
