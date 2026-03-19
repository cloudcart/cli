/**
 * Shared utilities for Nitro plugin commands.
 */

import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';

/** Resolve and validate a Nitro project root. */
export function resolveProjectRoot(path: string): string {
  const root = resolve(path);
  return root;
}

/** Validate that a directory is a Nitro project. */
export function validateProject(root: string): void {
  if (!existsSync(resolve(root, 'package.json'))) {
    throw new Error(`No package.json found in ${root}. Is this a Nitro project?`);
  }
  if (!existsSync(resolve(root, 'app/routes'))) {
    throw new Error(`No app/routes/ directory found in ${root}. Is this a Nitro project?`);
  }
}

/** Load .env file into key-value pairs. */
export function loadEnvFile(envPath: string): Record<string, string> {
  if (!existsSync(envPath)) return {};
  const env: Record<string, string> = {};

  for (const line of readFileSync(envPath, 'utf-8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex === -1) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    let value = trimmed.slice(eqIndex + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }

  return env;
}

/** Read .cloudcart/project.json config. */
export function readProjectConfig(root: string): Record<string, unknown> {
  const configPath = resolve(root, '.cloudcart', 'project.json');
  if (!existsSync(configPath)) return {};
  try {
    return JSON.parse(readFileSync(configPath, 'utf-8'));
  } catch {
    return {};
  }
}

/** Write .cloudcart/project.json config. */
export function writeProjectConfig(root: string, config: Record<string, unknown>): void {
  const dir = resolve(root, '.cloudcart');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(resolve(dir, 'project.json'), JSON.stringify(config, null, 2) + '\n');
}

/** Run a child process with inherited stdio. */
export function exec(
  command: string,
  args: string[],
  cwd: string,
  extraEnv: Record<string, string> = {},
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: 'inherit',
      env: { ...process.env, ...extraEnv },
      shell: true,
    });
    child.on('close', (code) => {
      if (code === 0 || code === null) resolve();
      else reject(new Error(`Process exited with code ${code}`));
    });
    child.on('error', reject);
  });
}
