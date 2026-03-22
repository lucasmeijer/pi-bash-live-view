import pty from 'node-pty';
import { createTerminalEmulator } from './terminal-emulator.ts';
import { killPtyProcess } from './pty-kill.ts';

export type PtyTerminalSessionOptions = {
  command: string;
  cwd: string;
  cols: number;
  rows: number;
  scrollback: number;
  shell: string;
  shellArgs?: string[];
  env?: Record<string, string | undefined>;
};

type TerminalEmulator = ReturnType<typeof createTerminalEmulator>;

type ExitListener = (exitCode: number | null, signal?: number) => void;

export class PtyTerminalSession {
  private readonly ptyProcess: pty.IPty;
  private readonly terminalEmulator: TerminalEmulator;
  private readonly startedAt = Date.now();
  private readonly exitListeners = new Set<ExitListener>();
  private lastOutputAt = Date.now();
  private lastChunkEndedWithNewline = true;
  private _exited = false;
  private _exitCode: number | null = null;
  private _signal: number | undefined;
  private disposed = false;

  constructor(options: PtyTerminalSessionOptions) {
    const {
      command,
      cwd,
      cols,
      rows,
      scrollback,
      shell,
      shellArgs = [],
      env,
    } = options;

    this.terminalEmulator = createTerminalEmulator({ cols, rows, scrollback });
    this.ptyProcess = pty.spawn(shell, [...shellArgs, command], {
      name: 'xterm-256color',
      cols,
      rows,
      cwd,
      env: {
        ...process.env,
        ...env,
        TERM: 'xterm-256color',
        COLORTERM: 'truecolor',
      },
    });

    this.ptyProcess.onData((chunk) => {
      this.lastOutputAt = Date.now();
      this.lastChunkEndedWithNewline = /(?:\r|\n)\s*$/u.test(chunk);
      void this.terminalEmulator.consumeProcessStdout(chunk, {
        elapsedMs: Date.now() - this.startedAt,
      });
    });

    this.ptyProcess.onExit(({ exitCode, signal }) => {
      this._exited = true;
      this._exitCode = exitCode;
      this._signal = signal;
      void this.whenIdle().then(() => {
        for (const listener of [...this.exitListeners]) {
          listener(exitCode, signal);
        }
      });
    });
  }

  get exited() {
    return this._exited;
  }

  get exitCode() {
    return this._exitCode;
  }

  get signal() {
    return this._signal;
  }

  get pid() {
    return this.ptyProcess.pid;
  }

  get cols() {
    return this.terminalEmulator.cols;
  }

  get rows() {
    return this.terminalEmulator.rows;
  }

  getLastOutputAt() {
    return this.lastOutputAt;
  }

  getLastChunkEndedWithNewline() {
    return this.lastChunkEndedWithNewline;
  }

  addExitListener(listener: ExitListener): () => void {
    this.exitListeners.add(listener);
    if (this._exited) {
      void this.whenIdle().then(() => {
        if (this.exitListeners.has(listener)) {
          listener(this._exitCode, this._signal);
        }
      });
    }
    return () => {
      this.exitListeners.delete(listener);
    };
  }

  whenIdle(): Promise<void> {
    return this.terminalEmulator.whenIdle();
  }

  getViewportSnapshot() {
    return this.terminalEmulator.getViewportSnapshot();
  }

  getStrippedTextIncludingEntireScrollback() {
    return this.terminalEmulator.getStrippedTextIncludingEntireScrollback();
  }

  subscribe(listener: (payload: { elapsedMs: number; snapshot: ReturnType<TerminalEmulator['getViewportSnapshot']>; inAltScreen: boolean; inSyncRender: boolean }) => void): () => void {
    return this.terminalEmulator.subscribe(listener);
  }

  kill(signal = 'SIGTERM') {
    if (this._exited) return;
    killPtyProcess(this.ptyProcess, signal);
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.kill();
    this.terminalEmulator.dispose();
    this.exitListeners.clear();
  }
}
