import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadEnvFile } from './project.js';
import { envFileText, NITROGEN_RANGE, packageName, prepareProject, unsupportedNode } from './new-project.js';

const folders: string[] = [];

afterEach(() => {
  for (const path of folders.splice(0)) rmSync(path, { recursive: true, force: true });
});

const EXAMPLE = [
  '# Copy to `.env` for local development.',
  '',
  '# The store\'s domain.',
  'PUBLIC_STORE_DOMAIN=',
  '# The public token.',
  'PUBLIC_STOREFRONT_API_TOKEN=',
  '# The private token.',
  'PRIVATE_STOREFRONT_API_TOKEN=',
  '# Signs the session cookie.',
  'SESSION_SECRET=',
  '',
].join('\n');

/** An unpacked starter as a local one gives it: Nitrogen from local packs, npm's lockfile. */
function starter(files: { example?: string | null; engines?: string } = {}): string {
  const root = mkdtempSync(join(tmpdir(), 'nitrogen-project-test-'));
  folders.push(root);
  const pkg = {
    name: 'nitrogen-starter',
    private: true,
    type: 'module',
    scripts: { dev: 'react-router dev' },
    dependencies: {
      '@cloudcart/nitrogen': 'file:../cloudcart-nitrogen/packages/nitrogen/cloudcart-nitrogen-2.0.0.tgz',
      '@cloudcart/nitrogen-react': 'file:../cloudcart-nitrogen/packages/nitrogen-react/cloudcart-nitrogen-react-2.0.0.tgz',
      react: '^19.1.0',
    },
    devDependencies: {
      '@cloudcart/nitrogen-codegen': 'file:../cloudcart-nitrogen/packages/nitrogen-codegen/cloudcart-nitrogen-codegen-2.0.0.tgz',
      '@cloudcart/unrelated': '^1.0.0',
      vite: '^6.2.4',
    },
    ...(files.engines ? { engines: { node: files.engines } } : {}),
  };
  writeFileSync(join(root, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');
  writeFileSync(join(root, 'package-lock.json'), '{"lockfileVersion":3}\n');
  if (files.example !== null) writeFileSync(join(root, '.env.example'), files.example ?? EXAMPLE);
  return root;
}

function packageJson(root: string) {
  return JSON.parse(readFileSync(join(root, 'package.json'), 'utf-8'));
}

describe('packageName', () => {
  it.each([
    ['my-store', 'my-store'],
    ['/work/My Store', 'my-store'],
    ['_private', 'private'],
    ['.hidden.', 'hidden'],
    ['Магазин', 'nitrogen-storefront'],
    ['a'.repeat(300), 'a'.repeat(214)],
  ])('%s → %s', (folder, name) => {
    expect(packageName(folder)).toBe(name);
  });
});

describe('prepareProject', () => {
  it('names the project and points a Nitrogen package on a local pack to the published release', () => {
    const root = starter();
    prepareProject(root, { name: 'my-store', packageManager: 'npm' });
    const pkg = packageJson(root);

    expect(pkg.name).toBe('my-store');
    expect(pkg.dependencies).toEqual({
      '@cloudcart/nitrogen': NITROGEN_RANGE,
      '@cloudcart/nitrogen-react': NITROGEN_RANGE,
      react: '^19.1.0',
    });
    expect(pkg.devDependencies).toEqual({
      '@cloudcart/nitrogen-codegen': NITROGEN_RANGE,
      '@cloudcart/unrelated': '^1.0.0',
      vite: '^6.2.4',
    });
    expect(NITROGEN_RANGE).toBe('^2.0.0');
    expect(readFileSync(join(root, 'package.json'), 'utf-8')).not.toContain('file:');
  });

  it("keeps the starter's own published range, which matches its code (B-504)", () => {
    const root = starter();
    const path = join(root, 'package.json');
    const pkg = JSON.parse(readFileSync(path, 'utf-8'));
    pkg.dependencies['@cloudcart/nitrogen'] = '^2.1.0';
    pkg.dependencies['@cloudcart/nitrogen-react'] = '~2.1.3';
    pkg.devDependencies['@cloudcart/nitrogen-codegen'] = 'workspace:*';
    writeFileSync(path, JSON.stringify(pkg));

    prepareProject(root, { name: 'my-store', packageManager: 'npm' });

    expect(packageJson(root).dependencies).toMatchObject({ '@cloudcart/nitrogen': '^2.1.0', '@cloudcart/nitrogen-react': '~2.1.3' });
    expect(packageJson(root).devDependencies).toMatchObject({ '@cloudcart/nitrogen-codegen': NITROGEN_RANGE });
  });

  it('keeps npm\'s lockfile for npm and removes it for pnpm and yarn', () => {
    const npm = starter();
    prepareProject(npm, { name: 'a', packageManager: 'npm' });
    expect(existsSync(join(npm, 'package-lock.json'))).toBe(true);

    for (const packageManager of ['pnpm', 'yarn'] as const) {
      const root = starter();
      prepareProject(root, { name: 'a', packageManager });
      expect(existsSync(join(root, 'package-lock.json'))).toBe(false);
    }
  });

  it('writes .env from the example, for its owner only, with a secret of its own', () => {
    const first = starter();
    const second = starter();
    prepareProject(first, { name: 'a', packageManager: 'npm', store: { domain: 'shop.example.com', publicToken: 'public-token' } });
    prepareProject(second, { name: 'b', packageManager: 'npm' });

    expect(statSync(join(first, '.env')).mode & 0o777).toBe(0o600);
    const env = loadEnvFile(join(first, '.env'));
    expect(Object.keys(env)).toEqual(['PUBLIC_STORE_DOMAIN', 'PUBLIC_STOREFRONT_API_TOKEN', 'PRIVATE_STOREFRONT_API_TOKEN', 'SESSION_SECRET']);
    expect(env.PUBLIC_STORE_DOMAIN).toBe('shop.example.com');
    expect(env.PUBLIC_STOREFRONT_API_TOKEN).toBe('public-token');
    expect(env.PRIVATE_STOREFRONT_API_TOKEN).toBe('');
    expect(env.SESSION_SECRET).toMatch(/^[0-9a-f]{64}$/);
    expect(readFileSync(join(first, '.env'), 'utf-8')).toContain('# Signs the session cookie.\nSESSION_SECRET=');

    const other = loadEnvFile(join(second, '.env'));
    expect(other.SESSION_SECRET).toMatch(/^[0-9a-f]{64}$/);
    expect(other.SESSION_SECRET).not.toBe(env.SESSION_SECRET);
    expect(other.PUBLIC_STORE_DOMAIN).toBe('');
  });

  it('writes the secret when the starter has no example', () => {
    const root = starter({ example: null });
    prepareProject(root, { name: 'a', packageManager: 'npm', store: { domain: 'shop.example.com' } });
    expect(Object.keys(loadEnvFile(join(root, '.env')))).toEqual(['SESSION_SECRET', 'PUBLIC_STORE_DOMAIN']);
  });
});

describe('envFileText', () => {
  it('fills the example\'s keys in place and adds the ones it lacks at the end', () => {
    expect(envFileText('# a comment\nA=\nB=old\n\n', { B: 'new', C: 'added' })).toBe('# a comment\nA=\nB=new\nC=added\n');
  });

  it('writes only the values when there is no example', () => {
    expect(envFileText('', { SESSION_SECRET: 'x' })).toBe('SESSION_SECRET=x\n');
  });

  it('leaves a commented-out key a comment', () => {
    expect(envFileText('# B=\n', { B: 'value' })).toBe('# B=\nB=value\n');
  });
});

describe('unsupportedNode', () => {
  it('names the starter\'s range when the running Node is outside it', () => {
    const root = starter({ engines: '^22 || ^24' });
    expect(unsupportedNode(root, 'v20.18.0')).toBe('^22 || ^24');
    expect(unsupportedNode(root, 'v23.1.0')).toBe('^22 || ^24');
    expect(unsupportedNode(root, 'v22.12.0')).toBeNull();
    expect(unsupportedNode(root, 'v24.13.1')).toBeNull();
  });

  it('says nothing when the starter names no range', () => {
    expect(unsupportedNode(starter(), 'v18.0.0')).toBeNull();
  });
});
