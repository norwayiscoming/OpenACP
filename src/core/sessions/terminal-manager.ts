import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import type { MiddlewareChain } from "../plugin/middleware-chain.js";

interface TerminalState {
  process: ChildProcess;
  output: string;
  exitStatus: { exitCode: number | null; signal: string | null } | null;
  command: string;
  startTime: number;
}

interface CreateTerminalParams {
  command: string;
  args?: string[] | Array<{ name: string; value: string }>;
  env?: Array<{ name: string; value: string }>;
  cwd?: string;
  outputByteLimit?: number;
}

interface TerminalOutputResult {
  output: string;
  truncated: boolean;
  exitStatus?: { exitCode: number | null; signal: string | null };
}

interface WaitForExitResult {
  exitCode: number | null;
  signal: string | null;
}

export class TerminalManager {
  private terminals: Map<string, TerminalState> = new Map();
  private maxOutputBytes: number;

  constructor(maxOutputBytes = 1024 * 1024) {
    this.maxOutputBytes = maxOutputBytes;
  }

  async createTerminal(
    sessionId: string,
    params: CreateTerminalParams,
    middlewareChain?: MiddlewareChain,
  ): Promise<{ terminalId: string }> {
    let termCommand = params.command;
    let termArgs = params.args ?? [];
    let termEnvArr = params.env ?? [];
    let termCwd = params.cwd ?? undefined;

    if (middlewareChain) {
      const envRecord: Record<string, string> = {};
      for (const ev of termEnvArr) { envRecord[ev.name] = ev.value; }
      const result = await middlewareChain.execute('terminal:beforeCreate', {
        sessionId,
        command: termCommand,
        args: termArgs as string[],
        env: envRecord,
        cwd: termCwd,
      }, async (p) => p);
      if (!result) return { terminalId: "" }; // blocked by middleware
      termCommand = result.command;
      termArgs = result.args ?? termArgs;
      termCwd = result.cwd ?? termCwd;
      if (result.env) {
        termEnvArr = Object.entries(result.env).map(([name, value]) => ({ name, value }));
      }
    }

    const terminalId = randomUUID();
    const args = termArgs as string[];
    const env: Record<string, string> = {};
    for (const ev of termEnvArr) {
      env[ev.name] = ev.value;
    }

    const childProcess = spawn(termCommand, args, {
      cwd: termCwd,
      env: { ...process.env, ...env },
      shell: false,
    });

    const state: TerminalState = {
      process: childProcess,
      output: "",
      exitStatus: null,
      command: termCommand,
      startTime: Date.now(),
    };
    this.terminals.set(terminalId, state);

    const outputByteLimit = params.outputByteLimit ?? this.maxOutputBytes;

    const appendOutput = (chunk: string) => {
      state.output += chunk;
      const bytes = Buffer.byteLength(state.output, "utf-8");
      if (bytes > outputByteLimit) {
        const excess = bytes - outputByteLimit;
        state.output = state.output.slice(excess);
      }
    };

    childProcess.stdout?.on("data", (chunk: Buffer) =>
      appendOutput(chunk.toString()),
    );
    childProcess.stderr?.on("data", (chunk: Buffer) =>
      appendOutput(chunk.toString()),
    );

    childProcess.on("exit", (code, signal) => {
      state.exitStatus = { exitCode: code, signal };
      if (middlewareChain) {
        middlewareChain.execute('terminal:afterExit', {
          sessionId,
          terminalId,
          command: state.command,
          exitCode: code ?? -1,
          durationMs: Date.now() - state.startTime,
        }, async (p) => p).catch(() => {});
      }
    });

    return { terminalId };
  }

  getOutput(terminalId: string): TerminalOutputResult {
    const state = this.terminals.get(terminalId);
    if (!state) {
      throw new Error(`Terminal not found: ${terminalId}`);
    }
    return {
      output: state.output,
      truncated: false,
      exitStatus: state.exitStatus
        ? {
            exitCode: state.exitStatus.exitCode,
            signal: state.exitStatus.signal,
          }
        : undefined,
    };
  }

  async waitForExit(terminalId: string): Promise<WaitForExitResult> {
    const state = this.terminals.get(terminalId);
    if (!state) {
      throw new Error(`Terminal not found: ${terminalId}`);
    }
    if (state.exitStatus !== null) {
      return {
        exitCode: state.exitStatus.exitCode,
        signal: state.exitStatus.signal,
      };
    }
    return new Promise((resolve) => {
      state.process.on("exit", (code, signal) => {
        resolve({ exitCode: code, signal });
      });
    });
  }

  kill(terminalId: string): void {
    const state = this.terminals.get(terminalId);
    if (!state) {
      throw new Error(`Terminal not found: ${terminalId}`);
    }
    state.process.kill("SIGTERM");
  }

  release(terminalId: string): void {
    const state = this.terminals.get(terminalId);
    if (!state) {
      return;
    }
    state.process.kill("SIGKILL");
    this.terminals.delete(terminalId);
  }

  destroyAll(): void {
    for (const [, t] of this.terminals) {
      t.process.kill("SIGKILL");
    }
    this.terminals.clear();
  }
}
