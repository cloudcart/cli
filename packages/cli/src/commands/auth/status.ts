import { Command, Flags } from '@oclif/core';
import {
  loadConfig,
  isKeychainAvailable,
  logger,
  colors,
  printBanner,
} from '@cloudcart/cli-kit';

export default class AuthStatus extends Command {
  static override description = 'Show current authentication status';

  static override examples = ['<%= config.bin %> auth status'];

  static override flags = {
    store: Flags.string({
      char: 's',
      description: 'Show status for a specific store',
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(AuthStatus);

    printBanner();

    // Show env var status
    if (process.env.CLOUDCART_CLI_TOKEN) {
      const envStore = process.env.CLOUDCART_CLI_STORE;
      console.log(colors.bold('Environment:'));
      console.log(`  CLOUDCART_CLI_TOKEN: ${colors.success('set')}`);
      if (envStore) {
        console.log(`  CLOUDCART_CLI_STORE: ${envStore}`);
      }
      const keychainOk = await isKeychainAvailable();
      console.log(`  Token storage: ${keychainOk ? 'OS Keychain' : 'File (~/.cloudcart/config.json)'}`);
      console.log();
    }

    const config = await loadConfig();

    if (Object.keys(config.stores).length === 0 && !process.env.CLOUDCART_CLI_TOKEN) {
      logger.warn('Not authenticated. Run `cloudcart auth login` to get started.');
      return;
    }

    if (flags.store) {
      const creds = config.stores[flags.store];
      if (!creds) {
        logger.warn(`No credentials found for ${flags.store}`);
        return;
      }
      this.printStoreStatus(flags.store, creds, flags.store === config.currentStore);
      return;
    }

    if (Object.keys(config.stores).length > 0) {
      console.log(colors.bold('Authenticated stores:'));
      console.log();

      for (const [storeUrl, creds] of Object.entries(config.stores)) {
        this.printStoreStatus(storeUrl, creds, storeUrl === config.currentStore);
      }
    }
  }

  private printStoreStatus(
    storeUrl: string,
    creds: { type: string; token?: string; email?: string; scopes?: string[] },
    isCurrent: boolean,
  ): void {
    const marker = isCurrent ? colors.success('● ') : '  ';
    console.log(`${marker}${colors.bold(storeUrl)}${isCurrent ? ' (active)' : ''}`);
    console.log(`    Type: ${creds.type.toUpperCase()}`);
    if (creds.email) {
      console.log(`    Email: ${creds.email}`);
    }
    if (creds.token === '***keychain***') {
      console.log(`    Storage: ${colors.success('OS Keychain')}`);
    }
    if (creds.scopes) {
      console.log(`    Scopes: ${creds.scopes.join(', ')}`);
    }
    console.log();
  }
}
