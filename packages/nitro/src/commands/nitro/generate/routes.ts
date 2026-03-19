import { Command, Flags } from '@oclif/core';
import { existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { logger, printBanner } from '@cloudcart/cli-kit';
import { resolveProjectRoot } from '../../../lib/project.js';
import NitroGenerateRoute from './route.js';

const ALL_ROUTES = [
  'products.$handle',
  'products._index',
  'collections.$handle',
  'collections._index',
  'cart',
  'search',
  'pages.$handle',
  '[robots.txt]',
  '[sitemap.xml]',
];

export default class NitroGenerateRoutes extends Command {
  static override description = 'Generate all standard Nitro commerce routes';

  static override examples = [
    '<%= config.bin %> nitro generate routes',
    '<%= config.bin %> nitro generate routes --force',
  ];

  static override flags = {
    force: Flags.boolean({ description: 'Overwrite existing routes', default: false }),
    path: Flags.string({ description: 'Path to the Nitro storefront root', default: '.' }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(NitroGenerateRoutes);
    const root = resolveProjectRoot(flags.path);

    printBanner();
    logger.info('Generating all standard routes...\n');

    const routesDir = resolve(root, 'app/routes');
    if (!existsSync(routesDir)) mkdirSync(routesDir, { recursive: true });

    for (const routeName of ALL_ROUTES) {
      await NitroGenerateRoute.run([routeName, '--path', root, ...(flags.force ? ['--force'] : [])]);
    }

    console.log();
    logger.success('All standard routes generated.');
  }
}
