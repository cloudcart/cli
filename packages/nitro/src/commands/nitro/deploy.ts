import { Command, Flags } from '@oclif/core';
import { resolve } from 'node:path';
import { readFileSync, existsSync } from 'node:fs';
import { logger, colors, printNitroBanner, printGradientBar, printStep } from '@cloudcart/cli-kit';
import { resolveProjectRoot, validateProject, readProjectConfig, loadEnvFile, exec } from '../../lib/project.js';

export default class NitroDeploy extends Command {
  static override description = 'Deploy a Nitro storefront to Nova (CloudCart Edge Hosting)';

  static override examples = [
    '<%= config.bin %> nitro deploy',
    '<%= config.bin %> nitro deploy --preview',
    '<%= config.bin %> nitro deploy --token cc_nova_xxx',
  ];

  static override flags = {
    path: Flags.string({ description: 'Path to the Nitro storefront root', default: '.' }),
    'env-file': Flags.string({ description: 'Path to .env file', default: '.env' }),
    token: Flags.string({ char: 't', description: 'Nova deploy token (or set CLOUDCART_NOVA_TOKEN env var)' }),
    preview: Flags.boolean({ description: 'Deploy as preview (not production)', default: false }),
    'no-build': Flags.boolean({ description: 'Skip the build step', default: false }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(NitroDeploy);
    const root = resolveProjectRoot(flags.path);
    validateProject(root);

    printNitroBanner();

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
      console.log('  Nitro > Storefronts > [Your Storefront] > Deploy Tokens');
      this.exit(1);
    }

    // Resolve store domain
    const storeDomain = (config.store as string)
      ?? envVars.PUBLIC_STORE_DOMAIN
      ?? process.env.PUBLIC_STORE_DOMAIN;

    if (!storeDomain) {
      logger.error('No store domain found. Run `cloudcart nitro link` first.');
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

    // ── Step 2: Bundle as Worker ──
    printStep(flags['no-build'] ? 1 : 2, 'Bundling as Cloudflare Worker...');

    const serverBuildPath = resolve(root, 'build/server/index.js');
    if (!existsSync(serverBuildPath)) {
      logger.error(`Build output not found at ${serverBuildPath}. Run build first.`);
      this.exit(1);
    }

    const serverBundle = readFileSync(serverBuildPath, 'utf-8');

    // Create the Worker entry that wraps the React Router server build
    const workerScript = createWorkerScript(serverBundle);

    // ── Step 3: Deploy to Nova ──
    printStep(flags['no-build'] ? 2 : 3, 'Deploying to Nova...');
    printGradientBar();

    const deployUrl = `https://${storeDomain}/admin/api/core/nitro/nova/deploy`;

    try {
      const formData = new FormData();
      formData.append('worker', new Blob([workerScript], { type: 'application/javascript' }), 'worker.js');
      formData.append('environment', environment);

      // Add git metadata if available
      try {
        const { execSync } = await import('node:child_process');
        const commitSha = execSync('git rev-parse --short HEAD', { cwd: root, encoding: 'utf-8' }).trim();
        const commitMsg = execSync('git log -1 --pretty=%s', { cwd: root, encoding: 'utf-8' }).trim();
        const branch = execSync('git branch --show-current', { cwd: root, encoding: 'utf-8' }).trim();
        formData.append('commit_sha', commitSha);
        formData.append('commit_message', commitMsg);
        formData.append('branch', branch);
      } catch {
        // Not a git repo, skip metadata
      }

      const response = await fetch(deployUrl, {
        method: 'POST',
        headers: {
          'X-Nova-Deploy-Token': deployToken,
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
 * Creates a Cloudflare Worker script that wraps the Nitro/React Router server build.
 *
 * The worker handles incoming requests by delegating to React Router's
 * request handler with environment variables from the Worker bindings.
 */
function createWorkerScript(serverBundle: string): string {
  return `
// ── Nitro Worker for Nova (CloudCart Edge Hosting) ──
// Auto-generated by cloudcart nitro deploy

${serverBundle}

// If the server build exports a default fetch handler, use it directly.
// Otherwise, wrap it with createRequestHandler from react-router.
if (typeof module !== 'undefined' && module.exports && typeof module.exports.fetch === 'function') {
  addEventListener('fetch', event => {
    event.respondWith(module.exports.fetch(event.request));
  });
}
`;
}
