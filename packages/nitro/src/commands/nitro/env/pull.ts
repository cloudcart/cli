import { Command, Flags } from '@oclif/core';
import { resolve } from 'node:path';
import { existsSync, writeFileSync } from 'node:fs';
import { logger, colors, printBanner } from '@cloudcart/cli-kit';
import { resolveProjectRoot, readProjectConfig } from '../../../lib/project.js';

export default class NitroEnvPull extends Command {
  static override description = 'Pull environment variables from a linked CloudCart store';

  static override examples = [
    '<%= config.bin %> nitro env pull',
    '<%= config.bin %> nitro env pull --env staging',
  ];

  static override flags = {
    path: Flags.string({ description: 'Path to the Nitro storefront root', default: '.' }),
    env: Flags.string({ description: 'Environment to pull from', default: 'production' }),
    'env-file': Flags.string({ description: 'Output .env file path', default: '.env' }),
    force: Flags.boolean({ description: 'Overwrite existing .env file', default: false }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(NitroEnvPull);
    const root = resolveProjectRoot(flags.path);

    printBanner();

    const config = readProjectConfig(root);
    if (!config.store) {
      logger.error('No store linked. Run `cloudcart nitro link` first.');
      this.exit(1);
    }

    const envFilePath = resolve(root, flags['env-file']);
    if (existsSync(envFilePath) && !flags.force) {
      logger.warn(`${flags['env-file']} already exists. Use --force to overwrite.`);
      return;
    }

    const storeName = config.store as string;
    logger.info(`Pulling "${flags.env}" environment from ${colors.bold(storeName)}...`);

    // TODO: When Admin API supports it, fetch real env vars here.
    // const session = await getSession({ storeUrl: storeName });
    // const vars = await fetchEnvVars(session, config.storefrontId, flags.env);

    const envContent = [
      `# Environment: ${flags.env}`,
      `# Store: ${storeName}`,
      `# Pulled at: ${new Date().toISOString()}`,
      '',
      'SESSION_SECRET="change-me-to-a-real-secret"',
      `PUBLIC_STORE_DOMAIN="${storeName}"`,
      'PUBLIC_STOREFRONT_API_TOKEN=""',
      'PRIVATE_STOREFRONT_API_TOKEN=""',
      '',
    ].join('\n');

    writeFileSync(envFilePath, envContent);
    logger.success(`Environment variables written to ${flags['env-file']}`);
  }
}
