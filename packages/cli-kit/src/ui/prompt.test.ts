import { once } from 'node:events';
import { Readable } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { promptConfirm, promptInput, promptSecret, promptSelect } from './prompt.js';

/** Gives the prompts this input instead of the terminal, and silences what they print. */
function input(...chunks: string[]): void {
  vi.spyOn(process, 'stdin', 'get').mockReturnValue(Readable.from(chunks) as unknown as typeof process.stdin);
  vi.spyOn(console, 'error').mockImplementation(() => {});
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('prompts with an answer', () => {
  it('reads a typed answer', async () => {
    input('my-store\n');
    await expect(promptInput('Project name:')).resolves.toBe('my-store');
  });

  it('chooses by number', async () => {
    input('2\n');
    await expect(promptSelect('Store:', ['Mock store', 'Connect'])).resolves.toBe('Connect');
  });

  it('confirms', async () => {
    input('n\n');
    await expect(promptConfirm('Write?', true)).resolves.toBe(false);
  });
});

describe('prompts whose input ended (B-462)', () => {
  it.each([
    ['promptInput', () => promptInput('Project name:'), 'Project name:'],
    ['promptSelect', () => promptSelect('Store:', ['Mock store', 'Connect']), 'Store:'],
    ['promptConfirm', () => promptConfirm('Write?'), 'Write? [Y/n]'],
    ['promptSecret', () => promptSecret('Token:'), 'Token:'],
  ])('%s says the input ended and how to answer instead', async (_name, ask, question) => {
    input();
    await expect(ask()).rejects.toThrow(`No answer to "${question}": the input ended`);
  });

  it('says so too when the input ended before the question, read by the CLI\'s parser', async () => {
    const consumed = Readable.from([]);
    consumed.resume();
    await once(consumed, 'end');
    vi.spyOn(process, 'stdin', 'get').mockReturnValue(consumed as unknown as typeof process.stdin);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(promptInput('Project name:')).rejects.toThrow('No answer to "Project name:": the input ended');
  });

  it('gives stderr back after a secret question, answered or not', async () => {
    const write = process.stderr.write;
    input();
    await expect(promptSecret('Token:')).rejects.toThrow();
    expect(process.stderr.write).toBe(write);

    input('s3cret\n');
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const spied = process.stderr.write;
    await expect(promptSecret('Token:')).resolves.toBe('s3cret');
    expect(process.stderr.write).toBe(spied);
  });
});
