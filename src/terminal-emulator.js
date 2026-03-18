import stripAnsi from 'strip-ansi';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

let TerminalCtor = null;

function ensureXtermHeadlessLoaded() {
  if (!globalThis.window) globalThis.window = {};
  if (!TerminalCtor) {
    ({ Terminal: TerminalCtor } = require('xterm-headless'));
  }
  return TerminalCtor;
}

function defaultStyle() {
  return { fg: null, bold: false, dim: false };
}

function cloneStyle(style) {
  return { fg: style.fg, bold: style.bold, dim: style.dim };
}

function cloneSnapshot(snapshot) {
  return snapshot.map((line) => line.map((cell) => ({ ...cell, style: cloneStyle(cell.style ?? defaultStyle()) })));
}

function sanitizeOutput(text) {
  return stripAnsi(text).replace(/\r/g, '').replace(/\u0000/g, '').replace(/\p{Cf}/gu, '');
}

function applyTranscriptChunk(state, text) {
  for (const ch of text) {
    if (state.pendingCR && ch !== '\n') state.current = '';
    if (ch === '\r') {
      state.pendingCR = true;
      continue;
    }
    if (ch === '\n') {
      state.lines.push(state.current);
      state.current = '';
      state.pendingCR = false;
      continue;
    }
    if (ch === '\b') state.current = state.current.slice(0, -1);
    else if (ch >= ' ' || ch === '\t') state.current += ch;
    state.pendingCR = false;
  }
}

function finalizeTranscript(state) {
  const lines = [...state.lines];
  if (state.current) lines.push(state.current);
  const text = sanitizeOutput(lines.join('\n')).trimEnd();
  return text.length === 0 ? '(no output)' : `${text}\n`;
}

function createNormalScreenTranscriptFilter(inAltAtStart = false) {
  let inAlt = inAltAtStart;
  let state = 'ground';
  let privateMarker = false;
  let params = '';

  function reset() {
    state = 'ground';
    privateMarker = false;
    params = '';
  }

  function finalize(finalByte) {
    if (privateMarker && (finalByte === 'h' || finalByte === 'l')) {
      const enabled = finalByte === 'h';
      for (const part of params.split(';')) {
        if (!part) continue;
        const mode = Number(part);
        if (mode === 1049 || mode === 1047 || mode === 47) inAlt = enabled;
      }
    }
    reset();
  }

  return {
    push(text) {
      let out = '';
      for (const ch of text) {
        if (state === 'ground') {
          if (ch === '\x1b') {
            state = 'escape';
            continue;
          }
          if (!inAlt) out += ch;
          continue;
        }
        if (state === 'escape') {
          if (ch === '[') {
            state = 'csi';
            privateMarker = false;
            params = '';
            continue;
          }
          reset();
          continue;
        }
        if (state === 'csi') {
          if (ch === '?') {
            if (params.length === 0 && !privateMarker) {
              privateMarker = true;
              continue;
            }
            reset();
            continue;
          }
          if ((ch >= '0' && ch <= '9') || ch === ';') {
            params += ch;
            continue;
          }
          if (ch >= '@' && ch <= '~') {
            finalize(ch);
            continue;
          }
          reset();
        }
      }
      return out;
    },
    getState() {
      return { inAlt, state };
    },
  };
}

function hexByte(n) {
  return Math.max(0, Math.min(255, n)).toString(16).padStart(2, '0');
}

function rgbToHex(r, g, b) {
  return `#${hexByte(r)}${hexByte(g)}${hexByte(b)}`;
}

function rgbIntToHex(value) {
  return rgbToHex((value >> 16) & 255, (value >> 8) & 255, value & 255);
}

function buildAnsi256Palette() {
  const base = [
    '#000000', '#cd0000', '#00cd00', '#cdcd00', '#0000ee', '#cd00cd', '#00cdcd', '#e5e5e5',
    '#7f7f7f', '#ff0000', '#00ff00', '#ffff00', '#5c5cff', '#ff00ff', '#00ffff', '#ffffff',
  ];
  const palette = [...base];
  const steps = [0, 95, 135, 175, 215, 255];
  for (let r = 0; r < 6; r++) {
    for (let g = 0; g < 6; g++) {
      for (let b = 0; b < 6; b++) {
        palette.push(rgbToHex(steps[r], steps[g], steps[b]));
      }
    }
  }
  for (let i = 0; i < 24; i++) {
    const value = 8 + i * 10;
    palette.push(rgbToHex(value, value, value));
  }
  return palette;
}

const ANSI_256_PALETTE = buildAnsi256Palette();

function ansi256ToHex(index) {
  return ANSI_256_PALETTE[index] ?? null;
}

function colorFromCell(cell, useBackground = false) {
  const isDefault = useBackground ? cell.isBgDefault() : cell.isFgDefault();
  if (isDefault) return null;
  const isRgb = useBackground ? cell.isBgRGB() : cell.isFgRGB();
  const isPalette = useBackground ? cell.isBgPalette() : cell.isFgPalette();
  const value = useBackground ? cell.getBgColor() : cell.getFgColor();
  if (isRgb) return rgbIntToHex(value);
  if (isPalette) return ansi256ToHex(value);
  return null;
}

function styleFromCell(cell) {
  const inverse = Boolean(cell.isInverse());
  const fg = inverse ? (colorFromCell(cell, true) ?? null) : colorFromCell(cell, false);
  return {
    fg,
    bold: Boolean(cell.isBold()),
    dim: Boolean(cell.isDim()),
  };
}

function createXterm(cols, rows, scrollback) {
  const Terminal = ensureXtermHeadlessLoaded();
  return new Terminal({
    cols,
    rows,
    scrollback,
    allowProposedApi: true,
  });
}

function snapshotTerminal(term) {
  const buffer = term.buffer.active;
  const start = buffer.baseY;
  const lines = [];
  const scratchCell = buffer.getNullCell();
  for (let y = 0; y < term.rows; y++) {
    const row = [];
    const line = buffer.getLine(start + y);
    for (let x = 0; x < term.cols; x++) {
      const cell = line?.getCell(x, scratchCell);
      if (!cell) {
        row.push({ ch: ' ', style: defaultStyle() });
        continue;
      }
      if (cell.getWidth() === 0) continue;
      row.push({
        ch: cell.getChars() || ' ',
        style: styleFromCell(cell),
      });
    }
    lines.push(row);
  }
  return lines;
}

function styleToAnsi(style) {
  const codes = [];
  if (style.bold) codes.push(1);
  if (style.dim) codes.push(2);
  if (style.fg) {
    const value = style.fg.replace(/^#/, '');
    if (value.length === 6) {
      codes.push(38, 2, parseInt(value.slice(0, 2), 16), parseInt(value.slice(2, 4), 16), parseInt(value.slice(4, 6), 16));
    }
  }
  return codes.length ? `\x1b[${codes.join(';')}m` : '';
}

function frameSnapshotToAnsiLines(lines) {
  return lines.map((line) => {
    if (!Array.isArray(line)) return String(line ?? '');
    let out = '';
    let current = defaultStyle();
    for (const cell of line) {
      const style = cell.style ?? defaultStyle();
      if (style.fg !== current.fg || style.bold !== current.bold || style.dim !== current.dim) {
        out += '\x1b[0m' + styleToAnsi(style);
        current = cloneStyle(style);
      }
      out += cell.ch;
    }
    return `${out}\x1b[0m`.replace(/\s+\x1b\[0m$/, '\x1b[0m');
  });
}

function fitAnsiLine(line, width) {
  let out = '';
  let visible = 0;
  let i = 0;
  while (i < line.length && visible < width) {
    if (line[i] === '\x1b' && line[i + 1] === '[') {
      const match = line.slice(i).match(/^\x1b\[[0-9;]*m/);
      if (match) {
        out += match[0];
        i += match[0].length;
        continue;
      }
    }
    out += line[i];
    visible += 1;
    i += 1;
  }
  return `${out}\x1b[0m${' '.repeat(Math.max(0, width - visible))}`;
}

function createDecPrivateModeTracker(onModeChange) {
  let state = 'ground';
  let privateMarker = false;
  let params = '';

  function reset() {
    state = 'ground';
    privateMarker = false;
    params = '';
  }

  function finalize(finalByte) {
    if (!privateMarker || (finalByte !== 'h' && finalByte !== 'l')) {
      reset();
      return;
    }
    const enabled = finalByte === 'h';
    for (const part of params.split(';')) {
      if (!part) continue;
      const mode = Number(part);
      if (!Number.isInteger(mode)) continue;
      onModeChange(mode, enabled);
    }
    reset();
  }

  return {
    push(text) {
      for (const ch of text) {
        if (state === 'ground') {
          if (ch === '\x1b') state = 'escape';
          continue;
        }
        if (state === 'escape') {
          if (ch === '[') {
            state = 'csi';
            privateMarker = false;
            params = '';
            continue;
          }
          state = ch === '\x1b' ? 'escape' : 'ground';
          continue;
        }
        if (state === 'csi') {
          if (ch === '?') {
            if (params.length === 0 && !privateMarker) {
              privateMarker = true;
              continue;
            }
            reset();
            continue;
          }
          if ((ch >= '0' && ch <= '9') || ch === ';') {
            params += ch;
            continue;
          }
          if (ch >= '@' && ch <= '~') {
            finalize(ch);
            continue;
          }
          reset();
        }
      }
    },
  };
}

export function formatElapsed(ms) {
  const totalSeconds = Math.max(0, ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds.toFixed(1)}s`;
  const wholeSeconds = Math.floor(totalSeconds);
  const hours = Math.floor(wholeSeconds / 3600);
  const minutes = Math.floor((wholeSeconds % 3600) / 60);
  const seconds = wholeSeconds % 60;
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export function buildTopBorder(title, innerWidth, elapsedMs) {
  const timer = ` ${formatElapsed(elapsedMs)}`;
  const rawTitle = title ? ` ${title} ` : '';
  const titleText = rawTitle.slice(0, Math.max(0, innerWidth - timer.length - 1));
  const fill = '─'.repeat(Math.max(0, innerWidth - titleText.length - timer.length));
  return `${titleText}${fill}${timer}`.padEnd(innerWidth, '─').slice(0, innerWidth);
}

export function buildWidgetAnsiLines({ title = 'Live terminal', snapshot, width, rows, elapsedMs = 0, accentColor = '77;163;255' }) {
  const accent = `\x1b[38;2;${accentColor}m`;
  const reset = '\x1b[0m';
  const innerWidth = Math.max(10, width - 2);
  const top = `${accent}╭${buildTopBorder(title, innerWidth, elapsedMs)}╮${reset}`;
  const bottom = `${accent}╰${'─'.repeat(innerWidth)}╯${reset}`;
  const bodySource = frameSnapshotToAnsiLines(snapshot).slice(-rows);
  const body = [];
  for (let i = 0; i < rows; i++) {
    const line = fitAnsiLine(bodySource[i] ?? '', innerWidth);
    body.push(`${accent}│${reset}${line}${accent}│${reset}`);
  }
  return [top, ...body, bottom];
}

export function createTerminalEmulator({ cols, rows, scrollback = 10_000, title = 'Live terminal' }) {
  const term = createXterm(cols, rows, scrollback);
  const transcript = { lines: [], current: '' };
  const listeners = new Set();
  let writeChain = Promise.resolve();
  let inAltScreen = false;
  let inSyncRender = false;
  let lastCompletedSnapshot = snapshotTerminal(term);
  let latestSnapshot = cloneSnapshot(lastCompletedSnapshot);
  let lastElapsedMs = 0;
  const transcriptFilter = createNormalScreenTranscriptFilter();
  const modeTracker = createDecPrivateModeTracker((mode, enabled) => {
    if (mode === 2026) {
      inSyncRender = enabled;
      return;
    }
    if (mode === 1049 || mode === 1047 || mode === 47) {
      inAltScreen = enabled;
    }
  });

  function emitUpdate(payload) {
    for (const listener of listeners) listener(payload);
  }

  async function consumeProcessStdout(chunk, { elapsedMs = lastElapsedMs } = {}) {
    lastElapsedMs = elapsedMs;
    modeTracker.push(chunk);
    const visibleNormal = transcriptFilter.push(chunk);
    if (visibleNormal) applyTranscriptChunk(transcript, stripAnsi(visibleNormal));
    writeChain = writeChain.then(() => new Promise((resolve) => {
      term.write(chunk, () => {
        latestSnapshot = snapshotTerminal(term);
        const renderableSnapshot = inSyncRender ? lastCompletedSnapshot : latestSnapshot;
        if (!inSyncRender) lastCompletedSnapshot = cloneSnapshot(latestSnapshot);
        const payload = {
          elapsedMs: lastElapsedMs,
          snapshot: cloneSnapshot(renderableSnapshot),
          inAltScreen,
          inSyncRender,
        };
        emitUpdate(payload);
        resolve(payload);
      });
    }));
    return writeChain;
  }

  function getViewportSnapshot() {
    return cloneSnapshot(inSyncRender ? lastCompletedSnapshot : latestSnapshot);
  }

  function getViewportAsAnsiLines({ width, rows: overrideRows = rows, elapsedMs = lastElapsedMs, title: overrideTitle = title, accentColor } = {}) {
    return buildWidgetAnsiLines({
      title: overrideTitle,
      snapshot: getViewportSnapshot(),
      width,
      rows: overrideRows,
      elapsedMs,
      accentColor,
    });
  }

  function getStrippedTextIncludingEntireScrollback() {
    return finalizeTranscript(transcript);
  }

  return {
    cols,
    rows,
    title,
    consumeProcessStdout,
    whenIdle() {
      return writeChain;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getState() {
      return { inAltScreen, inSyncRender, elapsedMs: lastElapsedMs };
    },
    getViewportSnapshot,
    getViewportAsAnsiLines,
    getStrippedTextIncludingEntireScrollback,
    dispose() {
      term.dispose?.();
      listeners.clear();
    },
  };
}
