/**
 * Shared utilities for Nitrogen plugin commands.
 */

import spawn from 'cross-spawn';
import { resolve } from 'node:path';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';

/** Resolve and validate a Nitrogen project root. */
export function resolveProjectRoot(path: string): string {
  const root = resolve(path);
  return root;
}

/** Validate that a directory is a Nitrogen project. */
export function validateProject(root: string): void {
  if (!existsSync(resolve(root, 'package.json'))) {
    throw new Error(`No package.json found in ${root}. Is this a Nitrogen project?`);
  }
  if (!existsSync(resolve(root, 'app/routes'))) {
    throw new Error(`No app/routes/ directory found in ${root}. Is this a Nitrogen project?`);
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

/**
 * Runs a program with inherited stdio, each argument passed to it as it is: no shell joins them. `cross-spawn`
 * finds Windows' `.cmd` tools (`npm`, `npx`) and quotes for them, which Node's `spawn` does only through a shell
 * that joins the arguments unescaped (B-463).
 */
export function exec(
  command: string,
  args: string[],
  cwd: string,
  extraEnv: Record<string, string> = {},
  options: { forwardSignals?: boolean } = {},
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: 'inherit',
      env: { ...process.env, ...extraEnv },
    });

    // A server runs until it is stopped. Ctrl+C in a terminal reaches the whole process group, but a SIGTERM or
    // SIGHUP sent to the CLI alone — an editor's stop button, `kill` — would leave the server running without it
    // (B-503): with `forwardSignals` the signal is passed on, and the stop it asked for is not a failure.
    let stopped = false;
    const pass = (signal: NodeJS.Signals) => {
      stopped = true;
      child.kill(signal);
    };
    const signals: NodeJS.Signals[] = options.forwardSignals ? ['SIGINT', 'SIGTERM', 'SIGHUP'] : [];
    for (const signal of signals) process.on(signal, pass);
    const release = () => {
      for (const signal of signals) process.off(signal, pass);
    };

    child.on('close', (code, signal) => {
      release();
      if (code === 0 || stopped) resolve();
      // A process ended by a signal has no exit code: it did not finish its work (B-502).
      else if (signal) reject(new Error(`Process ended by signal ${signal}`));
      else reject(new Error(`Process exited with code ${code}`));
    });
    child.on('error', (error) => {
      release();
      reject(new Error(`Could not run ${command}: ${error.message}`));
    });
  });
}
