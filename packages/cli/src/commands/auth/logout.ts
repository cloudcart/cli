import { Command, Flags } from '@oclif/core';
import {
  getCurrentStore,
  removeStoreCredentials,
  logger,
  promptConfirm,
} from '@cloudcart/cli-kit';

export default class AuthLogout extends Command {
  static override description = 'Clear stored credentials for a CloudCart store';

  static override examples = ['<%= config.bin %> auth logout'];

  static override flags = {
    store: Flags.string({
      char: 's',
      description: 'Store URL to log out from',
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(AuthLogout);

    const storeUrl = flags.store ?? (await getCurrentStore());

    if (!storeUrl) {
      logger.warn('No store is currently authenticated.');
      return;
    }

    const confirmed = await promptConfirm(`Log out from ${storeUrl}?`);
    if (!confirmed) return;

    await removeStoreCredentials(storeUrl);
    logger.success(`Logged out from ${storeUrl}`);
  }
}
