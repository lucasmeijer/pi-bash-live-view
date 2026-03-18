export const hasTTY = Boolean(process.stdout.isTTY);

export function logPlain(...lines) {
  for (const line of lines) process.stdout.write(`${line}\n`);
}
