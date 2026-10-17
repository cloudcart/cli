/**
 * Turns an unpacked starter into a developer's own project: its name, the Nitrogen release it installs, the
 * lockfile its package manager reads, and its `.env`.
 */

import { chmodSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import semver from 'semver';
import { newSessionSecret } from './session-secret.js';

/** The Nitrogen release a new project installs (§8). */
export const NITROGEN_RANGE = '^2.0.0';

/** `@cloudcart/nitrogen`, `@cloudcart/nitrogen-react`, `@cloudcart/nitrogen-codegen`. */
const NITROGEN_PACKAGE = /^@cloudcart\/nitrogen(-[a-z]+)?$/;

export type PackageManager = 'npm' | 'pnpm' | 'yarn';

/** The store a new project talks to before it is linked: its domain, and a public token when it has one. */
export interface StoreConnection {
  domain: string;
  publicToken?: string;
}

export interface ProjectOptions {
  name: string;
  packageManager: PackageManager;
  store?: StoreConnection;
}

/** An npm package name from a folder's name: lower case, URL-safe characters, no leading dot or underscore. */
export function packageName(folder: string): string {
  const name = basename(folder)
    .toLowerCase()
    .replace(/[^a-z0-9._~-]+/g, '-')
    .replace(/^[-._~]+|[-._~]+$/g, '');
  return name.slice(0, 214) || 'nitrogen-storefront';
}

/**
 * Makes the starter in `root` the developer's project:
 * - `package.json` takes the project's name, and every Nitrogen package the published range, whatever the
 *   starter pointed to (a local starter installs from local packs);
 * - npm keeps the starter's `package-lock.json`; pnpm and yarn make their own lockfile, so it is removed;
 * - `.env` is written from `.env.example` (see `envFileText`), readable by its owner only.
 */
export function prepareProject(root: string, options: ProjectOptions): void {
  const packagePath = resolve(root, 'package.json');
  const pkg = JSON.parse(readFileSync(packagePath, 'utf-8')) as Record<string, unknown>;
  pkg.name = options.name;
  for (const field of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
    const dependencies = pkg[field] as Record<string, string> | undefined;
    for (const dependency of Object.keys(dependencies ?? {})) {
      if (NITROGEN_PACKAGE.test(dependency)) dependencies![dependency] = NITROGEN_RANGE;
    }
  }
  writeFileSync(packagePath, JSON.stringify(pkg, null, 2) + '\n');

  if (options.packageManager !== 'npm') rmSync(resolve(root, 'package-lock.json'), { force: true });

  const examplePath = resolve(root, '.env.example');
  const example = existsSync(examplePath) ? readFileSync(examplePath, 'utf-8') : '';
  const envPath = resolve(root, '.env');
  writeFileSync(envPath, envFileText(example, envValues(options.store)), { mode: 0o600 });
  // The file holds the session secret: readable by its owner only, whatever the umask.
  chmodSync(envPath, 0o600);
}

/** The values `init` knows: a new session secret, and the store when one was chosen. */
function envValues(store: StoreConnection | undefined): Record<string, string> {
  return {
    SESSION_SECRET: newSessionSecret(),
    ...(store?.domain ? { PUBLIC_STORE_DOMAIN: store.domain } : {}),
    ...(store?.publicToken ? { PUBLIC_STOREFRONT_API_TOKEN: store.publicToken } : {}),
  };
}

/**
 * `.env`'s text: the example's lines in their order, its comments kept, each known key given its value; a
 * known key the example lacks is added at the end. Keys left empty are the developer's to fill, or
 * `env pull`'s.
 */
export function envFileText(example: string, values: Record<string, string>): string {
  const written = new Set<string>();
  const lines = example.split('\n').map((line) => {
    const key = /^([A-Za-z_][A-Za-z0-9_]*)=/.exec(line)?.[1];
    if (key === undefined || !(key in values)) return line;
    written.add(key);
    return `${key}=${values[key]}`;
  });
  const missing = Object.keys(values).filter((key) => !written.has(key));
  const body = lines.join('\n').replace(/\n+$/, '');
  const added = missing.map((key) => `${key}=${values[key]}`).join('\n');
  return [body, added].filter(Boolean).join('\n') + '\n';
}

/**
 * The starter's Node.js range when the running Node is outside it, so `init` can say so before the install;
 * null when it fits or the starter names none.
 */
export function unsupportedNode(root: string, version: string = process.version): string | null {
  const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf-8')) as { engines?: { node?: string } };
  const range = pkg.engines?.node;
  if (!range || !semver.validRange(range)) return null;
  return semver.satisfies(version, range) ? null : range;
}
