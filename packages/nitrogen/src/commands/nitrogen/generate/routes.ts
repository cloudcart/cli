import { Command, Flags } from '@oclif/core';
import { resolve } from 'node:path';
import { logger, colors, printBanner } from '@cloudcart/cli-kit';
import { resolveProjectRoot, validateProject } from '../../../lib/project.js';
import { copyRoute, missingImports, starterRoutes } from '../../../lib/routes.js';
import { STARTER_REPOSITORY, withStarter, type StarterSource } from '../../../lib/starter.js';

export default class NitrogenGenerateRoutes extends Command {
  static override description = "Copy the CloudCart starter's routes the project does not have";

  static override examples = [
    '<%= config.bin %> nitrogen generate routes',
    '<%= config.bin %> nitrogen generate routes --force',
  ];

  static override flags = {
    force: Flags.boolean({ description: 'Overwrite the routes the project has too', default: false }),
    path: Flags.string({ description: 'Path to the Nitrogen storefront root', default: '.' }),
    template: Flags.string({
      description: `A local git repository to take the routes from, instead of the published starter (${STARTER_REPOSITORY}); its last commit is used`,
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(NitrogenGenerateRoutes);
    const root = resolveProjectRoot(flags.path);
    validateProject(root);

    printBanner();

    const source: StarterSource = flags.template ? { kind: 'local', directory: resolve(flags.template) } : { kind: 'published' };

    let written: string[] = [];
    let kept: string[] = [];
    try {
      [written, kept] = await withStarter(source, (starter) => {
        const result: [string[], string[]] = [[], []];
        for (const file of starterRoutes(starter).values()) {
          result[copyRoute(starter, root, file, flags.force) === 'written' ? 0 : 1].push(file);
        }
        return result;
      });
    } catch (error) {
      logger.error((error as Error).message);
      this.exit(1);
    }

    for (const file of written) console.log(`  ${colors.success('+')} app/routes/${file}`);
    if (written.length) console.log();

    logger.success(
      `${written.length} of the starter's routes written, ${kept.length} kept` +
        (kept.length ? ' (already in the project; --force overwrites them)' : ''),
    );

    const missing = [...new Set(written.flatMap((file) => missingImports(root, file)))].sort();
    if (missing.length) {
      logger.warn(`They import modules this project does not have: ${missing.join(', ')}. Copy them from the starter too.`);
    }
  }
}
