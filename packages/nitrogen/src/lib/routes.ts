/**
 * The starter's routes, copied into a project: the files React Router's flat routes read from `app/routes/`,
 * named after the platform's URLs (`product.$handle`, `category.$handle`, `page.$handle`, …).
 */

import { copyFileSync, existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

const ROUTE_FILE = /\.(tsx|ts|jsx|js)$/;

/** The starter's routes by name — a file's name without its extension, as `generate route` takes it — to its file. */
export function starterRoutes(starterRoot: string): Map<string, string> {
  const routes = new Map<string, string>();
  const entries = readdirSync(resolve(starterRoot, 'app/routes'), { withFileTypes: true });
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.isFile() && ROUTE_FILE.test(entry.name) && !entry.name.endsWith('.d.ts')) {
      routes.set(entry.name.replace(ROUTE_FILE, ''), entry.name);
    }
  }
  return routes;
}

/** Copies the starter's route file into the project's `app/routes/`; one already there is kept unless `force`. */
export function copyRoute(starterRoot: string, projectRoot: string, file: string, force: boolean): 'written' | 'kept' {
  const target = resolve(projectRoot, 'app/routes', file);
  if (existsSync(target) && !force) return 'kept';
  copyFileSync(resolve(starterRoot, 'app/routes', file), target);
  return 'written';
}

const PROJECT_IMPORT = /\bfrom\s*['"]~\/([^'"]+)['"]|\bimport\s*\(\s*['"]~\/([^'"]+)['"]\s*\)|^\s*import\s+['"]~\/([^'"]+)['"]/gm;
const MODULE_ENDINGS = ['.ts', '.tsx', '.js', '.jsx', '/index.ts', '/index.tsx', '/index.js', '/index.jsx'];

/**
 * The project's own modules (`~/…`, the project's `app/`) a route in it imports that are not there: a route
 * copied from a newer starter can need a component or helper the project does not have yet.
 */
export function missingImports(projectRoot: string, file: string): string[] {
  const source = readFileSync(resolve(projectRoot, 'app/routes', file), 'utf-8');
  const modules = new Set([...source.matchAll(PROJECT_IMPORT)].map((match) => match[1] ?? match[2] ?? match[3]));
  return [...modules].filter((module) => !resolves(resolve(projectRoot, 'app', module))).map((module) => `~/${module}`).sort();
}

function resolves(base: string): boolean {
  if (existsSync(base) && statSync(base).isFile()) return true;
  return MODULE_ENDINGS.some((ending) => existsSync(base + ending));
}
