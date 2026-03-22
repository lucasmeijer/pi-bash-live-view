import test from 'node:test';
import assert from 'node:assert/strict';
import { executePtyCommand, INPUT_IDLE_ABORT_MS, looksLikeInteractivePrompt } from '../pty-execute.ts';

function createCtx() {
  return { cwd: process.cwd(), hasUI: false };
}

function buildNodeCommand(source) {
  const normalized = source.trim().replace(/\s*\n\s*/g, ' ');
  return `${JSON.stringify(process.execPath)} -e ${JSON.stringify(normalized)}`;
}

test('prompt detector only flags likely interactive prompts', () => {
  assert.equal(looksLikeInteractivePrompt('Enter password: ', false), true);
  assert.equal(looksLikeInteractivePrompt('Proceed? [Y/n] ', false), true);
  assert.equal(looksLikeInteractivePrompt('Press any key to continue', false), true);
  assert.equal(looksLikeInteractivePrompt('Starting migration:', true), false);
  assert.equal(looksLikeInteractivePrompt('Compiling project > bundle.js', false), false);
});

test('PTY-backed bash aborts likely interactive prompts instead of hanging forever', async () => {
  const startedAt = Date.now();

  await assert.rejects(
    () => executePtyCommand(
      `interactive-${Date.now()}`,
      {
        command: buildNodeCommand(`
          process.stdout.write('Proceed with deployment? [Y/n] ');
          process.stdin.resume();
        `),
      },
      new AbortController().signal,
      createCtx(),
    ),
    (error) => {
      assert.equal(error instanceof Error, true);
      assert.match(error.message, /Proceed with deployment\? \[Y\/n\]/);
      assert.match(error.message, /waiting for interactive input/i);
      assert.match(error.message, /output-only/i);
      return true;
    },
  );

  const elapsedMs = Date.now() - startedAt;
  assert.ok(elapsedMs >= INPUT_IDLE_ABORT_MS, `expected detection to wait at least ${INPUT_IDLE_ABORT_MS}ms, got ${elapsedMs}ms`);
  assert.ok(elapsedMs < INPUT_IDLE_ABORT_MS + 2500, `expected detection to finish promptly, got ${elapsedMs}ms`);
});

test('PTY-backed bash does not misclassify quiet non-interactive commands as prompts', async () => {
  const result = await executePtyCommand(
    `quiet-${Date.now()}`,
    {
      command: buildNodeCommand(`
        console.log('Starting migration:');
        setTimeout(() => {
          console.log('done');
          process.exit(0);
        }, ${INPUT_IDLE_ABORT_MS + 300});
      `),
    },
    new AbortController().signal,
    createCtx(),
  );

  assert.equal(result.content[0]?.type, 'text');
  assert.match(result.content[0]?.text ?? '', /Starting migration:/);
  assert.match(result.content[0]?.text ?? '', /done/);
});
