import type {
  ExecutionResult,
  SupportedLanguage,
} from './execution-protocol';
import type { ExecutionCallbacks } from './execution-client';
import {
  closeSharedStdin,
  createSharedStdin,
  getSharedStdin,
  writeSharedStdin,
  STDIN_ABORTED,
} from './shared-stdin';

export type { ExecutionResult } from './execution-protocol';

/**
 * Request sent to the C/C++ WASM worker.
 */
interface CWorkerRequest {
  code: string;
  language: 'c' | 'cpp';
  /** Shared terminal stdin buffer used by the WASI worker. */
  stdinBuffer: SharedArrayBuffer;
  stdin: string;
  requestId: string;
}

/**
 * Response received from the C/C++ WASM worker.
 */
interface CWorkerResponse {
  type?: 'stream' | 'result';
  requestId?: string;
  stream?: 'stdout' | 'stderr';
  text?: string;
  attempt?: number;
  status?: 'completed' | 'failed' | 'output-limit';
  success: boolean;
  output: string;
  error?: string;
  exitCode?: number | null;
}

const EXECUTION_TIMEOUT_MS = 30000;

/**
 * Manages a single-use Web Worker for each C/C++ compilation + execution run.
 *
 * The worker uses browsercc (Clang/LLD compiled to WASM) to compile the source
 * into a WASI binary, then runs it with @bjorn3/browser_wasi_shim.
 *
 * stdin is exchanged through a shared buffer so the WASI worker can block
 * while the terminal waits for the next line.
 */
export class CompilerClient {
  /** Currently active worker (null when idle). */
  private worker: Worker | null = null;
  private stdinBuffer: SharedArrayBuffer | null = null;
  private activeRequest = false;
  private pendingInput: Uint8Array[] = [];
  private flushTimer: ReturnType<typeof setInterval> | null = null;

  public async compileAndRun(
    code: string,
    language: SupportedLanguage,
    stdin = '',
    callbacks?: ExecutionCallbacks,
  ): Promise<ExecutionResult> {
    if (this.activeRequest) {
      return {
        success: false,
        output: '',
        error: 'A C/C++ execution is already active.',
        exitCode: null,
        status: 'failed',
        phase: 'run',
      };
    }

    this.activeRequest = true;
    callbacks?.onStatus?.('compiling');

    try {
      const result = await this.runWorker(code, language, stdin, callbacks);
      callbacks?.onStatus?.(result.status);
      return result;
    } finally {
      this.activeRequest = false;
    }
  }

  private runWorker(
    code: string,
    language: SupportedLanguage,
    stdin: string,
    callbacks?: ExecutionCallbacks,
  ): Promise<ExecutionResult> {
    return new Promise((resolve) => {
      let settled = false;
      let timeoutId: ReturnType<typeof setTimeout> | null = null;
      let streamedOutput = false;

      const worker = new Worker(
        new URL('./compiler.worker.ts', import.meta.url),
        { type: 'module' },
      );

      this.worker = worker;

      const finish = (result: ExecutionResult): void => {
        if (settled) {
          return;
        }

        settled = true;
        if (timeoutId) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }
        worker.terminate();
        this.stopInputFlushing();

        if (this.worker === worker) {
          this.worker = null;
        }

        resolve(result);
      };

      worker.onmessage = (
        event: MessageEvent<CWorkerResponse>,
      ): void => {
        const data = event.data;
        if (
          data.type === 'stream' &&
          data.stream &&
          data.text
        ) {
          streamedOutput = true;
          callbacks?.onOutput?.(
            data.stream,
            data.text,
            data.attempt ?? 1,
          );
          return;
        }
        const output = data.output ?? '';
        const terminalOutput =
          data.success && !output
            ? 'Program completed with no output.'
            : output;

        if (terminalOutput && !streamedOutput) {
          callbacks?.onOutput?.('stdout', terminalOutput, 1);
        }

        finish({
          success: data.success,
          output: terminalOutput,
          error: data.success ? undefined : (data.error ?? 'C/C++ execution failed.'),
          exitCode: data.exitCode ?? (data.success ? 0 : 1),
          status: data.status ?? (data.success ? 'completed' : 'failed'),
          phase: data.success ? 'run' : 'compile',
        });
      };

      worker.onerror = (event): void => {
        finish({
          success: false,
          output: '',
          error:
            event.message ||
            'The C/C++ worker stopped unexpectedly.',
          exitCode: null,
          status: 'infrastructure-error',
          phase: 'run',
        });
      };

      try {
        const stdinBuffer = this.createStdinBuffer(stdin);
        this.stdinBuffer = stdinBuffer;
        const request: CWorkerRequest = {
          code,
          language: (language === 'cpp' ? 'cpp' : 'c') as 'c' | 'cpp',
          stdinBuffer,
          stdin,
          requestId: this.createRequestId(),
        };

        worker.postMessage(request);
        this.startInputFlushing();

        timeoutId = setTimeout(() => {
          finish({
            success: false,
            output: '',
            error: `Execution timed out after ${EXECUTION_TIMEOUT_MS / 1000} seconds.`,
            exitCode: null,
            status: 'timeout',
            phase: 'run',
          });
        }, EXECUTION_TIMEOUT_MS);
      } catch (error: unknown) {
        finish({
          success: false,
          output: '',
          error:
            error instanceof Error
              ? error.message
              : 'Unable to start C/C++ execution.',
          exitCode: null,
          status: 'infrastructure-error',
          phase: 'run',
        });
      }
    });
  }

  /** Sends one terminal line to the blocked C/C++ WASI stdin reader. */
  public sendInput(input: string): void {
    if (!this.stdinBuffer) {
      return;
    }

    this.pendingInput.push(
      new TextEncoder().encode(
        input.endsWith('\n') ? input : `${input}\n`,
      ),
    );
    this.flushPendingInput();
  }

  public closeInput(): void {
    if (this.stdinBuffer) {
      closeSharedStdin(getSharedStdin(this.stdinBuffer));
      this.pendingInput = [];
    }
  }

  public stopCurrent(): void {
    if (this.stdinBuffer) {
      closeSharedStdin(
        getSharedStdin(this.stdinBuffer),
        STDIN_ABORTED,
      );
      this.stdinBuffer = null;
    }

    this.pendingInput = [];
    this.stopInputFlushing();
    this.worker?.terminate();
    this.worker = null;
    this.activeRequest = false;
  }

  public terminate(): void {
    this.stopCurrent();
  }

  private createStdinBuffer(initialInput: string): SharedArrayBuffer {
    if (typeof SharedArrayBuffer === 'undefined' || !globalThis.crossOriginIsolated) {
      throw new Error(
        'C/C++ execution requires a cross-origin-isolated page. Reload the deployed site after the latest deployment.',
      );
    }

    const stdin = createSharedStdin(
      initialInput
        ? initialInput.endsWith('\n')
          ? initialInput
          : `${initialInput}\n`
        : '',
    );
    return stdin.buffer;
  }

  private flushPendingInput(): void {
    if (!this.stdinBuffer) {
      return;
    }

    const stdin = getSharedStdin(this.stdinBuffer);
    while (this.pendingInput.length > 0) {
      const input = this.pendingInput[0];
      const written = writeSharedStdin(stdin, input);
      if (written < input.length) {
        this.pendingInput[0] = input.slice(written);
        return;
      }
      this.pendingInput.shift();
    }
  }

  private startInputFlushing(): void {
    this.stopInputFlushing();
    this.flushTimer = setInterval(() => {
      this.flushPendingInput();
    }, 25);
  }

  private stopInputFlushing(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
  }

  private createRequestId(): string {
    return `c-run-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
}

export default CompilerClient;