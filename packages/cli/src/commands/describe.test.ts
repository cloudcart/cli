import { fileURLToPath } from 'node:url';
import { Config } from '@oclif/core';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import Describe, { COMMAND_NOTES, describeCommand } from './describe.js';

// The CLI as installed: its own commands and its plugins' (read from the packages' builds).
let config: Config;
beforeAll(async () => {
  config = await Config.load({ root: fileURLToPath(new URL('../..', import.meta.url)) });
});

/** The parts of `describe`'s answer the tests read. */
interface Described {
  name: string;
  version: string;
  commands: Record<string, { flags?: Record<string, unknown>; args?: Record<string, unknown>; token?: string }>;
  auth: { env_vars: Record<string, string> };
  exit_codes: Record<string, string>;
  ai_usage: { recommended_flags: string[]; schema_discovery: string; nitrogen_workflow: string[] };
}

async function described(): Promise<Described> {
  const logs: string[] = [];
  vi.spyOn(console, 'log').mockImplementation((msg: string) => void logs.push(msg));
  await new Describe([], config).run();
  vi.restoreAllMocks();
  expect(logs).toHaveLength(1);
  return JSON.parse(logs[0]);
}

describe('Describe command', () => {
  it('has the correct description', () => {
    expect(Describe.description).toContain('machine-readable JSON');
  });

  it('names the CLI and its version', async () => {
    const parsed = await described();
    expect(parsed.name).toBe('cloudcart');
    expect(parsed.version).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('lists every command the CLI has, the plugins included (B-487)', async () => {
    const parsed = await described();
    const loaded = config.commands.filter((command) => !command.hidden).map((command) => command.id.replaceAll(':', ' '));
    expect(Object.keys(parsed.commands).sort()).toEqual(loaded.sort());
    for (const id of ['auth login', 'app execute', 'app validate', 'nitrogen init', 'nitrogen link', 'nitrogen env pull', 'nitrogen dev', 'nitrogen build', 'nitrogen deploy', 'nitrogen generate route']) {
      expect(parsed.commands).toHaveProperty([id]);
    }
    expect(parsed.commands['nitrogen deploy'].flags).toHaveProperty(['--token, -t']);
    expect(parsed.commands['nitrogen deploy'].token).toContain('Deployment tokens');
    expect(parsed.commands['nitrogen init'].args).toHaveProperty('name');
  });

  it('has notes only for commands the CLI has', () => {
    const loaded = new Set(config.commands.map((command) => command.id.replaceAll(':', ' ')));
    expect(Object.keys(COMMAND_NOTES).filter((id) => !loaded.has(id))).toEqual([]);
  });

  it("describes a command from its metadata: flags, arguments, rendered examples", () => {
    const command = {
      id: 'shop:open',
      description: 'Open a shop',
      aliases: [],
      hidden: false,
      hiddenAliases: [],
      args: { name: { name: 'name', description: 'The shop', required: true } },
      flags: {
        port: { name: 'port', type: 'option', char: 'p', description: 'Port', default: 3000 },
        force: { name: 'force', type: 'boolean', description: 'Overwrite', default: false },
        secret: { name: 'secret', type: 'boolean', description: 'Hidden', hidden: true },
      },
      examples: ['<%= config.bin %> <%= command.id %> main', { command: '<%= config.bin %> shop open x -p 1', description: 'x' }],
    };
    expect(describeCommand(command as never, 'cloudcart')).toEqual({
      description: 'Open a shop',
      args: { name: { description: 'The shop', required: true } },
      flags: {
        '--port, -p': { type: 'value', description: 'Port', default: 3000 },
        '--force': { type: 'boolean', description: 'Overwrite' },
      },
      examples: ['cloudcart shop open main', 'cloudcart shop open x -p 1'],
    });
  });

  it('includes auth info, the deploy token among it', async () => {
    const parsed = await described();
    expect(parsed.auth.env_vars).toHaveProperty('CLOUDCART_CLI_TOKEN');
    expect(parsed.auth.env_vars).toHaveProperty('CLOUDCART_CLI_STORE');
    expect(parsed.auth.env_vars).toHaveProperty('CLOUDCART_NOVA_TOKEN');
  });

  it('includes the exit codes the commands return', async () => {
    const parsed = await described();
    expect(parsed.exit_codes[0]).toBe('success');
    expect(parsed.exit_codes[4]).toContain('authentication/permission denied');
    expect(parsed.exit_codes).not.toHaveProperty('5');
  });

  it('includes ai_usage section', async () => {
    const parsed = await described();
    expect(parsed.ai_usage.recommended_flags).toContain('--json');
    expect(parsed.ai_usage.schema_discovery).toContain('--search');
    expect(parsed.ai_usage.nitrogen_workflow.at(-1)).toBe('cloudcart nitrogen deploy');
  });
});
