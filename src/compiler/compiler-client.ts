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
  /** Upfront/prepared stdin (newline-separated lines). NOT live interactive stdin. */
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
 * stdin is passed upfront before execution – true interactive stdin is not
 * available via the browser WASM path.
 */
export class CompilerClient {
  /** Currently active worker (null when idle). */
  private worker: Worker | null = null;
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
        const request: CWorkerRequest = {
          code,
          language: (language === 'cpp' ? 'cpp' : 'c') as 'c' | 'cpp',
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

  /** stdin is upfront – live input is not available via the browser C runtime. */
  public sendInput(_input: string): void {
    // No-op: C/C++ stdin is provided before execution, not during.
  }

  public stopCurrent(): void {
    this.worker?.terminate();
    this.worker = null;
    this.activeRequest = false;
  }

  public terminate(): void {
    this.stopCurrent();
  }
}

export default CompilerClient;