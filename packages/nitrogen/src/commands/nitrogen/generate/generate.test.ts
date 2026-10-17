import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import NitrogenGenerateRoute from './route.js';
import NitrogenGenerateRoutes from './routes.js';

const folders: string[] = [];
let output: string[] = [];

beforeEach(() => {
  output = [];
  for (const method of ['log', 'error', 'warn'] as const) {
    vi.spyOn(console, method).mockImplementation((...args: unknown[]) => void output.push(args.join(' ')));
  }
});

afterEach(() => {
  for (const path of folders.splice(0)) rmSync(path, { recursive: true, force: true });
  vi.restoreAllMocks();
});

function folder(): string {
  const path = mkdtempSync(join(tmpdir(), 'nitrogen-generate-test-'));
  folders.push(path);
  return path;
}

/** A starter with three routes on the platform's URLs, one of them needing a component. */
function starter(): string {
  const repository = folder();
  const git = (...args: string[]) => execFileSync('git', ['-C', repository, ...args], { stdio: 'ignore' });
  git('init', '-q');
  writeFileSync(join(repository, 'package.json'), '{"name":"nitrogen-starter"}\n');
  mkdirSync(join(repository, 'app/routes'), { recursive: true });
  mkdirSync(join(repository, 'app/components'), { recursive: true });
  writeFileSync(join(repository, 'app/routes/product.$handle.tsx'), "import {Gallery} from '~/components/Gallery';\n");
  writeFileSync(join(repository, 'app/routes/category.$handle.tsx'), 'export default function Category() {}\n');
  writeFileSync(join(repository, 'app/routes/cart.tsx'), 'export default function Cart() {}\n');
  writeFileSync(join(repository, 'app/components/Gallery.tsx'), 'export function Gallery() {}\n');
  git('add', '-A');
  git('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-q', '-m', 'starter');
  return repository;
}

function project(): string {
  const root = folder();
  writeFileSync(join(root, 'package.json'), '{"name":"store"}\n');
  mkdirSync(join(root, 'app/routes'), { recursive: true });
  return root;
}

const config = { runHook: async () => ({ successes: [], failures: [] }) };
const route = (...argv: string[]) => new NitrogenGenerateRoute(argv, config as never).run();
const routes = (...argv: string[]) => new NitrogenGenerateRoutes(argv, config as never).run();

describe('nitrogen generate route (T-505)', () => {
  it('copies the starter\'s route and names a component the project lacks', async () => {
    const source = starter();
    const root = project();
    await route('product.$handle', '--path', root, '--template', source);

    expect(readFileSync(join(root, 'app/routes/product.$handle.tsx'), 'utf-8')).toBe(
      readFileSync(join(source, 'app/routes/product.$handle.tsx'), 'utf-8'),
    );
    expect(output.join('\n')).toContain('imports modules this project does not have: ~/components/Gallery');
  });

  it('fails on a name the starter does not have, listing its routes', async () => {
    const root = project();
    await expect(route('products.$handle', '--path', root, '--template', starter())).rejects.toMatchObject({ oclif: { exit: 1 } });

    expect(output.join('\n')).toContain('The starter has no route "products.$handle". Its routes: cart, category.$handle, product.$handle');
    expect(readdirSync(join(root, 'app/routes'))).toEqual([]);
  });

  it('keeps the project\'s own route without --force', async () => {
    const root = project();
    writeFileSync(join(root, 'app/routes/cart.tsx'), 'mine\n');
    await route('cart', '--path', root, '--template', starter());

    expect(readFileSync(join(root, 'app/routes/cart.tsx'), 'utf-8')).toBe('mine\n');
    expect(output.join('\n')).toContain('already in the project: kept');
  });
});

describe('nitrogen generate routes (T-505)', () => {
  it('writes the routes the project lacks, keeps the others, and writes no sitemap route', async () => {
    const root = project();
    writeFileSync(join(root, 'app/routes/cart.tsx'), 'mine\n');
    await routes('--path', root, '--template', starter());

    expect(readdirSync(join(root, 'app/routes')).sort()).toEqual(['cart.tsx', 'category.$handle.tsx', 'product.$handle.tsx']);
    expect(readFileSync(join(root, 'app/routes/cart.tsx'), 'utf-8')).toBe('mine\n');
    expect(output.join('\n')).toContain("2 of the starter's routes written, 1 kept");
    expect(existsSync(join(root, 'app/routes/[sitemap.xml].tsx'))).toBe(false);
  });

  it('overwrites them all with --force', async () => {
    const root = project();
    writeFileSync(join(root, 'app/routes/cart.tsx'), 'mine\n');
    await routes('--path', root, '--template', starter(), '--force');

    expect(readFileSync(join(root, 'app/routes/cart.tsx'), 'utf-8')).toBe('export default function Cart() {}\n');
    expect(output.join('\n')).toContain("3 of the starter's routes written, 0 kept");
  });
});
