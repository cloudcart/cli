import { Command, Flags, Args } from '@oclif/core';
import { resolve } from 'node:path';
import { logger, printBanner } from '@cloudcart/cli-kit';
import { resolveProjectRoot, validateProject } from '../../../lib/project.js';
import { copyRoute, missingImports, starterRoutes } from '../../../lib/routes.js';
import { STARTER_REPOSITORY, withStarter, type StarterSource } from '../../../lib/starter.js';

export default class NitrogenGenerateRoute extends Command {
  static override description = "Copy one of the CloudCart starter's routes into the project";

  static override examples = [
    '<%= config.bin %> nitrogen generate route product.$handle',
    '<%= config.bin %> nitrogen generate route cart --force',
  ];

  static override args = {
    name: Args.string({
      description: "The route's file name in the starter's app/routes, without the extension (e.g. product.$handle, category.$handle, cart)",
      required: true,
    }),
  };

  static override flags = {
    force: Flags.boolean({ description: 'Overwrite the route if the project has it', default: false }),
    path: Flags.string({ description: 'Path to the Nitrogen storefront root', default: '.' }),
    template: Flags.string({
      description: `A local git repository to take the route from, instead of the published starter (${STARTER_REPOSITORY}); its last commit is used`,
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(NitrogenGenerateRoute);
    const root = resolveProjectRoot(flags.path);
    validateProject(root);

    printBanner();

    const source: StarterSource = flags.template ? { kind: 'local', directory: resolve(flags.template) } : { kind: 'published' };

    let outcome: { file: string; result: 'written' | 'kept' } | { unknown: string[] };
    try {
      outcome = await withStarter(source, (starter) => {
        const routes = starterRoutes(starter);
        const file = routes.get(args.name);
        return file ? { file, result: copyRoute(starter, root, file, flags.force) } : { unknown: [...routes.keys()] };
      });
    } catch (error) {
      logger.error((error as Error).message);
      this.exit(1);
    }

    if ('unknown' in outcome) {
      logger.error(`The starter has no route "${args.name}". Its routes: ${outcome.unknown.join(', ')}`);
      this.exit(1);
    }

    if (outcome.result === 'kept') {
      logger.warn(`app/routes/${outcome.file} is already in the project: kept. Run again with --force to overwrite it.`);
      return;
    }

    logger.success(`Copied the starter's app/routes/${outcome.file}`);
    const missing = missingImports(root, outcome.file);
    if (missing.length) {
      logger.warn(`It imports modules this project does not have: ${missing.join(', ')}. Copy them from the starter too.`);
    }
  }
}
