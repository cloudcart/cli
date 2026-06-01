import { Command, Flags } from '@oclif/core';
import { resolve, relative } from 'node:path';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { logger, colors, printNitrogenBanner, printGradientBar, printStep } from '@cloudcart/cli-kit';
import { resolveProjectRoot, validateProject, readProjectConfig, loadEnvFile, exec } from '../../lib/project.js';

interface AssetEntry {
  /** Served path, e.g. "/assets/root-abc.js" */
  path: string;
  absPath: string;
  /** SHA-256 of the contents, first 32 hex chars (Cloudflare manifest format) */
  hash: string;
  size: number;
  contentType: string;
}

export default class NitrogenDeploy extends Command {
  static override description = 'Deploy a Nitrogen storefront to Nova (CloudCart Edge Hosting)';

  static override examples = [
    '<%= config.bin %> nitrogen deploy',
    '<%= config.bin %> nitrogen deploy --preview',
    '<%= config.bin %> nitrogen deploy --token cc_nova_xxx',
  ];

  static override flags = {
    path: Flags.string({ description: 'Path to the Nitrogen storefront root', default: '.' }),
    'env-file': Flags.string({ description: 'Path to .env file', default: '.env' }),
    token: Flags.string({ char: 't', description: 'Nova deploy token (or set CLOUDCART_NOVA_TOKEN env var)' }),
    preview: Flags.boolean({ description: 'Deploy as preview (not production)', default: false }),
    'no-build': Flags.boolean({ description: 'Skip the build step', default: false }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(NitrogenDeploy);
    const root = resolveProjectRoot(flags.path);
    validateProject(root);

    printNitrogenBanner();

    // ── Read config ──
    const config = readProjectConfig(root);
    const envVars = loadEnvFile(resolve(root, flags['env-file']));

    // Resolve deploy token
    const deployToken = flags.token
      ?? envVars.CLOUDCART_NOVA_TOKEN
      ?? process.env.CLOUDCART_NOVA_TOKEN
      ?? (config.novaToken as string);

    if (!deployToken) {
      logger.error('No deploy token found.');
      console.log();
      console.log('  Provide a token via one of:');
      console.log(`    ${colors.bold('--token cc_nova_xxx')}`);
      console.log(`    ${colors.bold('CLOUDCART_NOVA_TOKEN')} env var`);
      console.log(`    ${colors.dim('.cloudcart/project.json')} → novaToken field`);
      console.log();
      console.log('  Get your token from the CloudCart admin panel:');
      console.log('  Nitrogen > Storefronts > [Your Storefront] > Deploy Tokens');
      this.exit(1);
    }

    // Resolve store domain
    const storeDomain = (config.store as string)
      ?? envVars.PUBLIC_STORE_DOMAIN
      ?? process.env.PUBLIC_STORE_DOMAIN;

    if (!storeDomain) {
      logger.error('No store domain found. Run `cloudcart nitrogen link` first.');
      this.exit(1);
    }

    const environment = flags.preview ? 'preview' : 'production';

    logger.info(`Deploying to ${colors.bold(storeDomain)} (${environment})...`);
    console.log();

    // ── Step 1: Build ──
    if (!flags['no-build']) {
      printStep(1, 'Building for production...');
      printGradientBar();
      await exec('npx', ['react-router', 'build'], root, { ...envVars, NODE_ENV: 'production' });
      console.log();
    }

    // ── Step 2: Collect build output ──
    printStep(flags['no-build'] ? 1 : 2, 'Preparing build output...');

    const serverBuildPath = resolve(root, 'build/server/index.js');
    if (!existsSync(serverBuildPath)) {
      logger.error(`Build output not found at ${serverBuildPath}. Run build first.`);
      this.exit(1);
    }

    const clientDir = resolve(root, 'build/client');
    if (!existsSync(clientDir)) {
      logger.error(`Client assets not found at ${clientDir}. Run build first.`);
      this.exit(1);
    }

    const assets = collectAssets(clientDir);
    const manifest: Record<string, { hash: string; size: number }> = {};
    for (const a of assets) manifest[a.path] = { hash: a.hash, size: a.size };

    const apiBase = `https://${storeDomain}/admin/api/core/nitrogen/nova`;

    try {
      // ── Step 3: Open an upload session (cc-builder ↔ Cloudflare) ──
      // cc-builder creates the assets-upload-session and returns only the files
      // Cloudflare doesn't already have (hash dedup). The CF token stays server-side.
      printStep(flags['no-build'] ? 2 : 3, 'Uploading static assets...');
      printGradientBar();

      const sessionResponse = await fetch(`${apiBase}/deploy/assets-session`, {
        method: 'POST',
        headers: {
          'X-Nova-Deploy-Token': deployToken,
          'User-Agent': 'CloudCart-Nova-Deploy/1.0',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ manifest, environment }),
      });

      const sessionResult = await sessionResponse.json() as {
        data?: { account_id?: string; upload_jwt?: string; buckets?: string[][] };
        message?: string;
        error?: string;
      };

      if (!sessionResponse.ok || !sessionResult.data?.upload_jwt) {
        logger.error(`Upload session failed: ${sessionResult.message ?? sessionResult.error ?? sessionResponse.statusText}`);
        this.exit(1);
      }

      const { account_id: accountId, upload_jwt: uploadJwt, buckets = [] } = sessionResult.data;
      const missingCount = buckets.reduce((n, b) => n + b.length, 0);
      logger.info(`${missingCount} of ${assets.length} asset(s) need uploading (rest deduplicated)`);

      // Upload the missing files DIRECTLY to Cloudflare (bytes never pass through
      // cc-builder, so this scales to any build size), one bucket per request,
      // using the short-lived upload JWT. The final response returns the
      // completion JWT we attach to the worker at deploy time.
      const byHash = new Map(assets.map((a) => [a.hash, a]));
      let assetsJwt = uploadJwt;
      for (const bucket of buckets) {
        const cfForm = new FormData();
        for (const hash of bucket) {
          const a = byHash.get(hash);
          if (!a) continue;
          const b64 = readFileSync(a.absPath).toString('base64');
          cfForm.append(hash, new Blob([b64], { type: a.contentType }), hash);
        }
        const uploadResponse = await fetch(
          `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/assets/upload?base64=true`,
          { method: 'POST', headers: { Authorization: `Bearer ${uploadJwt}` }, body: cfForm },
        );
        const uploadResult = await uploadResponse.json() as {
          result?: { jwt?: string };
          errors?: { message?: string }[];
        };
        if (!uploadResponse.ok) {
          logger.error(`Asset upload failed: ${uploadResult.errors?.[0]?.message ?? uploadResponse.statusText}`);
          this.exit(1);
        }
        if (uploadResult.result?.jwt) {
          assetsJwt = uploadResult.result.jwt;
        }
      }

      // ── Step 4: Deploy worker (assets already uploaded to Cloudflare) ──
      printStep(flags['no-build'] ? 3 : 4, 'Deploying to Nova...');

      const formData = new FormData();
      formData.append('worker', new Blob([readFileSync(serverBuildPath)], { type: 'application/javascript+module' }), 'index.js');
      formData.append('environment', environment);
      formData.append('assets_jwt', assetsJwt);

      // Add git metadata if available
      try {
        const { execSync } = await import('node:child_process');
        formData.append('commit_sha', execSync('git rev-parse --short HEAD', { cwd: root, encoding: 'utf-8' }).trim());
        formData.append('commit_message', execSync('git log -1 --pretty=%s', { cwd: root, encoding: 'utf-8' }).trim());
        formData.append('branch', execSync('git branch --show-current', { cwd: root, encoding: 'utf-8' }).trim());
      } catch {
        // Not a git repo, skip metadata
      }

      const response = await fetch(`${apiBase}/deploy`, {
        method: 'POST',
        headers: {
          'X-Nova-Deploy-Token': deployToken,
          'User-Agent': 'CloudCart-Nova-Deploy/1.0',
        },
        body: formData,
      });

      const result = await response.json() as {
        data?: { deployed_url?: string; id?: string; status?: string };
        message?: string;
        error?: string;
      };

      if (!response.ok) {
        logger.error(`Deploy failed: ${result.message ?? result.error ?? response.statusText}`);
        this.exit(1);
      }

      console.log();
      printGradientBar();
      console.log();

      const deployedUrl = result.data?.deployed_url;
      const deploymentId = result.data?.id;

      if (deployedUrl) {
        logger.success(`Deployed: ${colors.bold(deployedUrl)}`);
      } else {
        logger.success('Deployment successful!');
      }

      if (deploymentId) {
        logger.info(`Deployment ID: ${deploymentId}`);
      }

      if (result.data?.status) {
        logger.info(`Status: ${result.data.status}`);
      }
    } catch (error) {
      if (error instanceof Error) {
        logger.error(`Deploy failed: ${error.message}`);
      }
      this.exit(1);
    }

    console.log();
  }
}

/**
 * Recursively collect every file under build/client as an asset entry:
 * served path (leading slash), SHA-256 hash (first 32 hex chars — Cloudflare
 * manifest format), size, and Content-Type derived from the extension.
 */
function collectAssets(clientDir: string): AssetEntry[] {
  const out: AssetEntry[] = [];

  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const abs = resolve(dir, entry.name);
      if (entry.isDirectory()) {
        walk(abs);
        continue;
      }
      const contents = readFileSync(abs);
      out.push({
        path: '/' + relative(clientDir, abs).split(/[\\/]/).join('/'),
        absPath: abs,
        hash: createHash('sha256').update(contents).digest('hex').slice(0, 32),
        size: contents.byteLength,
        contentType: assetContentType(entry.name),
      });
    }
  };

  walk(clientDir);
  return out;
}

function assetContentType(filename: string): string {
  const ext = filename.slice(filename.lastIndexOf('.') + 1).toLowerCase();
  const map: Record<string, string> = {
    js: 'application/javascript',
    mjs: 'application/javascript',
    css: 'text/css',
    html: 'text/html',
    json: 'application/json',
    map: 'application/json',
    svg: 'image/svg+xml',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    webp: 'image/webp',
    gif: 'image/gif',
    ico: 'image/x-icon',
    woff2: 'font/woff2',
    woff: 'font/woff',
    ttf: 'font/ttf',
    otf: 'font/otf',
    txt: 'text/plain',
    xml: 'application/xml',
  };
  return map[ext] ?? 'application/octet-stream';
}
