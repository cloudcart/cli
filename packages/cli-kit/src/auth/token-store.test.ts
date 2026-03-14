import { describe, it, expect, vi, beforeEach } from 'vitest';
import { loadConfig, saveConfig, saveStoreCredentials, getStoreCredentials, removeStoreCredentials, getCurrentStore } from './token-store.js';

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  mkdir: vi.fn(),
}));

vi.mock('./keychain.js', () => ({
  keychainSet: vi.fn().mockResolvedValue(false),
  keychainGet: vi.fn().mockResolvedValue(null),
  keychainRemove: vi.fn().mockResolvedValue(false),
}));

import { readFile, writeFile, mkdir } from 'node:fs/promises';

describe('token-store', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('loadConfig', () => {
    it('returns default config when file does not exist', async () => {
      vi.mocked(readFile).mockRejectedValue(new Error('ENOENT'));
      const config = await loadConfig();
      expect(config).toEqual({ version: 1, stores: {} });
    });

    it('parses existing config file', async () => {
      const stored = { version: 1, currentStore: 'shop.cloudcart.com', stores: { 'shop.cloudcart.com': { token: 'cc_pat_abc', type: 'pat' } } };
      vi.mocked(readFile).mockResolvedValue(JSON.stringify(stored));
      const config = await loadConfig();
      expect(config.currentStore).toBe('shop.cloudcart.com');
      expect(config.stores['shop.cloudcart.com'].token).toBe('cc_pat_abc');
    });
  });

  describe('saveConfig', () => {
    it('creates directory and writes config with restricted permissions', async () => {
      vi.mocked(mkdir).mockResolvedValue(undefined);
      vi.mocked(writeFile).mockResolvedValue();

      await saveConfig({ version: 1, stores: {} });

      expect(mkdir).toHaveBeenCalled();
      expect(writeFile).toHaveBeenCalledWith(
        expect.stringContaining('config.json'),
        expect.any(String),
        { mode: 0o600 },
      );
    });
  });

  describe('saveStoreCredentials', () => {
    it('saves credentials and sets current store', async () => {
      vi.mocked(readFile).mockRejectedValue(new Error('ENOENT'));
      vi.mocked(mkdir).mockResolvedValue(undefined);
      vi.mocked(writeFile).mockResolvedValue();

      await saveStoreCredentials('shop.cloudcart.com', {
        token: 'cc_pat_test',
        type: 'pat',
      });

      const written = JSON.parse(vi.mocked(writeFile).mock.calls[0][1] as string);
      expect(written.currentStore).toBe('shop.cloudcart.com');
      expect(written.stores['shop.cloudcart.com'].token).toBe('cc_pat_test');
    });
  });

  describe('getStoreCredentials', () => {
    it('returns null when no store configured', async () => {
      vi.mocked(readFile).mockRejectedValue(new Error('ENOENT'));
      const result = await getStoreCredentials();
      expect(result).toBeNull();
    });

    it('returns credentials for current store', async () => {
      const stored = { version: 1, currentStore: 'shop.cloudcart.com', stores: { 'shop.cloudcart.com': { token: 'cc_pat_abc', type: 'pat' } } };
      vi.mocked(readFile).mockResolvedValue(JSON.stringify(stored));

      const result = await getStoreCredentials();
      expect(result).toEqual({ token: 'cc_pat_abc', type: 'pat' });
    });

    it('returns credentials for specific store', async () => {
      const stored = { version: 1, currentStore: 'other.cloudcart.com', stores: { 'shop.cloudcart.com': { token: 'cc_pat_abc', type: 'pat' }, 'other.cloudcart.com': { token: 'cc_pat_xyz', type: 'pat' } } };
      vi.mocked(readFile).mockResolvedValue(JSON.stringify(stored));

      const result = await getStoreCredentials('shop.cloudcart.com');
      expect(result).toEqual({ token: 'cc_pat_abc', type: 'pat' });
    });
  });

  describe('removeStoreCredentials', () => {
    it('removes store and switches current store', async () => {
      const stored = { version: 1, currentStore: 'shop.cloudcart.com', stores: { 'shop.cloudcart.com': { token: 'cc_pat_abc', type: 'pat' }, 'other.cloudcart.com': { token: 'cc_pat_xyz', type: 'pat' } } };
      vi.mocked(readFile).mockResolvedValue(JSON.stringify(stored));
      vi.mocked(mkdir).mockResolvedValue(undefined);
      vi.mocked(writeFile).mockResolvedValue();

      await removeStoreCredentials('shop.cloudcart.com');

      const written = JSON.parse(vi.mocked(writeFile).mock.calls[0][1] as string);
      expect(written.stores['shop.cloudcart.com']).toBeUndefined();
      expect(written.currentStore).toBe('other.cloudcart.com');
    });

    it('clears current store when last store removed', async () => {
      const stored = { version: 1, currentStore: 'shop.cloudcart.com', stores: { 'shop.cloudcart.com': { token: 'cc_pat_abc', type: 'pat' } } };
      vi.mocked(readFile).mockResolvedValue(JSON.stringify(stored));
      vi.mocked(mkdir).mockResolvedValue(undefined);
      vi.mocked(writeFile).mockResolvedValue();

      await removeStoreCredentials('shop.cloudcart.com');

      const written = JSON.parse(vi.mocked(writeFile).mock.calls[0][1] as string);
      expect(written.stores).toEqual({});
      expect(written.currentStore).toBeUndefined();
    });
  });

  describe('getCurrentStore', () => {
    it('returns undefined when no config', async () => {
      vi.mocked(readFile).mockRejectedValue(new Error('ENOENT'));
      expect(await getCurrentStore()).toBeUndefined();
    });

    it('returns current store from config', async () => {
      const stored = { version: 1, currentStore: 'shop.cloudcart.com', stores: {} };
      vi.mocked(readFile).mockResolvedValue(JSON.stringify(stored));
      expect(await getCurrentStore()).toBe('shop.cloudcart.com');
    });
  });
});
