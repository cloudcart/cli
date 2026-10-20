import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { exec } from './project.js';

const folders: string[] = [];

afterEach(() => {
  for (const path of folders.splice(0)) rmSync(path, { recursive: true, force: true });
  vi.restoreAllMocks();
});

function folder(): string {
  const path = mkdtempSync(join(tmpdir(), 'nitrogen-exec-test-'));
  folders.push(path);
  return path;
}

describe('exec (B-463)', () => {
  it('passes each argument as it is, with no shell to join or expand it', async () => {
    const cwd = folder();
    const out = join(cwd, 'argv.json');
    const tricky = ['a b', '"quoted"', '$HOME', "it's", '*', '; echo injected'];
    await exec(process.execPath, ['-e', 'require("fs").writeFileSync(process.argv[1], JSON.stringify(process.argv.slice(2)))', out, ...tricky], cwd);
    expect(JSON.parse(readFileSync(out, 'utf-8'))).toEqual(tricky);
  });

  it('runs in the given folder with the extra environment', async () => {
    const cwd = folder();
    const out = join(cwd, 'env.json');
    await exec(process.execPath, ['-e', 'require("fs").writeFileSync("env.json", JSON.stringify([process.cwd(), process.env.T506_VALUE]))'], cwd, { T506_VALUE: 'given' });
    const [ranIn, value] = JSON.parse(readFileSync(out, 'utf-8'));
    expect(ranIn.endsWith(cwd.split('/').pop()!)).toBe(true);
    expect(value).toBe('given');
  });

  it('raises no deprecation warning', async () => {
    const warnings: string[] = [];
    const emit = vi.spyOn(process, 'emitWarning').mockImplementation(((warning: string | Error, ...rest: unknown[]) => {
      warnings.push(String(typeof rest[0] === 'object' ? (rest[0] as { code?: string }).code : rest[1] ?? warning));
    }) as typeof process.emitWarning);
    await exec(process.execPath, ['-e', ''], folder());
    emit.mockRestore();
    expect(warnings.filter((code) => code.includes('DEP0190'))).toEqual([]);
  });

  it('fails with the exit code, and names a program that cannot run', async () => {
    await expect(exec(process.execPath, ['-e', 'process.exit(3)'], folder())).rejects.toThrow('Process exited with code 3');
    await expect(exec('t506-no-such-program', [], folder())).rejects.toThrow(/Could not run t506-no-such-program: .*ENOENT/);
  });

  it('fails when the process was ended by a signal: a killed build is not a finished one (B-502)', async () => {
    await expect(exec(process.execPath, ['-e', 'process.kill(process.pid, "SIGKILL")'], folder())).rejects.toThrow('Process ended by signal SIGKILL');
  });
});
