import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_MAX_BYTES, formatSize, truncateTail } from '@mariozechner/pi-coding-agent';

function getTempFilePath() {
  const id = randomBytes(8).toString('hex');
  return join(tmpdir(), `pi-bash-${id}.log`);
}

function maybePersistFullOutput(fullOutput: string) {
  if (Buffer.byteLength(fullOutput, 'utf-8') <= DEFAULT_MAX_BYTES) return undefined;
  const tempFilePath = getTempFilePath();
  writeFileSync(tempFilePath, fullOutput, 'utf-8');
  return tempFilePath;
}

function buildTruncationNotice(truncation: ReturnType<typeof truncateTail>, fullOutput: string, tempFilePath?: string) {
  const startLine = truncation.totalLines - truncation.outputLines + 1;
  const endLine = truncation.totalLines;

  if (truncation.lastLinePartial) {
    const lastLineSize = formatSize(Buffer.byteLength(fullOutput.split('\n').pop() || '', 'utf-8'));
    return `\n\n[Showing last ${formatSize(truncation.outputBytes)} of line ${endLine} (line is ${lastLineSize}). Full output: ${tempFilePath}]`;
  }
  if (truncation.truncatedBy === 'lines') {
    return `\n\n[Showing lines ${startLine}-${endLine} of ${truncation.totalLines}. Full output: ${tempFilePath}]`;
  }
  return `\n\n[Showing lines ${startLine}-${endLine} of ${truncation.totalLines} (${formatSize(DEFAULT_MAX_BYTES)} limit). Full output: ${tempFilePath}]`;
}

export function buildSuccessfulBashResult(fullOutput: string) {
  const truncation = truncateTail(fullOutput);
  let outputText = truncation.content || '(no output)';
  const tempFilePath = truncation.truncated ? maybePersistFullOutput(fullOutput) : undefined;
  let details;

  if (truncation.truncated) {
    details = {
      truncation,
      fullOutputPath: tempFilePath,
    };
    outputText += buildTruncationNotice(truncation, fullOutput, tempFilePath);
  }

  return {
    content: [{ type: 'text' as const, text: outputText }],
    details,
  };
}

export function buildExitCodeError(fullOutput: string, exitCode: number) {
  const result = buildSuccessfulBashResult(fullOutput);
  const outputText = result.content[0]?.text || '(no output)';
  return new Error(`${outputText}\n\nCommand exited with code ${exitCode}`);
}

export function buildAbortError(fullOutput: string) {
  const output = fullOutput === '(no output)' ? '' : fullOutput;
  return new Error(output ? `${output}\n\nCommand aborted` : 'Command aborted');
}

export function buildTimeoutError(fullOutput: string, timeout: number) {
  const output = fullOutput === '(no output)' ? '' : fullOutput;
  return new Error(output ? `${output}\n\nCommand timed out after ${timeout} seconds` : `Command timed out after ${timeout} seconds`);
}

export function buildInteractiveStdinError(fullOutput: string, prompt: string, idleMs: number) {
  const output = fullOutput === '(no output)' ? '' : fullOutput;
  const normalizedPrompt = prompt.trim();
  const suffix = [
    `Command appears to be waiting for interactive input after ${(idleMs / 1000).toFixed(1)} seconds, but usePTY=true in pi-bash-live-view is output-only. Re-run with non-interactive flags or run the command manually.`,
    normalizedPrompt ? `Last prompt: ${normalizedPrompt}` : undefined,
  ].filter(Boolean).join('\n');

  return new Error(output ? `${output}\n\n${suffix}` : suffix);
}
