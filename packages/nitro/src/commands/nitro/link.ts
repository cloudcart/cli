import { Command, Flags } from '@oclif/core';
import { logger, colors, printBanner, promptInput } from '@cloudcart/cli-kit';
import { resolveProjectRoot, readProjectConfig, writeProjectConfig } from '../../lib/project.js';

export default class NitroLink extends Command {
  static override description = 'Link a Nitro project to a CloudCart store';

  static override examples = [
    '<%= config.bin %> nitro link',
    '<%= config.bin %> nitro link --store mystore.cloudcart.com',
  ];

  static override flags = {
    store: Flags.string({ char: 's', description: 'Store URL (e.g., mystore.cloudcart.com)' }),
    force: Flags.boolean({ description: 'Overwrite existing link', default: false }),
    path: Flags.string({ description: 'Path to the Nitro storefront root', default: '.' }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(NitroLink);
    const root = resolveProjectRoot(flags.path);

    printBanner();

    const config = readProjectConfig(root);

    if (config.store && !flags.force) {
      logger.warn(`Already linked to ${colors.bold(config.store as string)}.`);
      logger.info('Use --force to overwrite.');
      return;
    }

    const storeUrl = flags.store ?? await promptInput('Store URL (e.g., mystore.cloudcart.com):');
    const trimmed = storeUrl.trim().replace(/^https?:\/\//, '').replace(/\/$/, '');

    if (!trimmed) {
      logger.error('Store URL is required.');
      this.exit(1);
    }

    // TODO: When Admin API supports it, validate the store and fetch storefront ID
    // const session = await getSession({ storeUrl: trimmed });
    // const storefronts = await fetchStorefronts(session);

    const newConfig = {
      ...config,
      store: trimmed,
      storefrontId: `sf_${Date.now().toString(36)}`,
      linkedAt: new Date().toISOString(),
    };

    writeProjectConfig(root, newConfig);

    logger.success(`Linked to ${colors.bold(trimmed)}`);
    console.log(`  Config saved to ${colors.dim('.cloudcart/project.json')}`);
    console.log();
    logger.info('Next: run `cloudcart nitro env pull` to fetch environment variables.');
  }
}
