import { colors } from '../ui/colors.js';
import { CLIError } from './types.js';

export function handleError(error: unknown): never {
  if (error instanceof CLIError) {
    console.error(colors.error(`Error: ${error.message}`));
    if (error.suggestion) {
      console.error(colors.dim(`  ${error.suggestion}`));
    }
    process.exit(1);
  }

  if (error instanceof Error) {
    console.error(colors.error(`Error: ${error.message}`));
    if (process.env.DEBUG) {
      console.error(colors.dim(error.stack ?? ''));
    }
    process.exit(1);
  }

  console.error(colors.error('An unexpected error occurred.'));
  process.exit(1);
}
