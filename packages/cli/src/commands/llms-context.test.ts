import { fileURLToPath } from 'node:url';
import { Config } from '@oclif/core';
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import LlmsContext from './llms-context.js';

// The CLI as installed: its own commands and its plugins' (read from the packages' builds).
let config: Config;
beforeAll(async () => {
  config = await Config.load({ root: fileURLToPath(new URL('../..', import.meta.url)) });
});

describe('LlmsContext command', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('has the correct description', () => {
    expect(LlmsContext.description).toContain('AI assistants');
  });

  it('outputs markdown content', async () => {
    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((msg: string) => { logs.push(msg); });

    const cmd = new LlmsContext([], config);
    await cmd.run();

    const output = logs.join('\n');
    expect(output).toContain('# CloudCart CLI');
    expect(output).toContain('## Authentication');
    expect(output).toContain('## Core Workflow');
    expect(output).toContain('## Commands');
  });

  it('documents auth env vars', async () => {
    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((msg: string) => { logs.push(msg); });

    const cmd = new LlmsContext([], config);
    await cmd.run();

    const output = logs.join('\n');
    expect(output).toContain('CLOUDCART_CLI_TOKEN');
    expect(output).toContain('CLOUDCART_CLI_STORE');
  });

  it('tells assistants to execute without validating first, and what a failed mutation means (B-549, B-550)', async () => {
    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((msg: string) => { logs.push(msg); });

    await new LlmsContext([], config).run();

    const output = logs.join('\n');
    expect(output).not.toMatch(/Validate before|Validate your query/);
    expect(output).toContain('refuses an invalid one without running any of it');
    expect(output).toContain('--refresh');
    expect(output).toContain('--timeout');
    expect(output).toMatch(/timeout and server_unavailable[^.]*never for a mutation/);
    expect(output).toContain('retryAfterSeconds');
  });

  it('documents the discover-validate-execute workflow', async () => {
    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((msg: string) => { logs.push(msg); });

    const cmd = new LlmsContext([], config);
    await cmd.run();

    const output = logs.join('\n');
    expect(output).toContain('app schema');
    expect(output).toContain('app validate');
    expect(output).toContain('app execute');
  });

  it('documents error handling', async () => {
    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((msg: string) => { logs.push(msg); });

    const cmd = new LlmsContext([], config);
    await cmd.run();

    const output = logs.join('\n');
    expect(output).toContain('exit_code' .toLowerCase().includes('exit') ? 'Exit codes' : 'exit');
    expect(output).toContain('retryable');
  });

  it('documents GraphQL API patterns', async () => {
    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((msg: string) => { logs.push(msg); });

    const cmd = new LlmsContext([], config);
    await cmd.run();

    const output = logs.join('\n');
    expect(output).toContain('YesNo');
    expect(output).toContain('pagination');
  });

  it('documents the Nitrogen workflow and the deployment token (B-487)', async () => {
    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((msg: string) => { logs.push(msg); });

    await new LlmsContext([], config).run();

    const output = logs.join('\n');
    for (const command of ['nitrogen init', 'nitrogen link', 'nitrogen env pull', 'nitrogen dev', 'nitrogen build', 'nitrogen deploy']) {
      expect(output).toContain(`cloudcart ${command}`);
    }
    expect(output).toContain('CLOUDCART_NOVA_TOKEN');
    expect(output).toContain('Deployment tokens');
    expect(output).not.toContain('5=conflict');
  });

  it('lists every command the CLI has (B-487)', async () => {
    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((msg: string) => { logs.push(msg); });

    await new LlmsContext([], config).run();

    const listed = logs.join('\n').split('## All commands')[1];
    for (const command of config.commands.filter((c) => !c.hidden)) {
      expect(listed).toContain(`\`cloudcart ${command.id.replaceAll(':', ' ')}\``);
    }
  });
});
