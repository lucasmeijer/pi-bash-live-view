import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, truncateHead } from '@mariozechner/pi-coding-agent';

export function truncateTranscript(text: string) {
  return truncateHead(text, { maxLines: DEFAULT_MAX_LINES, maxBytes: DEFAULT_MAX_BYTES });
}
