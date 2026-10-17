import { execFile } from 'node:child_process';
import { platform } from 'node:os';

const SERVICE = 'cloudcart-cli';

interface KeychainResult {
  success: boolean;
  value?: string;
}

function exec(cmd: string, args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: 5000 }, (error, stdout, stderr) => {
      resolve({
        stdout: stdout?.toString() ?? '',
        stderr: stderr?.toString() ?? '',
        exitCode: error ? (error as { status?: number }).status ?? 1 : 0,
      });
    });
  });
}

/**
 * Check if a command exists on PATH by attempting to run it.
 * Caches result per command name for the process lifetime.
 */
const commandExistsCache = new Map<string, boolean>();

async function commandExists(cmd: string): Promise<boolean> {
  const cached = commandExistsCache.get(cmd);
  if (cached !== undefined) return cached;

  const checkCmd = platform() === 'win32' ? 'where' : 'which';
  const result = await exec(checkCmd, [cmd]);
  const exists = result.exitCode === 0;
  commandExistsCache.set(cmd, exists);
  return exists;
}

// macOS Keychain via `security` CLI (ships with macOS)
const macOS = {
  async isAvailable(): Promise<boolean> {
    return commandExists('security');
  },

  async set(account: string, value: string): Promise<boolean> {
    // -U flag handles both create and update, no need to delete first
    const result = await exec('security', [
      'add-generic-password',
      '-s', SERVICE,
      '-a', account,
      '-w', value,
      '-U',
    ]);
    return result.exitCode === 0;
  },

  async get(account: string): Promise<KeychainResult> {
    const result = await exec('security', [
      'find-generic-password',
      '-s', SERVICE,
      '-a', account,
      '-w',
    ]);
    if (result.exitCode === 0 && result.stdout.trim()) {
      return { success: true, value: result.stdout.trim() };
    }
    return { success: false };
  },

  async remove(account: string): Promise<boolean> {
    const result = await exec('security', [
      'delete-generic-password',
      '-s', SERVICE,
      '-a', account,
    ]);
    return result.exitCode === 0;
  },
};

// Linux via `secret-tool` (libsecret / GNOME Keyring / KDE Wallet)
const linux = {
  async isAvailable(): Promise<boolean> {
    return commandExists('secret-tool');
  },

  async set(account: string, value: string): Promise<boolean> {
    return new Promise((resolve) => {
      const proc = execFile('secret-tool', [
        'store',
        '--label', `CloudCart CLI: ${account}`,
        'service', SERVICE,
        'account', account,
      ], { timeout: 5000 }, (error) => {
        resolve(!error);
      });
      // secret-tool reads the secret from stdin (not visible in process list)
      proc.stdin?.write(value);
      proc.stdin?.end();
    });
  },

  async get(account: string): Promise<KeychainResult> {
    const result = await exec('secret-tool', [
      'lookup',
      'service', SERVICE,
      'account', account,
    ]);
    if (result.exitCode === 0 && result.stdout) {
      return { success: true, value: result.stdout };
    }
    return { success: false };
  },

  async remove(account: string): Promise<boolean> {
    const result = await exec('secret-tool', [
      'clear',
      'service', SERVICE,
      'account', account,
    ]);
    return result.exitCode === 0;
  },
};

type Backend = typeof macOS;

function getBackend(): Backend | null {
  const os = platform();
  if (os === 'darwin') return macOS;
  if (os === 'linux') return linux;
  // Windows: `cmdkey` can store a password but not read one back without extra modules, so the
  // credentials stay in the file storage there until a reliable built-in way is found.
  return null;
}

let _keychainAvailable: boolean | null = null;

/**
 * Check if OS keychain is available (correct OS + required CLI tool installed).
 * Result is cached for the process lifetime.
 */
export async function isKeychainAvailable(): Promise<boolean> {
  if (_keychainAvailable !== null) return _keychainAvailable;
  const backend = getBackend();
  if (!backend) {
    _keychainAvailable = false;
    return false;
  }
  _keychainAvailable = await backend.isAvailable();
  return _keychainAvailable;
}

export async function keychainSet(account: string, value: string): Promise<boolean> {
  if (!(await isKeychainAvailable())) return false;
  const backend = getBackend()!;
  try {
    return await backend.set(account, value);
  } catch {
    return false;
  }
}

export async function keychainGet(account: string): Promise<string | null> {
  if (!(await isKeychainAvailable())) return null;
  const backend = getBackend()!;
  try {
    const result = await backend.get(account);
    return result.success ? (result.value ?? null) : null;
  } catch {
    return null;
  }
}

export async function keychainRemove(account: string): Promise<boolean> {
  if (!(await isKeychainAvailable())) return false;
  const backend = getBackend()!;
  try {
    return await backend.remove(account);
  } catch {
    return false;
  }
}
