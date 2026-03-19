import { Command, Flags } from '@oclif/core';
import { logger, colors, printBanner } from '@cloudcart/cli-kit';
import { resolveProjectRoot, readProjectConfig } from '../../../lib/project.js';

export default class NitroEnvList extends Command {
  static override description = 'List environments on a linked CloudCart store';

  static override examples = [
    '<%= config.bin %> nitro env list',
  ];

  static override flags = {
    path: Flags.string({ description: 'Path to the Nitro storefront root', default: '.' }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(NitroEnvList);
    const root = resolveProjectRoot(flags.path);

    printBanner();

    const config = readProjectConfig(root);
    if (!config.store) {
      logger.error('No store linked. Run `cloudcart nitro link` first.');
      this.exit(1);
    }

    const storeName = config.store as string;
    logger.info(`Environments for ${colors.bold(storeName)}:\n`);

    // TODO: When Admin API supports it, fetch real environments here.
    const environments = [
      { name: 'production', branch: 'main', status: 'active' },
      { name: 'staging', branch: 'staging', status: 'active' },
      { name: 'preview', branch: '*', status: 'active' },
    ];

    for (const env of environments) {
      console.log(`  ${env.name.padEnd(15)} branch: ${env.branch.padEnd(12)} ${colors.dim(env.status)}`);
    }
    console.log();
  }
}
