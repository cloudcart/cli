import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { exec } from '../../lib/project.js';
import NitrogenDeploy from './deploy.js';

vi.mock('../../lib/project.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/project.js')>()),
  exec: vi.fn(async () => {}),
}));

// Made up for each run: no real token is ever in a test.
const deployToken = `test-deploy-${randomBytes(8).toString('hex')}`;
const uploadJwt = `test-upload-${randomBytes(8).toString('hex')}`;
const completionJwt = `test-completion-${randomBytes(8).toString('hex')}`;

interface Sent {
  url: string;
  headers: Record<string, string>;
  body: unknown;
}
let sent: Sent[] = [];
let answers: Array<() => Response> = [];
const folders: string[] = [];
let output: string[] = [];

beforeEach(() => {
  sent = [];
  output = [];
  vi.stubEnv('CLOUDCART_NOVA_TOKEN', '');
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    const headers: Record<string, string> = {};
    new Headers(init.headers).forEach((value, name) => (headers[name] = value));
    sent.push({ url, headers, body: init.body });
    const answer = answers.shift();
    if (!answer) throw new Error(`unexpected request to ${url}`);
    return answer();
  });
  for (const method of ['log', 'error', 'warn'] as const) {
    vi.spyOn(console, method).mockImplementation((...args: unknown[]) => void output.push(args.join(' ')));
  }
});

afterEach(() => {
  for (const path of folders.splice(0)) rmSync(path, { recursive: true, force: true });
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.mocked(exec).mockClear();
});

const json = (body: unknown, status = 200) => () => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** A linked project with a built worker and one client asset. */
function built(): { root: string; assetHash: string } {
  const root = mkdtempSync(join(tmpdir(), 'nitrogen-deploy-test-'));
  folders.push(root);
  mkdirSync(join(root, 'app/routes'), { recursive: true });
  mkdirSync(join(root, '.cloudcart'));
  mkdirSync(join(root, 'build/server'), { recursive: true });
  mkdirSync(join(root, 'build/client/assets'), { recursive: true });
  writeFileSync(join(root, 'package.json'), '{"name":"store"}\n');
  writeFileSync(join(root, '.cloudcart/project.json'), JSON.stringify({ store: 'shop.example.com', storefrontId: 'gid-1' }));
  writeFileSync(join(root, 'build/server/index.js'), 'export default {};\n');
  const asset = 'console.log(1);\n';
  writeFileSync(join(root, 'build/client/assets/root-abc.js'), asset);
  return { root, assetHash: createHash('sha256').update(asset).digest('hex').slice(0, 32) };
}

const config = { runHook: async () => ({ successes: [], failures: [] }) };
const deploy = (...argv: string[]) => new NitrogenDeploy(argv, config as never).run();

describe('nitrogen deploy', () => {
  it('fails without a deploy token, sending nothing', async () => {
    answers = [];
    await expect(deploy('--path', built().root, '--no-build')).rejects.toMatchObject({ oclif: { exit: 1 } });
    expect(output.join('\n')).toContain('No deploy token found.');
    expect(sent).toEqual([]);
  });

  it('opens an upload session, uploads the missing asset to Cloudflare, then deploys the worker', async () => {
    const { root, assetHash } = built();
    answers = [
      json({ data: { account_id: 'acct', upload_jwt: uploadJwt, buckets: [[assetHash]] } }),
      json({ result: { jwt: completionJwt } }),
      json({ data: { deployed_url: 'https://main.nova.example', id: 'dep-1', status: 'active' } }),
    ];
    await deploy('--path', root, '--no-build', '--token', deployToken);

    expect(sent.map(({ url }) => url)).toEqual([
      'https://shop.example.com/admin/api/core/nitrogen/nova/deploy/assets-session',
      'https://api.cloudflare.com/client/v4/accounts/acct/workers/assets/upload?base64=true',
      'https://shop.example.com/admin/api/core/nitrogen/nova/deploy',
    ]);
    // The deploy token goes to the store only; Cloudflare gets the short-lived upload token.
    expect(sent[0].headers['x-nova-deploy-token']).toBe(deployToken);
    expect(sent[1].headers['x-nova-deploy-token']).toBeUndefined();
    expect(sent[1].headers.authorization).toBe(`Bearer ${uploadJwt}`);
    expect(sent[2].headers['x-nova-deploy-token']).toBe(deployToken);
    expect(JSON.parse(sent[0].body as string)).toEqual({
      manifest: { '/assets/root-abc.js': { hash: assetHash, size: 16 } },
      environment: 'production',
    });
    const form = sent[2].body as FormData;
    expect(form.get('environment')).toBe('production');
    expect(form.get('assets_jwt')).toBe(completionJwt);
    expect(await (form.get('worker') as Blob).text()).toBe('export default {};\n');
    expect(output.join('\n')).toContain('Deployed:');
    expect(output.join('\n')).not.toContain(deployToken);
  });

  it('builds first unless told not to', async () => {
    const { root } = built();
    answers = [json({ data: { account_id: 'acct', upload_jwt: uploadJwt, buckets: [] } }), json({ data: { status: 'active' } })];
    await deploy('--path', root, '--token', deployToken, '--preview');

    expect(vi.mocked(exec).mock.calls.map(([command, args, , env]) => `${[command, ...args].join(' ')} (${env?.NODE_ENV})`)).toEqual([
      'npx react-router build (production)',
    ]);
    expect(JSON.parse(sent[0].body as string).environment).toBe('preview');
  });

  it('stops when the store refuses the upload session, saying why once', async () => {
    answers = [json({ message: 'Invalid deploy token' }, 401)];
    await expect(deploy('--path', built().root, '--no-build', '--token', deployToken)).rejects.toMatchObject({ oclif: { exit: 1 } });

    expect(sent).toHaveLength(1);
    expect(output.filter((line) => line.includes('Upload session failed: Invalid deploy token'))).toHaveLength(1);
    expect(output.join('\n')).not.toMatch(/EEXIT|Deploy failed/);
  });

  it('stops when the deploy is refused, saying why once', async () => {
    const { root } = built();
    answers = [json({ data: { account_id: 'acct', upload_jwt: uploadJwt, buckets: [] } }), json({ message: 'Worker too large' }, 413)];
    await expect(deploy('--path', root, '--no-build', '--token', deployToken)).rejects.toMatchObject({ oclif: { exit: 1 } });

    expect(output.filter((line) => line.includes('Deploy failed: Worker too large'))).toHaveLength(1);
    expect(output.join('\n')).not.toContain('EEXIT');
  });
});
