import { Command, Flags } from '@oclif/core';
import { logger, colors, printBanner, promptInput, getSession, createGraphQLClient, type GraphQLClient } from '@cloudcart/cli-kit';
import { resolveProjectRoot, readProjectConfig, writeProjectConfig } from '../../lib/project.js';

interface NitroStorefrontGql {
  id: string;
  name: string;
  handle: string;
  novaHostname: string | null;
  publicToken: string | null;
  deploymentMethod: string | null;
  repository: string | null;
  defaultBranch: string | null;
  storefrontScopes: string[];
}

interface FindStorefrontResponse {
  nitroStorefrontByName: NitroStorefrontGql | null;
}

interface ListStorefrontsResponse {
  nitroStorefronts: {
    edges: Array<{ node: Pick<NitroStorefrontGql, 'id' | 'name' | 'handle' | 'novaHostname'> }>;
  };
}

const FIND_STOREFRONT_QUERY = `
  query FindStorefront($name: String!) {
    nitroStorefrontByName(name: $name) {
      id
      name
      handle
      novaHostname
      publicToken
      deploymentMethod
      repository
      defaultBranch
      storefrontScopes
    }
  }
`;

const LIST_STOREFRONTS_QUERY = `
  query ListStorefronts {
    nitroStorefronts(first: 50) {
      edges {
        node {
          id
          name
          handle
          novaHostname
        }
      }
    }
  }
`;

export default class NitroLink extends Command {
  static override description = 'Link a Nitro project to a CloudCart store';

  static override examples = [
    '<%= config.bin %> nitro link --storefront "My Store"',
    '<%= config.bin %> nitro link --store mystore.cloudcart.com --storefront "My Store"',
  ];

  static override flags = {
    store: Flags.string({ char: 's', description: 'Store URL (e.g., mystore.cloudcart.com)' }),
    storefront: Flags.string({ description: 'Storefront name to link to' }),
    force: Flags.boolean({ description: 'Overwrite existing link', default: false }),
    path: Flags.string({ description: 'Path to the Nitro storefront root', default: '.' }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(NitroLink);
    const root = resolveProjectRoot(flags.path);

    printBanner();

    const config = readProjectConfig(root);

    if (config.store && config.storefrontId && !flags.force) {
      logger.warn(`Already linked to ${colors.bold(config.storefrontName as string || config.store as string)}.`);
      logger.info('Use --force to overwrite.');
      return;
    }

    // Authenticate
    const storeUrl = flags.store ?? config.store as string ?? undefined;
    const session = await getSession({ storeUrl, autoPrompt: true });
    const gql = createGraphQLClient(session);

    logger.info(`Authenticated with ${colors.bold(session.storeUrl)}`);

    // Find the storefront
    const storefrontName = flags.storefront ?? await this.promptStorefront(gql);

    if (!storefrontName) {
      logger.error('Storefront name is required.');
      this.exit(1);
    }

    logger.info(`Looking for storefront ${colors.bold(storefrontName)}...`);

    const result = await gql.query<FindStorefrontResponse>(FIND_STOREFRONT_QUERY, { name: storefrontName });

    if (!result.data?.nitroStorefrontByName) {
      logger.error(`Storefront "${storefrontName}" not found on ${session.storeUrl}.`);
      logger.info('Available storefronts:');
      const listResult = await gql.query<ListStorefrontsResponse>(LIST_STOREFRONTS_QUERY);
      const storefronts = listResult.data?.nitroStorefronts?.edges ?? [];
      if (storefronts.length === 0) {
        logger.info('  (none — create one in the admin panel first)');
      } else {
        for (const { node } of storefronts) {
          console.log(`  ${colors.dim('•')} ${node.name} ${colors.dim(`(${node.novaHostname || node.handle})`)}`);
        }
      }
      this.exit(1);
    }

    const sf = result.data.nitroStorefrontByName;

    // Save config
    const newConfig = {
      ...config,
      store: session.storeUrl,
      storefrontId: sf.id,
      storefrontName: sf.name,
      handle: sf.handle,
      novaHostname: sf.novaHostname,
      publicToken: sf.publicToken,
      deploymentMethod: sf.deploymentMethod,
      repository: sf.repository,
      defaultBranch: sf.defaultBranch,
      linkedAt: new Date().toISOString(),
    };

    writeProjectConfig(root, newConfig);

    logger.success(`Linked to ${colors.bold(sf.name)}`);
    console.log();
    console.log(`  ${colors.dim('Store:')}         ${session.storeUrl}`);
    console.log(`  ${colors.dim('Storefront:')}    ${sf.name}`);
    if (sf.novaHostname) {
      console.log(`  ${colors.dim('URL:')}           https://${sf.novaHostname}`);
    }
    if (sf.repository) {
      console.log(`  ${colors.dim('Repository:')}    ${sf.repository}`);
    }
    console.log(`  ${colors.dim('Config:')}        .cloudcart/project.json`);
    console.log();
    logger.info('Next: run `cloudcart nitro env pull` to fetch environment variables.');
  }

  private async promptStorefront(gql: GraphQLClient): Promise<string> {
    // List available storefronts for the user to pick
    const listResult = await gql.query<ListStorefrontsResponse>(LIST_STOREFRONTS_QUERY);
    const storefronts = listResult.data?.nitroStorefronts?.edges ?? [];

    if (storefronts.length > 0) {
      console.log();
      logger.info('Available storefronts:');
      for (const { node } of storefronts) {
        console.log(`  ${colors.dim('•')} ${node.name} ${colors.dim(`(${node.novaHostname || node.handle})`)}`);
      }
      console.log();
    }

    return promptInput('Storefront name:');
  }
}
