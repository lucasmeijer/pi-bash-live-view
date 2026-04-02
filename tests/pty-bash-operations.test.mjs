import test from 'node:test';
import assert from 'node:assert/strict';
import { createPtyBashOperations } from '../pty-execute.ts';

function createCtx() {
  return { cwd: process.cwd(), hasUI: false };
}

function buildNodeCommand(source) {
  const normalized = source.trim().replace(/\s*\n\s*/g, ' ');
  return `${JSON.stringify(process.execPath)} -e ${JSON.stringify(normalized)}`;
}

test('PTY user bash operations return final stripped output through onData and preserve exit code', async () => {
  const operations = createPtyBashOperations(createCtx());
  const chunks = [];

  const result = await operations.exec(
    `printf 'hello\\nworld'`,
    process.cwd(),
    {
      onData(chunk) {
        chunks.push(chunk.toString('utf8'));
      },
      signal: new AbortController().signal,
    },
  );

  assert.equal(result.exitCode, 0);
  assert.deepEqual(chunks, ['hello\nworld\n']);
});

test('PTY user bash operations surface aborts after streaming buffered output', async () => {
  const operations = createPtyBashOperations(createCtx());
  const controller = new AbortController();
  const chunks = [];
  const command = buildNodeCommand(`
    console.log('starting');
    setInterval(() => console.log('tick'), 50);
  `);

  setTimeout(() => controller.abort(), 100);

  await assert.rejects(
    () => operations.exec(command, process.cwd(), {
      onData(chunk) {
        chunks.push(chunk.toString('utf8'));
      },
      signal: controller.signal,
    }),
    /aborted/,
  );

  assert.equal(chunks.length, 1);
  assert.match(chunks[0], /starting/);
});
