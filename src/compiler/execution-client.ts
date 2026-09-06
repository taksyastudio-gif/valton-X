import { CompilerClient } from './compiler-client';
import { PythonClient } from './python-client';

import type {
  ExecutionRequest,
  ExecutionResult,
  ExecutionStatus,
  SupportedLanguage,
} from './execution-protocol';

export interface ExecutionCallbacks {
  onOutput?: (
    stream: 'stdout' | 'stderr',
    text: string,
    attempt: number,
  ) => void;
  onStatus?: (status: ExecutionStatus) => void;
}

/**
 * Central browser execution boundary.
 *
 * The UI talks only to this class. It decides which worker should receive a
 * request and exposes terminal input/stop controls without leaking worker
 * details into React components.
 */
export class ExecutionClient {
  private readonly compilerClient: CompilerClient;
  private readonly pythonClient: PythonClient;

  private activeLanguage: SupportedLanguage | null = null;
  private activeFileName = '';
  private activeRequest = false;

  constructor() {
    this.compilerClient = new CompilerClient();
    this.pythonClient = new PythonClient();
  }

  public async execute(
    request: ExecutionRequest,
    callbacks?: ExecutionCallbacks,
  ): Promise<ExecutionResult> {
    const normalizedLanguage = this.normalizeLanguage(
      request.language,
      request.fileName,
    );

    this.activeLanguage = normalizedLanguage;
    this.activeFileName = request.fileName;
    this.activeRequest = true;

    callbacks?.onStatus?.('preparing');

    try {
      let result: ExecutionResult;

      switch (normalizedLanguage) {
        case 'c':
        case 'cpp':
          callbacks?.onStatus?.('compiling');

          result = await this.compilerClient.compileAndRun(
            request.code,
            normalizedLanguage,
            request.stdin ?? '',
            callbacks,
          );
          break;

        case 'python':
          callbacks?.onStatus?.('running');

          result = await this.pythonClient.runPython(
            request.code,
            request.stdin ?? '',
            callbacks,
          );
          break;

        case 'html':
        case 'css':
        case 'javascript':
          result = {
            success: true,
            output: `[Valton X] ${request.fileName} is ready in the Live Preview panel.`,
            exitCode: 0,
            status: 'completed',
            phase: 'run',
          };
          break;

        default:
          result = {
            success: false,
            output: `[Execution Error] Unsupported language: "${request.language}".`,
            error: `Unsupported language: ${request.language}`,
            exitCode: 1,
            status: 'failed',
            phase: 'run',
          };
      }

      if (
        result.status !== 'waiting-input' &&
        result.waitingForInput !== true
      ) {
        this.activeRequest = false;
        this.activeLanguage = null;
        this.activeFileName = '';
      }

      return result;
    } catch (error: unknown) {
      const message = this.getErrorMessage(error);

      this.activeRequest = false;

      return {
        success: false,
        output: `[Runtime Error] ${message}`,
        error: message,
        exitCode: 1,
        status: 'failed',
        phase: 'run',
      };
    }
  }

  /**
   * Sends one completed terminal line to the active worker.
   */
  public sendInput(input: string): boolean {
    if (!this.activeRequest || !this.activeLanguage) {
      return false;
    }

    const value = input.endsWith('\n')
      ? input
      : `${input}\n`;

    if (
      this.activeLanguage === 'c' ||
      this.activeLanguage === 'cpp'
    ) {
      this.compilerClient.sendInput(value);
      return true;
    }

    if (this.activeLanguage === 'python') {
      this.pythonClient.sendInput(value);
      return true;
    }

    return false;
  }

  /**
   * Stops the active worker execution.
   */
  public stop(): void {
    if (!this.activeRequest) {
      return;
    }

    this.compilerClient.stopCurrent();
    this.pythonClient.stopCurrent();

    this.activeRequest = false;
    this.activeLanguage = null;
    this.activeFileName = '';
  }

  public isExecuting(): boolean {
    return this.activeRequest;
  }

  public getActiveFileName(): string {
    return this.activeFileName;
  }

  private normalizeLanguage(
    language: SupportedLanguage,
    fileName: string,
  ): SupportedLanguage {
    const extension = fileName
      .split('.')
      .pop()
      ?.toLowerCase();

    switch (extension) {
      case 'c':
        return 'c';

      case 'cc':
      case 'cpp':
      case 'cxx':
      case 'h':
      case 'hh':
      case 'hpp':
        return 'cpp';

      case 'py':
        return 'python';

      case 'html':
      case 'htm':
        return 'html';

      case 'css':
        return 'css';

      case 'js':
      case 'jsx':
      case 'mjs':
      case 'cjs':
      case 'ts':
      case 'tsx':
        return 'javascript';

      case 'sql':
        return 'sql';

      default:
        return language;
    }
  }

  private getErrorMessage(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }

    if (typeof error === 'string') {
      return error;
    }

    return 'Execution failed because the runtime returned an unknown error.';
  }

  public terminate(): void {
    this.activeRequest = false;
    this.activeLanguage = null;
    this.activeFileName = '';

    this.compilerClient.terminate();
    this.pythonClient.terminate();
  }
}