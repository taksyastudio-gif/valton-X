import type {
  ExecutionResult,
  SupportedLanguage,
} from './execution-protocol';
import type { ExecutionCallbacks } from './execution-client';

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
}

/**
 * Response received from the C/C++ WASM worker.
 */
interface CWorkerResponse {
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

        if (this.worker === worker) {
          this.worker = null;
        }

        resolve(result);
      };

      worker.onmessage = (
        event: MessageEvent<CWorkerResponse>,
      ): void => {
        const data = event.data;
        const output = data.output ?? '';

        if (output) {
          callbacks?.onOutput?.('stdout', output, 1);
        }

        finish({
          success: data.success,
          output,
          error: data.success ? undefined : (data.error ?? 'C/C++ execution failed.'),
          exitCode: data.exitCode ?? (data.success ? 0 : 1),
          status: data.success ? 'completed' : 'failed',
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
        };

        worker.postMessage(request);

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

    const control = new Int32Array(this.stdinBuffer, 0, 4);
    const data = new Uint8Array(this.stdinBuffer, 16);
    const bytes = new TextEncoder().encode(
      input.endsWith('\n') ? input : `${input}\n`,
    );
    const writePosition = Atomics.load(control, 0);

    if (writePosition + bytes.length > data.length) {
      return;
    }

    data.set(bytes, writePosition);
    Atomics.store(control, 0, writePosition + bytes.length);
    Atomics.add(control, 3, 1);
    Atomics.notify(control, 3);
  }

  public stopCurrent(): void {
    if (this.stdinBuffer) {
      const control = new Int32Array(this.stdinBuffer, 0, 4);
      Atomics.store(control, 2, 1);
      Atomics.add(control, 3, 1);
      Atomics.notify(control, 3);
      this.stdinBuffer = null;
    }

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

    const buffer = new SharedArrayBuffer(16 + 65536);
    const control = new Int32Array(buffer, 0, 4);
    const data = new Uint8Array(buffer, 16);
    const initialBytes = new TextEncoder().encode(
      initialInput
        ? initialInput.endsWith('\n')
          ? initialInput
          : `${initialInput}\n`
        : '',
    );

    if (initialBytes.length > data.length) {
      throw new Error('C/C++ input is larger than the terminal buffer.');
    }

    data.set(initialBytes);
    Atomics.store(control, 0, initialBytes.length);
    return buffer;
  }
}

export default CompilerClient;