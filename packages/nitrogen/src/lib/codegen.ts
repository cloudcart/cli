/**
 * The project's generated types: its `#graphql` queries' types, made by the GraphQL codegen from the Storefront
 * API schema Nitrogen ships (no network, no token), and React Router's route types.
 */

import { existsSync, watch } from 'node:fs';
import { join, resolve } from 'node:path';
import { exec } from './project.js';

/**
 * Runs the project's GraphQL codegen: with its `codegen.ts` when it has one (the starter's), otherwise with the
 * config graphql-codegen finds itself.
 */
export async function runGraphqlCodegen(root: string, env: Record<string, string>): Promise<void> {
  const config = existsSync(resolve(root, 'codegen.ts')) ? ['--config', 'codegen.ts'] : [];
  try {
    await exec('npx', ['graphql-codegen', ...config], root, env);
  } catch (error) {
    throw new Error(`The GraphQL codegen failed (${(error as Error).message}); its output is above.`);
  }
}

/** The GraphQL types, then the route types: what the project's own `codegen` script makes. */
export async function runCodegen(root: string, env: Record<string, string>): Promise<void> {
  await runGraphqlCodegen(root, env);
  try {
    await exec('npx', ['react-router', 'typegen'], root, env);
  } catch (error) {
    throw new Error(`React Router's typegen failed (${(error as Error).message}); its output is above.`);
  }
}

const SOURCE = /\.(ts|tsx|js|jsx)$/;

/**
 * Whether a change to this file (relative to the project's root) can change the GraphQL types: a source file at
 * the root or under `app/`, where the starter's `codegen.ts` reads its documents. A declaration file — the
 * generated types among them — never is, or every run would start the next.
 */
export function isCodegenSource(file: string): boolean {
  if (!SOURCE.test(file) || file.endsWith('.d.ts')) return false;
  const parts = file.split(/[\\/]/);
  return parts.length === 1 || parts[0] === 'app';
}

/**
 * Runs `run` again whenever a codegen source changes, `delay` ms after the last change. A change during a run
 * queues one more run, never several; a failed run goes to `onError` and the watch goes on. Watches the root
 * (not its folders, so not `node_modules`) and `app/` with everything under it.
 */
export function watchCodegen(
  root: string,
  run: () => Promise<void>,
  onError: (error: Error) => void,
  delay = 300,
): { close(): void } {
  let timer: NodeJS.Timeout | undefined;
  let running = false;
  let again = false;

  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(start, delay);
  };

  const start = async () => {
    if (running) {
      again = true;
      return;
    }
    running = true;
    try {
      await run();
    } catch (error) {
      onError(error as Error);
    }
    running = false;
    if (again) {
      again = false;
      schedule();
    }
  };

  const changed = (folder: string) => (_event: string, name: string | Buffer | null) => {
    if (name && isCodegenSource(folder ? join(folder, name.toString()) : name.toString())) schedule();
  };

  const watchers = [watch(root, changed(''))];
  if (existsSync(resolve(root, 'app'))) watchers.push(watch(resolve(root, 'app'), { recursive: true }, changed('app')));

  return {
    close() {
      clearTimeout(timer);
      for (const watcher of watchers) watcher.close();
    },
  };
}
