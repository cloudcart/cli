import { describe, it, expect, vi, beforeEach } from 'vitest';
import Describe from './describe.js';

describe('Describe command', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('has the correct description', () => {
    expect(Describe.description).toContain('machine-readable JSON');
  });

  it('outputs valid JSON', async () => {
    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((msg: string) => { logs.push(msg); });

    const cmd = new Describe([], {} as never);
    await cmd.run();

    expect(logs.length).toBe(1);
    const parsed = JSON.parse(logs[0]);
    expect(parsed.name).toBe('cloudcart');
    expect(parsed.version).toBe('0.1.0');
  });

  it('includes all command descriptions', async () => {
    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((msg: string) => { logs.push(msg); });

    const cmd = new Describe([], {} as never);
    await cmd.run();

    const parsed = JSON.parse(logs[0]);
    expect(parsed.commands).toHaveProperty('auth login');
    expect(parsed.commands).toHaveProperty('auth logout');
    expect(parsed.commands).toHaveProperty('auth status');
    expect(parsed.commands).toHaveProperty('app execute');
    expect(parsed.commands).toHaveProperty('app schema');
    expect(parsed.commands).toHaveProperty('app validate');
    expect(parsed.commands).toHaveProperty('describe');
    expect(parsed.commands).toHaveProperty('llms-context');
  });

  it('includes auth info', async () => {
    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((msg: string) => { logs.push(msg); });

    const cmd = new Describe([], {} as never);
    await cmd.run();

    const parsed = JSON.parse(logs[0]);
    expect(parsed.auth.env_vars).toHaveProperty('CLOUDCART_CLI_TOKEN');
    expect(parsed.auth.env_vars).toHaveProperty('CLOUDCART_CLI_STORE');
  });

  it('includes exit codes', async () => {
    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((msg: string) => { logs.push(msg); });

    const cmd = new Describe([], {} as never);
    await cmd.run();

    const parsed = JSON.parse(logs[0]);
    expect(parsed.exit_codes).toBeDefined();
    expect(parsed.exit_codes[0]).toBe('success');
    expect(parsed.exit_codes[4]).toBe('authentication/permission denied');
  });

  it('includes ai_usage section', async () => {
    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((msg: string) => { logs.push(msg); });

    const cmd = new Describe([], {} as never);
    await cmd.run();

    const parsed = JSON.parse(logs[0]);
    expect(parsed.ai_usage).toBeDefined();
    expect(parsed.ai_usage.recommended_flags).toContain('--json');
    expect(parsed.ai_usage.schema_discovery).toContain('--search');
  });
});
