import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { isCodegenSource, watchCodegen } from './codegen.js';

describe('isCodegenSource', () => {
  it.each([
    ['server.ts', true],
    ['app/root.tsx', true],
    ['app/routes/product.tsx', true],
    ['app/lib/fragments.js', true],
    ['app/components/deep/Card.jsx', true],
    ['storefrontapi.generated.d.ts', false],
    ['env.d.ts', false],
    ['app/styles/app.css', false],
    ['node_modules/pkg/index.js', false],
    ['build/server/index.js', false],
    ['.react-router/types/app/+types/root.ts', false],
    ['scripts/check.mjs', false],
  ])('%s → %s', (file, expected) => {
    expect(isCodegenSource(file)).toBe(expected);
  });
});

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const folders: string[] = [];
const watches: Array<{ close(): void }> = [];

afterEach(() => {
  for (const watch of watches.splice(0)) watch.close();
  for (const path of folders.splice(0)) rmSync(path, { recursive: true, force: true });
});

function project(): string {
  const root = mkdtempSync(join(tmpdir(), 'nitrogen-codegen-test-'));
  folders.push(root);
  mkdirSync(join(root, 'app/routes'), { recursive: true });
  writeFileSync(join(root, 'app/routes/_index.tsx'), 'export {}\n');
  return root;
}

describe('watchCodegen', () => {
  it('runs once for a burst of changes to sources, and never for the generated types', async () => {
    const root = project();
    let runs = 0;
    watches.push(watchCodegen(root, async () => void runs++, () => {}, 100));
    // macOS reports the files written just before the watch began: let those settle first.
    await wait(600);
    runs = 0;

    writeFileSync(join(root, 'storefrontapi.generated.d.ts'), '// generated\n');
    await wait(600);
    expect(runs).toBe(0);

    writeFileSync(join(root, 'app/routes/_index.tsx'), 'export const a = 1;\n');
    writeFileSync(join(root, 'app/routes/_index.tsx'), 'export const a = 2;\n');
    writeFileSync(join(root, 'server.ts'), 'export {}\n');
    await wait(600);
    expect(runs).toBe(1);
  });

  it('queues one more run for changes during a run, and goes on after a failure', async () => {
    const root = project();
    let runs = 0;
    const errors: string[] = [];
    watches.push(
      watchCodegen(
        root,
        async () => {
          runs++;
          await wait(400);
          if (runs === 1) throw new Error('a broken query');
        },
        (error) => errors.push(error.message),
        50,
      ),
    );
    // As above: the setup's own files first, then a clean count.
    await wait(1000);
    runs = 0;
    errors.length = 0;

    writeFileSync(join(root, 'app/routes/_index.tsx'), 'export const a = 1;\n');
    await wait(150);
    // During the first run: two changes, one more run.
    writeFileSync(join(root, 'app/routes/_index.tsx'), 'export const a = 2;\n');
    await wait(100);
    writeFileSync(join(root, 'app/routes/_index.tsx'), 'export const a = 3;\n');
    await wait(1200);

    expect(runs).toBe(2);
    expect(errors).toEqual(['a broken query']);
  });
});
