import { describe, it, expect, vi, beforeEach } from 'vitest';
import LlmsContext from './llms-context.js';

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

    const cmd = new LlmsContext([], {} as never);
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

    const cmd = new LlmsContext([], {} as never);
    await cmd.run();

    const output = logs.join('\n');
    expect(output).toContain('CLOUDCART_CLI_TOKEN');
    expect(output).toContain('CLOUDCART_CLI_STORE');
  });

  it('documents the discover-validate-execute workflow', async () => {
    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((msg: string) => { logs.push(msg); });

    const cmd = new LlmsContext([], {} as never);
    await cmd.run();

    const output = logs.join('\n');
    expect(output).toContain('app schema');
    expect(output).toContain('app validate');
    expect(output).toContain('app execute');
  });

  it('documents error handling', async () => {
    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((msg: string) => { logs.push(msg); });

    const cmd = new LlmsContext([], {} as never);
    await cmd.run();

    const output = logs.join('\n');
    expect(output).toContain('exit_code' .toLowerCase().includes('exit') ? 'Exit codes' : 'exit');
    expect(output).toContain('retryable');
  });

  it('documents GraphQL API patterns', async () => {
    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((msg: string) => { logs.push(msg); });

    const cmd = new LlmsContext([], {} as never);
    await cmd.run();

    const output = logs.join('\n');
    expect(output).toContain('YesNo');
    expect(output).toContain('pagination');
  });
});
