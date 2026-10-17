import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { copyRoute, missingImports, starterRoutes } from './routes.js';

const folders: string[] = [];

afterEach(() => {
  for (const path of folders.splice(0)) rmSync(path, { recursive: true, force: true });
});

function folder(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'nitrogen-routes-test-'));
  folders.push(root);
  mkdirSync(join(root, 'app/routes'), { recursive: true });
  for (const [path, body] of Object.entries(files)) {
    mkdirSync(join(root, path, '..'), { recursive: true });
    writeFileSync(join(root, path), body);
  }
  return root;
}

describe('starterRoutes', () => {
  it('names each route file by its name without the extension, and nothing else', () => {
    const starter = folder({
      'app/routes/product.$handle.tsx': '',
      'app/routes/[robots.txt].tsx': '',
      'app/routes/gdpr.request.($type).tsx': '',
      'app/routes/cart.ts': '',
      'app/routes/notes.md': '',
      'app/routes/types.d.ts': '',
      'app/routes/nested/route.tsx': '',
    });
    expect([...starterRoutes(starter)]).toEqual([
      ['[robots.txt]', '[robots.txt].tsx'],
      ['cart', 'cart.ts'],
      ['gdpr.request.($type)', 'gdpr.request.($type).tsx'],
      ['product.$handle', 'product.$handle.tsx'],
    ]);
  });
});

describe('copyRoute', () => {
  it('writes a route the project lacks, keeps one it has, and overwrites that with force', () => {
    const starter = folder({ 'app/routes/cart.tsx': 'the starter\'s cart\n' });
    const project = folder({});

    expect(copyRoute(starter, project, 'cart.tsx', false)).toBe('written');
    expect(readFileSync(join(project, 'app/routes/cart.tsx'), 'utf-8')).toBe('the starter\'s cart\n');

    writeFileSync(join(project, 'app/routes/cart.tsx'), 'the developer\'s cart\n');
    expect(copyRoute(starter, project, 'cart.tsx', false)).toBe('kept');
    expect(readFileSync(join(project, 'app/routes/cart.tsx'), 'utf-8')).toBe('the developer\'s cart\n');

    expect(copyRoute(starter, project, 'cart.tsx', true)).toBe('written');
    expect(readFileSync(join(project, 'app/routes/cart.tsx'), 'utf-8')).toBe('the starter\'s cart\n');
  });
});

describe('missingImports', () => {
  it('lists the ~/ modules the project lacks, by every way a module resolves', () => {
    const project = folder({
      'app/routes/product.tsx': [
        "import {Gallery} from '~/components/Gallery';",
        "import {urls} from '~/lib/urls';",
        "import type {X} from '~/lib/types';",
        "import {Missing} from '~/components/Missing';",
        "import '~/styles/product.css';",
        "const Lazy = lazy(() => import('~/components/Lazy'));",
        "import {useState} from 'react';",
        "export {thing} from '~/lib/reexported';",
      ].join('\n'),
      'app/components/Gallery.tsx': '',
      'app/lib/urls/index.ts': '',
      'app/lib/types.ts': '',
      'app/styles/product.css': '',
      'app/lib/reexported.js': '',
    });
    expect(missingImports(project, 'product.tsx')).toEqual(['~/components/Lazy', '~/components/Missing']);
  });
});
