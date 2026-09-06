import { ErrorInterpreter } from './error-interpreter';
import type {
  ExecutionResult,
  RuntimeEvent,
} from './execution-protocol';
import type { ExecutionCallbacks } from './execution-client';

interface PendingExecution {
  resolve: (result: ExecutionResult) => void;
  callbacks?: ExecutionCallbacks;
}

const EXECUTION_TIMEOUT_MS = 30000;

/**
 * Owns the dedicated Pyodide Web Worker.
 *
 * Input requests keep the original execution pending so the terminal can
 * continue the same logical run instead of starting a second run.
 */
export class PythonClient {
  private worker: Worker | null = null;
  private activeRequestId: string | null = null;
  private pendingExecution: PendingExecution | null = null;

  constructor() {
    this.initializeWorker();
  }

  private initializeWorker(): void {
    if (typeof Worker === 'undefined') {
      return;
    }

    try {
      this.worker = new Worker(
        new URL('./python.worker.ts', import.meta.url),
        { type: 'module' },
      );

      this.worker.addEventListener(
        'message',
        (event: MessageEvent<RuntimeEvent>) => {
          this.handleWorkerEvent(event.data);
        },
      );

      this.worker.addEventListener('error', (event) => {
        this.resolveWorkerFailure(
          event.message ||
            'The Python worker stopped unexpectedly.',
        );
      });
    } catch (error: unknown) {
      this.worker = null;

      const message =
        error instanceof Error
          ? error.message
          : 'Unable to initialize the Python worker.';

      console.error(
        'Python worker initialization failed:',
        message,
      );
    }
  }

  public runPython(
    code: string,
    stdin = '',
    callbacks?: ExecutionCallbacks,
  ): Promise<ExecutionResult> {
    if (this.pendingExecution) {
      return Promise.resolve({
        success: false,
        output:
          '[Execution Error] A Python program is already running. Stop it before starting another run.',
        error: 'A Python execution is already active.',
        exitCode: null,
        status: 'failed',
        phase: 'run',
      });
    }

    if (!this.worker) {
      return Promise.resolve({
        success: false,
        output:
          '[Execution Error] The Pyodide worker is unavailable. Refresh the page and try again.',
        error: 'Python worker is unavailable.',
        exitCode: null,
        status: 'infrastructure-error',
        phase: 'run',
      });
    }

    const requestId = this.createRequestId();

    return new Promise<ExecutionResult>((resolve) => {
      const timeoutId = setTimeout(() => {
        if (
          this.activeRequestId !== requestId ||
          !this.pendingExecution
        ) {
          return;
        }

        const pendingExecution = this.pendingExecution;
        this.pendingExecution = null;
        this.activeRequestId = null;
        this.worker?.terminate();
        this.worker = null;
        this.initializeWorker();

        pendingExecution.callbacks?.onStatus?.('timeout');
        pendingExecution.resolve({
          success: false,
          output: '',
          error: `Execution timed out after ${EXECUTION_TIMEOUT_MS / 1000} seconds.`,
          exitCode: null,
          status: 'timeout',
          phase: 'run',
        });
      }, EXECUTION_TIMEOUT_MS);

      this.activeRequestId = requestId;
      this.pendingExecution = {
        resolve: (result) => {
          clearTimeout(timeoutId);
          resolve(result);
        },
        callbacks,
      };

      try {
        this.worker?.postMessage({
          type: 'compile',
          requestId,
          code,
          stdin,
          language: 'python',
        });
      } catch (error: unknown) {
        const message =
          error instanceof Error
            ? error.message
            : 'Unable to send the program to the Python worker.';

        this.resolveWorkerFailure(message);
      }
    });
  }

  public sendInput(input: string): void {
    if (
      !this.worker ||
      !this.activeRequestId ||
      !this.pendingExecution
    ) {
      return;
    }

    try {
      this.worker.postMessage({
        type: 'stdin',
        requestId: this.activeRequestId,
        input,
      });
    } catch (error: unknown) {
      const message =
        error instanceof Error
          ? error.message
          : 'Unable to send input to the Python worker.';

      this.resolveWorkerFailure(message);
    }
  }

  public stopCurrent(): void {
    if (!this.pendingExecution) {
      return;
    }

    const pendingExecution = this.pendingExecution;

    this.pendingExecution = null;
    this.activeRequestId = null;

    pendingExecution.resolve({
      success: false,
      output: '[Valton X] Execution stopped.',
      error: 'Execution stopped by the user.',
      exitCode: null,
      status: 'stopped',
      phase: 'run',
    });

    this.worker?.terminate();
    this.worker = null;
    this.initializeWorker();
  }

  private handleWorkerEvent(event: RuntimeEvent): void {
    const pendingExecution = this.pendingExecution;

    if (
      !pendingExecution ||
      !this.activeRequestId ||
      event.requestId !== this.activeRequestId
    ) {
      return;
    }

    if (event.type === 'stream') {
      pendingExecution.callbacks?.onOutput?.(
        event.stream,
        event.text,
        event.attempt,
      );
      return;
    }

    if (event.type === 'status') {
      pendingExecution.callbacks?.onStatus?.(event.status);
      return;
    }

    const result = this.createExecutionResult(event);

    pendingExecution.callbacks?.onStatus?.(result.status);

    if (event.waitingForInput) {
      pendingExecution.callbacks?.onStatus?.('waiting-input');
      return;
    }

    this.pendingExecution = null;
    this.activeRequestId = null;
    pendingExecution.resolve(result);
  }

  private createExecutionResult(
    event: Extract<RuntimeEvent, { type: 'result' }>,
  ): ExecutionResult {
    if (event.success) {
      return {
        success: true,
        output:
          event.output || 'Program completed with no output.',
        error: event.error,
        warnings: event.warnings,
        exitCode: event.exitCode ?? 0,
        waitingForInput: event.waitingForInput ?? false,
        status: event.status,
        phase: event.phase ?? 'run',
      };
    }

    const rawError = event.error || event.output;
    const insight = ErrorInterpreter.parse(
      rawError,
      'python',
    );

    const friendlyOutput = [
      `${insight.emoji} ${insight.humorousTitle}`,
      '',
      `What happened: ${insight.friendlyExplanation}`,
      `Quick fix: ${insight.suggestedFix}`,
      '',
      '---------------- Raw Python Output ----------------',
      rawError,
    ].join('\n');

    return {
      success: false,
      output: event.waitingForInput
        ? event.output
        : friendlyOutput,
      error: rawError,
      warnings: event.warnings,
      exitCode: event.exitCode ?? 1,
      waitingForInput: event.waitingForInput ?? false,
      status: event.status,
      phase: event.phase ?? 'run',
    };
  }

  private resolveWorkerFailure(message: string): void {
    if (!this.pendingExecution) {
      return;
    }

    const pendingExecution = this.pendingExecution;

    this.pendingExecution = null;
    this.activeRequestId = null;

    pendingExecution.callbacks?.onStatus?.(
      'infrastructure-error',
    );

    pendingExecution.resolve({
      success: false,
      output: `[Python Worker Error] ${message}`,
      error: message,
      exitCode: null,
      status: 'infrastructure-error',
      phase: 'run',
    });
  }

  private createRequestId(): string {
    if (
      typeof crypto !== 'undefined' &&
      'randomUUID' in crypto
    ) {
      return crypto.randomUUID();
    }

    return `python-run-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2)}`;
  }

  public terminate(): void {
    this.resolveWorkerFailure(
      'Python execution was stopped by the application.',
    );

    this.worker?.terminate();
    this.worker = null;
  }
}

export default PythonClient;