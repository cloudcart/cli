import chalk from 'chalk';
import { printGradientBar } from './gradient.js';

/**
 * Prints the CloudCart CLI banner with gradient.
 */
export function printBanner(): void {
  console.log();
  printGradientBar();
  console.log();
  console.log(
    chalk.hex('#6366F1').bold('  ☁  CloudCart') +
    chalk.dim(' — Developer CLI')
  );
  console.log();
}

/**
 * Prints a Nitrogen-specific banner for storefront commands.
 */
export function printNitrogenBanner(): void {
  console.log();
  printGradientBar();
  console.log();
  console.log(
    chalk.hex('#6366F1').bold('  ☁  CloudCart') +
    chalk.white.bold(' Nitrogen') +
    chalk.dim(' — Headless Commerce Framework')
  );
  console.log();
}
