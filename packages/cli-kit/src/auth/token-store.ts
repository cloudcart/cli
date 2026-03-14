import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { keychainSet, keychainGet, keychainRemove } from './keychain.js';

export interface StoreCredentials {
  token: string;
  type: 'pat' | 'jwt';
  email?: string;
  scopes?: string[];
  expiresAt?: string;
}

export interface CLIConfig {
  version: number;
  currentStore?: string;
  /** When true, tokens are stored in OS keychain instead of this file */
  useKeychain?: boolean;
  stores: Record<string, StoreCredentials>;
}

const CONFIG_DIR = join(homedir(), '.cloudcart');
const CONFIG_FILE = join(CONFIG_DIR, 'config.json');

export async function loadConfig(): Promise<CLIConfig> {
  try {
    const data = await readFile(CONFIG_FILE, 'utf-8');
    return JSON.parse(data) as CLIConfig;
  } catch {
    return { version: 1, stores: {} };
  }
}

export async function saveConfig(config: CLIConfig): Promise<void> {
  await mkdir(CONFIG_DIR, { recursive: true });
  await writeFile(CONFIG_FILE, JSON.stringify(config, null, 2), { mode: 0o600 });
}

export async function getStoreCredentials(storeUrl?: string): Promise<StoreCredentials | null> {
  const config = await loadConfig();
  const store = storeUrl ?? config.currentStore;
  if (!store) return null;

  // Try keychain first
  const keychainData = await keychainGet(`store:${store}`);
  if (keychainData) {
    try {
      return JSON.parse(keychainData) as StoreCredentials;
    } catch {
      // Corrupted keychain entry, fall through to file
    }
  }

  // Fall back to config file
  return config.stores[store] ?? null;
}

export async function saveStoreCredentials(
  storeUrl: string,
  credentials: StoreCredentials,
): Promise<void> {
  const config = await loadConfig();

  // Try to save to keychain
  const saved = await keychainSet(`store:${storeUrl}`, JSON.stringify(credentials));

  if (saved) {
    // Store metadata in config (without the token) so we know this store exists
    config.stores[storeUrl] = {
      ...credentials,
      token: '***keychain***',
    };
    config.useKeychain = true;
  } else {
    // Fallback: store everything in file
    config.stores[storeUrl] = credentials;
  }

  config.currentStore = storeUrl;
  await saveConfig(config);
}

export async function removeStoreCredentials(storeUrl: string): Promise<void> {
  // Remove from keychain
  await keychainRemove(`store:${storeUrl}`);

  const config = await loadConfig();
  delete config.stores[storeUrl];
  if (config.currentStore === storeUrl) {
    const remaining = Object.keys(config.stores);
    config.currentStore = remaining.length > 0 ? remaining[0] : undefined;
  }
  await saveConfig(config);
}

export async function getCurrentStore(): Promise<string | undefined> {
  const config = await loadConfig();
  return config.currentStore;
}
