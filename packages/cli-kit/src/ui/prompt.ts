import { createInterface } from 'node:readline';

/**
 * Asks one question on stderr and reads the answer from stdin. When the input ends before an answer — no terminal,
 * or the piped answers ran out — it rejects with a message saying how to give the answer instead, rather than
 * leaving the command waiting on nothing until Node ends it (B-462).
 */
function ask(question: string, onAsked?: () => () => void, label = question.trim()): Promise<string> {
  const ended = () =>
    new Error(
      `No answer to "${label}": the input ended (is this a terminal?). Run the command in a terminal, or pass the answer as a flag (see --help).`,
    );

  // Without a terminal, oclif's parser reads stdin for a missing argument before the command runs, so the input
  // can have ended already: readline would then wait for an end it will never see.
  if (process.stdin.readableEnded) return Promise.reject(ended());

  const rl = createInterface({
    input: process.stdin,
    output: process.stderr,
  });

  return new Promise((resolve, reject) => {
    let answered = false;
    let restore = () => {};

    rl.on('close', () => {
      restore();
      if (!answered) reject(ended());
    });

    rl.question(question, (answer) => {
      answered = true;
      rl.close();
      resolve(answer.trim());
    });

    if (onAsked) restore = onAsked();
  });
}

export async function promptInput(message: string): Promise<string> {
  return ask(`${message} `);
}

export async function promptSecret(message: string): Promise<string> {
  // Mute the echoed characters once the prompt is shown, and give stderr back however the question ends.
  return ask(`${message} `, () => {
    const originalWrite = process.stderr.write;
    process.stderr.write = ((data: string | Uint8Array, ...rest: unknown[]) => {
      // Only suppress the echoed characters, not the prompt itself
      if (typeof data === 'string' && data.length === 1) return true;
      return (originalWrite as (...args: unknown[]) => boolean).call(process.stderr, data, ...rest);
    }) as typeof process.stderr.write;
    return () => {
      process.stderr.write = originalWrite;
      console.error(); // newline after hidden input
    };
  });
}

export async function promptSelect(message: string, choices: string[]): Promise<string> {
  console.error(`${message}`);
  choices.forEach((choice, i) => {
    console.error(`  ${i + 1}. ${choice}`);
  });

  const answer = await ask('Enter selection: ', undefined, message);
  const index = parseInt(answer, 10) - 1;
  return index >= 0 && index < choices.length ? choices[index] : choices[0];
}

export async function promptConfirm(message: string, defaultValue = true): Promise<boolean> {
  const suffix = defaultValue ? '[Y/n]' : '[y/N]';
  const answer = await promptInput(`${message} ${suffix}`);
  if (!answer) return defaultValue;
  return answer.toLowerCase().startsWith('y');
}
