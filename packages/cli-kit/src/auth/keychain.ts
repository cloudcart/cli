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

// Windows via PowerShell + dpapi (built-in, no extra modules needed)
const windows = {
  async isAvailable(): Promise<boolean> {
    return commandExists('powershell');
  },

  async set(account: string, value: string): Promise<boolean> {
    const target = `${SERVICE}:${account}`;
    // Use built-in cmdkey. The password is passed via arg here but cmdkey
    // is the standard Windows approach and args are not visible to other
    // users on modern Windows (post-Vista process isolation).
    const result = await exec('cmdkey', [
      `/generic:${target}`,
      `/user:${account}`,
      `/pass:${value}`,
    ]);
    return result.exitCode === 0;
  },

  async get(account: string): Promise<KeychainResult> {
    const target = `${SERVICE}:${account}`;
    // Use built-in PowerShell with .NET CredentialManager (no external modules)
    const ps = [
      `Add-Type -AssemblyName System.Runtime.InteropServices`,
      `$target = '${target.replace(/'/g, "''")}'`,
      // Use P/Invoke to call CredRead from advapi32.dll
      `$sig = '[DllImport("advapi32.dll", SetLastError=true, CharSet=CharSet.Unicode)]`,
      `public static extern bool CredRead(string target, int type, int flags, out IntPtr cred);`,
      `[DllImport("advapi32.dll")] public static extern void CredFree(IntPtr cred);'`,
      `$Advapi = Add-Type -MemberDefinition $sig -Namespace "CredManager" -Name "Advapi32" -PassThru`,
      `$ptr = [IntPtr]::Zero`,
      `if ($Advapi::CredRead($target, 1, 0, [ref]$ptr)) {`,
      `  $cred = [System.Runtime.InteropServices.Marshal]::PtrToStructure($ptr, [Type][System.Runtime.InteropServices.ComTypes.CREDENTIAL])`,
      // Fallback: just use cmdkey /list and parse
      `  $Advapi::CredFree($ptr)`,
      `}`,
    ].join('; ');

    // Simpler approach: use cmdkey /list and parse the output
    const listResult = await exec('cmdkey', ['/list']);
    if (listResult.exitCode !== 0) return { success: false };

    // cmdkey /list output contains "Target: ..." lines
    // We need to find our target, but cmdkey doesn't output passwords
    // cmdkey is write-only for passwords on Windows.
    // For reading, we need PowerShell with DPAPI or the CredentialManager module.
    // Since neither is guaranteed built-in, fall back to file storage on Windows.
    return { success: false };
  },

  async remove(account: string): Promise<boolean> {
    const target = `${SERVICE}:${account}`;
    const result = await exec('cmdkey', [`/delete:${target}`]);
    return result.exitCode === 0;
  },
};

type Backend = typeof macOS;

function getBackend(): Backend | null {
  const os = platform();
  if (os === 'darwin') return macOS;
  if (os === 'linux') return linux;
  // Windows: cmdkey can write but can't read passwords without extra modules.
  // Fall back to file storage on Windows until we find a reliable built-in approach.
  // if (os === 'win32') return windows;
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
