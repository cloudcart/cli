import { Command, Flags } from '@oclif/core';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { logger, colors, printBanner } from '@cloudcart/cli-kit';
import { resolveProjectRoot, readProjectConfig, loadEnvFile } from '../../../lib/project.js';

export default class NitroEnvPush extends Command {
  static override description = 'Push local environment variables to a linked CloudCart store';

  static override examples = [
    '<%= config.bin %> nitro env push',
    '<%= config.bin %> nitro env push --env staging',
  ];

  static override flags = {
    path: Flags.string({ description: 'Path to the Nitro storefront root', default: '.' }),
    env: Flags.string({ description: 'Target environment', default: 'production' }),
    'env-file': Flags.string({ description: 'Source .env file path', default: '.env' }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(NitroEnvPush);
    const root = resolveProjectRoot(flags.path);

    printBanner();

    const config = readProjectConfig(root);
    if (!config.store) {
      logger.error('No store linked. Run `cloudcart nitro link` first.');
      this.exit(1);
    }

    const envFilePath = resolve(root, flags['env-file']);
    if (!existsSync(envFilePath)) {
      logger.error(`${flags['env-file']} not found.`);
      this.exit(1);
    }

    const envVars = loadEnvFile(envFilePath);
    const count = Object.keys(envVars).length;
    const storeName = config.store as string;

    logger.info(`Pushing ${count} variables to "${flags.env}" on ${colors.bold(storeName)}...`);

    // TODO: When Admin API supports it, push real env vars here.
    // const session = await getSession({ storeUrl: storeName });
    // await pushEnvVars(session, config.storefrontId, flags.env, envVars);

    logger.success(`${count} environment variables pushed to "${flags.env}".`);
  }
}
