import { Command, Flags } from '@oclif/core';
import {
  loginWithPAT,
  loginWithBrowser,
  formatStoreUrl,
  promptInput,
  promptSecret,
  promptSelect,
  logger,
  colors,
  printBanner,
  withSpinner,
} from '@cloudcart/cli-kit';

export default class AuthLogin extends Command {
  static override description = 'Authenticate with a CloudCart store';

  static override examples = [
    '<%= config.bin %> auth login',
    '<%= config.bin %> auth login --store mystore.cloudcart.com',
  ];

  static override flags = {
    store: Flags.string({
      char: 's',
      description: 'Store URL (e.g., mystore.cloudcart.com)',
    }),
    token: Flags.string({
      char: 't',
      description: 'Personal Access Token',
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(AuthLogin);

    printBanner();

    // Step 1: Store URL
    let storeUrl =
      flags.store ?? (await promptInput('Store URL (e.g., mystore.cloudcart.com):'));
    storeUrl = formatStoreUrl(storeUrl.trim());

    if (!storeUrl) {
      logger.error('Store URL is required.');
      this.exit(1);
    }

    console.log();

    // Step 2: Auth method
    const method = await promptSelect('How would you like to authenticate?', [
      'Browser login (recommended)',
      'Personal Access Token (for CI/CD and scripts)',
    ]);

    console.log();

    if (method.startsWith('Personal')) {
      const token =
        flags.token ??
        (await promptSecret('Paste your Personal Access Token (cc_pat_...):'));
      await this.patLogin(storeUrl, token);
    } else {
      await this.browserLogin(storeUrl);
    }
  }

  private async patLogin(storeUrl: string, token: string): Promise<void> {
    try {
      const credentials = await withSpinner(
        `Verifying token with ${storeUrl}...`,
        () => loginWithPAT({ token, storeUrl }),
      );
      this.printSuccess(storeUrl, credentials);
    } catch (error) {
      console.log();
      if (error instanceof Error) {
        logger.error(error.message);
      }
      this.exit(1);
    }
  }

  private async browserLogin(storeUrl: string): Promise<void> {
    try {
      logger.info(`Opening browser to log in to ${colors.bold(storeUrl)}...`);
      logger.info(colors.dim('Waiting for authentication (times out in 3 minutes)...'));
      console.log();

      const credentials = await loginWithBrowser({ storeUrl });

      this.printSuccess(storeUrl, credentials);
    } catch (error) {
      console.log();
      if (error instanceof Error) {
        logger.error(error.message);
      }
      this.exit(1);
    }
  }

  private printSuccess(
    storeUrl: string,
    credentials: { type: string; email?: string; scopes?: string[] },
  ): void {
    console.log();
    logger.success('Authenticated successfully!');
    console.log(`  Store: ${colors.bold(storeUrl)}`);
    if (credentials.email) {
      console.log(`  Email: ${credentials.email}`);
    }
    console.log(`  Auth:  ${credentials.type.toUpperCase()}`);
    if (credentials.scopes) {
      console.log(`  Scopes: ${credentials.scopes.join(', ')}`);
    }
    console.log(`  Token stored in ${colors.dim('~/.cloudcart/config.json')}`);
  }
}
