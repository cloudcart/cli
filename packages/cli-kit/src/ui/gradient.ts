import chalk from 'chalk';

/**
 * CloudCart gradient colors — a vibrant rainbow bar for terminal output.
 * Inspired by Shopify Hydrogen's colorful CLI experience.
 */
const GRADIENT_COLORS = [
  '#FF6B6B', // red
  '#FF8E53', // orange
  '#FFC53D', // yellow
  '#52C41A', // green
  '#13C2C2', // teal
  '#1890FF', // blue
  '#6366F1', // indigo (brand)
  '#9254DE', // purple
  '#EB2F96', // pink
  '#FF6B6B', // red (loop)
  '#FF8E53', // orange
  '#FFC53D', // yellow
  '#52C41A', // green
  '#13C2C2', // teal
  '#1890FF', // blue
  '#6366F1', // indigo
];

/**
 * Prints a rainbow gradient bar across the terminal width.
 */
export function printGradientBar(): void {
  const width = Math.min(process.stdout.columns || 80, 120);
  const chars = '█'.repeat(width);
  let bar = '';

  for (let i = 0; i < width; i++) {
    const colorIndex = (i / width) * (GRADIENT_COLORS.length - 1);
    const lower = Math.floor(colorIndex);
    const upper = Math.min(lower + 1, GRADIENT_COLORS.length - 1);
    const t = colorIndex - lower;
    const color = interpolateColor(GRADIENT_COLORS[lower], GRADIENT_COLORS[upper], t);
    bar += chalk.hex(color)('█');
  }

  console.log(bar);
}

/**
 * Prints a styled info box with a border.
 */
export function printInfoBox(title: string, lines: string[]): void {
  const width = Math.min(process.stdout.columns || 80, 80);
  const innerWidth = width - 4;
  const border = chalk.dim('─'.repeat(innerWidth));

  console.log(`  ${chalk.cyan(title)} ${border.slice(title.length + 1)}`);
  console.log(chalk.dim('  │'));
  for (const line of lines) {
    console.log(chalk.dim('  │') + `  ${line}`);
  }
  console.log(chalk.dim('  │'));
  console.log(`  ${chalk.dim('─'.repeat(innerWidth + 2))}`);
}

/**
 * Prints a step with a colored number badge.
 */
export function printStep(step: number, text: string): void {
  const badge = chalk.bgHex('#6366F1').white.bold(` ${step} `);
  console.log(`${badge} ${text}`);
}

function interpolateColor(hex1: string, hex2: string, t: number): string {
  const r1 = parseInt(hex1.slice(1, 3), 16);
  const g1 = parseInt(hex1.slice(3, 5), 16);
  const b1 = parseInt(hex1.slice(5, 7), 16);
  const r2 = parseInt(hex2.slice(1, 3), 16);
  const g2 = parseInt(hex2.slice(3, 5), 16);
  const b2 = parseInt(hex2.slice(5, 7), 16);
  const r = Math.round(r1 + (r2 - r1) * t);
  const g = Math.round(g1 + (g2 - g1) * t);
  const b = Math.round(b1 + (b2 - b1) * t);
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}
