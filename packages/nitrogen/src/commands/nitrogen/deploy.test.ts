import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
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
  writeFileSync(join(root, '.cloudcart/project.json'), JSON.stringify({ store: 'shop.example.com', storefrontId: '42' }));
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

  it("names the admin page that makes a token: the linked storefront's, or the storefronts' list (B-488)", async () => {
    const { root } = built();
    await expect(deploy('--path', root, '--no-build')).rejects.toMatchObject({ oclif: { exit: 1 } });
    expect(output.join('\n')).toContain("the storefront's Deployments tab → Deployment tokens → Create token");
    expect(output.join('\n')).toContain('https://shop.example.com/admin/nitrogen/42/nova');

    output = [];
    rmSync(join(root, '.cloudcart'), { recursive: true });
    await expect(deploy('--path', root, '--no-build')).rejects.toMatchObject({ oclif: { exit: 1 } });
    expect(output.join('\n')).toContain('https://<your store>/admin/nitrogen');
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

describe('nitrogen deploy, the commit it records (B-486)', () => {
  const git = (root: string, ...args: string[]) =>
    execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgsign=false', ...args], {
      cwd: root,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();

  /** Deploys `root` and returns the git fields of the form the store got. */
  async function recorded(root: string) {
    answers = [json({ data: { account_id: 'acct', upload_jwt: uploadJwt, buckets: [] } }), json({ data: { status: 'live' } })];
    await deploy('--path', root, '--no-build', '--token', deployToken);
    const form = sent.at(-1)!.body as FormData;
    return Object.fromEntries(['commit_sha', 'commit_message', 'branch'].map((name) => [name, form.get(name)]));
  }

  it('sends none before the first commit, as `init` leaves a project', async () => {
    const { root } = built();
    git(root, 'init', '-b', 'main');
    expect(await recorded(root)).toEqual({ commit_sha: null, commit_message: null, branch: null });
  });

  it('sends the commit, its message and the branch', async () => {
    const { root } = built();
    git(root, 'init', '-b', 'main');
    git(root, 'add', 'package.json');
    git(root, 'commit', '-m', 'First page');
    expect(await recorded(root)).toEqual({ commit_sha: git(root, 'rev-parse', '--short', 'HEAD'), commit_message: 'First page', branch: 'main' });
  });
});

describe('nitrogen deploy, a first deploy of an environment (B-488)', () => {
  const address = 'https://main.nova.example';
  const deploying = () => [
    json({ data: { account_id: 'acct', upload_jwt: uploadJwt, buckets: [] } }),
    json({ data: { deployed_url: address, id: 'dep-1', status: 'deploying' } }),
  ];

  beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'Date'] }));
  afterEach(() => vi.useRealTimers());

  /** Runs a deploy while the clock moves on, a second at a time. */
  async function deployWaiting(root: string) {
    let done = false;
    const run = deploy('--path', root, '--no-build', '--token', deployToken).finally(() => (done = true));
    while (!done) {
      await new Promise((resolve) => setImmediate(resolve));
      await vi.advanceTimersByTimeAsync(1_000);
    }
    await run;
  }

  it('waits until the address answers with the storefront, then says it is live', async () => {
    answers = [
      ...deploying(),
      () => {
        throw new TypeError('fetch failed');
      },
      () => new Response('<p>Deploy your project to go live</p>'),
      () => new Response('<html>The store</html>'),
    ];
    await deployWaiting(built().root);

    expect(sent.slice(2).map(({ url }) => url)).toEqual([address, address, address]);
    expect(output.join('\n')).toContain(`Live: ${address}`);
    expect(output.join('\n')).not.toContain('does not answer yet');
  });

  it('stops waiting after three minutes and says where to follow the deployment', async () => {
    answers = deploying();
    const started = Date.now();
    await deployWaiting(built().root);

    expect(Date.now() - started).toBeLessThanOrEqual(3 * 60_000 + 1_000);
    expect(sent.length).toBeGreaterThan(30);
    expect(output.join('\n')).toContain(`${address} does not answer yet`);
    expect(output.join('\n')).toContain('https://shop.example.com/admin/nitrogen/42/nova');
    expect(output.join('\n')).not.toContain('Live:');
  });

  it('does not wait for a deploy that is live', async () => {
    answers = [deploying()[0], json({ data: { deployed_url: address, id: 'dep-2', status: 'live' } })];
    await deploy('--path', built().root, '--no-build', '--token', deployToken);
    expect(sent).toHaveLength(2);
    expect(output.join('\n')).not.toContain('Waiting for');
  });
});
