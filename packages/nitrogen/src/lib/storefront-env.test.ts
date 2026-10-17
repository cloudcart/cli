import { describe, expect, it } from 'vitest';
import { planPush, variablesFor, type StorefrontVariable } from './storefront-env.js';

const variable = (key: string, environment: string, value: string, flags: Partial<StorefrontVariable> = {}): StorefrontVariable => ({
  key,
  value,
  environment,
  isSecret: false,
  isSystem: false,
  ...flags,
});

const remote: StorefrontVariable[] = [
  variable('PUBLIC_STORE_DOMAIN', 'all', 'shop.example.com', { isSystem: true }),
  variable('PUBLIC_STOREFRONT_API_TOKEN', 'all', 'public', { isSystem: true }),
  variable('SHOP_ID', 'all', '7', { isSystem: true }),
  variable('API_URL', 'all', 'https://all.example.invalid'),
  variable('API_URL', 'production', 'https://production.example.invalid'),
  variable('FEATURE', 'all', 'on'),
  variable('PAYMENT_KEY', 'production', '********', { isSecret: true }),
  variable('PREVIEW_ONLY', 'preview', 'x'),
  variable('OLD', 'production', 'kept'),
];

describe('variablesFor', () => {
  it("gives an environment its own variables and those for all; all gives every one", () => {
    expect(variablesFor(remote, 'preview').map((v) => `${v.key}@${v.environment}`)).toEqual([
      'PUBLIC_STORE_DOMAIN@all',
      'PUBLIC_STOREFRONT_API_TOKEN@all',
      'SHOP_ID@all',
      'API_URL@all',
      'FEATURE@all',
      'PREVIEW_ONLY@preview',
    ]);
    expect(variablesFor(remote, 'all')).toHaveLength(remote.length);
  });
});

describe('planPush', () => {
  const local = {
    PUBLIC_STORE_DOMAIN: 'localhost:3000',
    PRIVATE_STOREFRONT_API_TOKEN: 'private',
    SESSION_SECRET: 'local-secret',
    SHOP_ID: '7',
    API_URL: 'https://production.example.invalid',
    FEATURE: 'off',
    PAYMENT_KEY: 'new-key',
    new_key: 'value',
    PUBLIC_ANALYTICS_ID: 'G-1',
    BLANK: '',
  };

  it('sends what the environment does not bind yet, and nothing it binds already', () => {
    const plan = planPush(local, remote, 'production');

    expect(plan.added).toEqual(['NEW_KEY', 'PUBLIC_ANALYTICS_ID']);
    // FEATURE is bound from `all` with another value: production gets its own.
    expect(plan.changed).toEqual(['FEATURE']);
    expect(plan.secrets).toEqual(['PAYMENT_KEY']);
    // API_URL: production's own value is the file's.
    expect(plan.unchanged).toBe(1);
    expect(plan.send).toEqual([
      { key: 'FEATURE', value: 'off', isSecret: false },
      { key: 'PAYMENT_KEY', value: 'new-key', isSecret: true },
      { key: 'NEW_KEY', value: 'value', isSecret: true },
      { key: 'PUBLIC_ANALYTICS_ID', value: 'G-1', isSecret: false },
    ]);
  });

  it("never sends the platform's variables, the session secret or an empty value, and says why", () => {
    const plan = planPush(local, remote, 'production');

    expect(plan.skipped).toEqual([
      { key: 'PUBLIC_STORE_DOMAIN', why: 'set by CloudCart' },
      { key: 'PRIVATE_STOREFRONT_API_TOKEN', why: 'set by CloudCart' },
      { key: 'SESSION_SECRET', why: "this machine's; the deployed storefront has its own" },
      { key: 'SHOP_ID', why: 'set by CloudCart' },
      { key: 'BLANK', why: 'empty' },
    ]);
    expect(plan.send.map((input) => input.key)).not.toContain('SESSION_SECRET');
  });

  it('lists the custom keys the file lacks, without deleting them', () => {
    expect(planPush(local, remote, 'production').remoteOnly).toEqual(['OLD']);
    expect(planPush({ FEATURE: 'on' }, remote, 'preview').remoteOnly).toEqual(['API_URL', 'PREVIEW_ONLY']);
  });

  it('compares all with the variables for all only', () => {
    const plan = planPush({ API_URL: 'https://all.example.invalid', OLD: 'kept' }, remote, 'all');

    expect(plan.unchanged).toBe(1);
    expect(plan.added).toEqual(['OLD']);
  });
});
