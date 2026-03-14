import { createInterface } from 'node:readline';

export async function promptInput(message: string): Promise<string> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stderr,
  });

  return new Promise((resolve) => {
    rl.question(`${message} `, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

export async function promptSecret(message: string): Promise<string> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stderr,
  });

  // Mute output for secret input
  const originalWrite = process.stderr.write.bind(process.stderr);
  return new Promise((resolve) => {
    rl.question(`${message} `, (answer) => {
      process.stderr.write = originalWrite;
      console.error(); // newline after hidden input
      rl.close();
      resolve(answer.trim());
    });
    // Hide characters after the prompt is displayed
    process.stderr.write = (data: string | Uint8Array) => {
      // Only suppress the echoed characters, not the prompt itself
      if (typeof data === 'string' && data.length === 1) return true;
      return originalWrite(data);
    };
  });
}

export async function promptSelect(message: string, choices: string[]): Promise<string> {
  console.error(`${message}`);
  choices.forEach((choice, i) => {
    console.error(`  ${i + 1}. ${choice}`);
  });

  const rl = createInterface({
    input: process.stdin,
    output: process.stderr,
  });

  return new Promise((resolve) => {
    rl.question('Enter selection: ', (answer) => {
      rl.close();
      const index = parseInt(answer, 10) - 1;
      if (index >= 0 && index < choices.length) {
        resolve(choices[index]);
      } else {
        resolve(choices[0]);
      }
    });
  });
}

export async function promptConfirm(message: string, defaultValue = true): Promise<boolean> {
  const suffix = defaultValue ? '[Y/n]' : '[y/N]';
  const answer = await promptInput(`${message} ${suffix}`);
  if (!answer) return defaultValue;
  return answer.toLowerCase().startsWith('y');
}
