/**
 * Shared execution contract for the UI, runtime clients, and Web Workers.
 *
 * Keep request and event shapes centralized so C/C++, Python, diagnostics,
 * and future browser runtimes can evolve without breaking each other.
 */

export type SupportedLanguage =
  | 'c'
  | 'cpp'
  | 'python'
  | 'html'
  | 'css'
  | 'javascript'
  | 'sql'
  | 'plaintext';

export type ExecutionStatus =
  | 'idle'
  | 'preparing'
  | 'compiling'
  | 'running'
  | 'waiting-input'
  | 'completed'
  | 'failed'
  | 'stopped'
  | 'timeout'
  | 'memory-limit'
  | 'output-limit'
  | 'process-limit'
  | 'sandbox-error'
  | 'infrastructure-error';

export type OutputStream = 'stdout' | 'stderr';

export const MAX_OUTPUT_BYTES = 5 * 1024 * 1024;
export const OUTPUT_LIMIT_MESSAGE =
  '[Valton X] Output limit reached; further output was truncated.';

export type ExecutionPhase = 'compile' | 'link' | 'run';

export interface ExecutionRequest {
  fileName: string;
  code: string;
  language: SupportedLanguage;
  stdin?: string;
  stdinBuffer?: SharedArrayBuffer;
}

/**
 * Messages sent from a runtime client to a language worker.
 *
 * The legacy COMPILE_AND_RUN variant remains temporarily supported because
 * older worker integrations may still send it during the migration.
 */
export type RuntimeRequest =
  | {
      type: 'compile';
      requestId: string;
      code: string;
      language?: SupportedLanguage;
      stdin?: string;
      stdinBuffer?: SharedArrayBuffer;
    }
  | {
      type: 'stdin';
      requestId: string;
      input: string;
    }
  | {
      type: 'COMPILE_AND_RUN';
      requestId?: string;
      code?: string;
      language?: SupportedLanguage;
      stdin?: string;
      stdinBuffer?: SharedArrayBuffer;
    }
  | {
      type: 'stop';
      requestId?: string;
      stdinBuffer?: SharedArrayBuffer;
    };

export type RuntimeStreamEvent = {
  type: 'stream';
  requestId: string;
  stream: OutputStream;
  text: string;
  attempt: number;
};

export type RuntimeStatusEvent = {
  type: 'status';
  requestId: string;
  status: ExecutionStatus;
  attempt: number;
};

export type RuntimeResultEvent = {
  type: 'result';
  requestId: string;
  success: boolean;
  output: string;
  error?: string;
  warnings?: string;
  exitCode?: number | null;
  waitingForInput?: boolean;
  status: ExecutionStatus;
  phase?: ExecutionPhase;
};

export type RuntimeEvent =
  | RuntimeStreamEvent
  | RuntimeStatusEvent
  | RuntimeResultEvent;

export interface RunHooks {
  onOutput?: (
    stream: OutputStream,
    text: string,
    attempt: number,
  ) => void;
  onStatus?: (status: ExecutionStatus) => void;
}

export interface ExecutionResult {
  success: boolean;
  output: string;
  error?: string;
  warnings?: string;
  exitCode?: number | null;
  waitingForInput?: boolean;
  status: ExecutionStatus;
  phase?: ExecutionPhase;
}

export const isTerminalStatus = (
  status: ExecutionStatus,
): boolean =>
  status === 'completed' ||
  status === 'failed' ||
  status === 'stopped' ||
  status === 'timeout' ||
  status === 'memory-limit' ||
  status === 'output-limit' ||
  status === 'process-limit' ||
  status === 'sandbox-error' ||
  status === 'infrastructure-error';

export type CompileResult = ExecutionResult;