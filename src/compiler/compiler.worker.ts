/**
 * compiler.worker.ts
 *
 * Browser-native C/C++ execution worker.
 *
 * Pipeline:
 *   compiler-client → postMessage({ code, language, stdinBuffer })
 *   → browsercc.compile()   (Clang + LLD in WASM, produces a WASI module)
 *   → WASI.start()          (@bjorn3/browser_wasi_shim)
 *   → postMessage({ success, output, error, exitCode })
 *
 * stdin is read from a shared buffer so terminal input can arrive while the
 * WASI program is blocked in scanf/getchar.
 */

import { compile } from 'browsercc';
import {
  WASI,
  File,
  OpenFile,
  ConsoleStdout,
  PreopenDirectory,
} from '@bjorn3/browser_wasi_shim';

interface WorkerRequest {
  code: string;
  language: 'c' | 'cpp';
  stdinBuffer: SharedArrayBuffer;
  stdin?: string;
}

interface WorkerResponse {
  success: boolean;
  output: string;
  error?: string;
  exitCode?: number | null;
}

const decoder = new TextDecoder();

class SharedStdinFile extends OpenFile {
  private readonly control: Int32Array;
  private readonly data: Uint8Array;

  public constructor(buffer: SharedArrayBuffer) {
    super(new File(new Uint8Array(), { readonly: true }));
    this.control = new Int32Array(buffer, 0, 4);
    this.data = new Uint8Array(buffer, 16);
  }

  public override fd_read(size: number): {
    ret: number;
    data: Uint8Array;
  } {
    while (true) {
      const writePosition = Atomics.load(this.control, 0);
      const readPosition = Atomics.load(this.control, 1);

      if (readPosition < writePosition) {
        const end = Math.min(readPosition + size, writePosition);
        const chunk = this.data.slice(readPosition, end);
        Atomics.store(this.control, 1, end);
        return { ret: 0, data: chunk };
      }

      if (Atomics.load(this.control, 2) === 1) {
        return { ret: 0, data: new Uint8Array() };
      }

      const version = Atomics.load(this.control, 3);
      Atomics.wait(this.control, 3, version);
    }
  }
}

/**
 * Runs a compiled WASI module with terminal-backed stdin.
 * Returns { stdout, stderr, exitCode }.
 */
const runWasiModule = (
  module: WebAssembly.Module,
  stdinBuffer: SharedArrayBuffer,
): { stdout: string; stderr: string; exitCode: number } => {
  let stdoutBuf = '';
  let stderrBuf = '';

  const fds = [
    // fd 0 – stdin: terminal-backed shared input
    new SharedStdinFile(stdinBuffer),
    // fd 1 – stdout
    new ConsoleStdout((chunk: Uint8Array) => {
      stdoutBuf += decoder.decode(chunk);
    }),
    // fd 2 – stderr
    new ConsoleStdout((chunk: Uint8Array) => {
      stderrBuf += decoder.decode(chunk);
    }),
    // fd 3 – preopened '.' directory (required by many C runtimes)
    new PreopenDirectory('.', new Map()),
  ];

  const wasi = new WASI([], [], fds);

  let exitCode: number;
  try {
    const instance = new WebAssembly.Instance(module, {
      wasi_snapshot_preview1: wasi.wasiImport,
    });

    const typedInstance = instance as {
      exports: { memory: WebAssembly.Memory; _start: () => unknown };
    };

    exitCode = wasi.start(typedInstance) ?? 0;
  } catch (error: unknown) {
    // WASIProcExit is the normal path for programs that call exit(n).
    const name = error instanceof Error ? error.constructor.name : '';
    const code =
      error instanceof Error &&
      'code' in error &&
      typeof (error as { code: unknown }).code === 'number'
        ? (error as { code: number }).code
        : 1;

    if (name === 'WASIProcExit') {
      exitCode = code;
    } else {
      // Genuine runtime crash – record message in stderr
      const msg =
        error instanceof Error ? error.message : String(error);
      stderrBuf += `\n[Runtime error] ${msg}`;
      exitCode = 1;
    }
  }

  return { stdout: stdoutBuf, stderr: stderrBuf, exitCode };
};

self.onmessage = async (
  event: MessageEvent<WorkerRequest>,
): Promise<void> => {
  const { code, language, stdinBuffer } = event.data;

  const fileName =
    language === 'cpp' ? 'main.cpp' : 'main.c';

  // Compiler flags: C99 for .c, C++17 for .cpp
  const flags =
    language === 'cpp'
      ? [
          '-x',
          'c++',
          '-std=c++17',
          '-O1',
          '-Wall',
          '-fno-exceptions',
        ]
      : ['-x', 'c++', '-std=c++17', '-O1', '-Wall'];

  let compileResult: { compileOutput: string; module: WebAssembly.Module | null };

  try {
    const result = await compile({ source: code, fileName, flags });
    compileResult = {
      compileOutput: result.compileOutput ?? '',
      module: result.module,
    };
  } catch (error: unknown) {
    const msg =
      error instanceof Error ? error.message : String(error);
    const response: WorkerResponse = {
      success: false,
      output: '',
      error: `[Compiler internal error] ${msg}`,
      exitCode: null,
    };
    self.postMessage(response);
    return;
  }

  const { compileOutput, module } = compileResult;

  // Compilation failed (module is null) – send compiler diagnostics.
  if (!module) {
    const response: WorkerResponse = {
      success: false,
      output: compileOutput,
      error: compileOutput || 'Compilation failed with no diagnostic output.',
      exitCode: null,
    };
    self.postMessage(response);
    return;
  }

  // Compilation succeeded – execute with WASI.
  const { stdout, stderr, exitCode } = runWasiModule(
    module,
    stdinBuffer,
  );

  // Combine stdout + stderr into a single output string so the terminal
  // receives them in a reasonable order.  stderr is appended after stdout
  // unless stdout is empty, in which case only stderr is shown.
  const combinedOutput = stderr
    ? stdout
      ? `${stdout}\n[stderr]\n${stderr}`
      : stderr
    : stdout;

  const response: WorkerResponse = {
    success: exitCode === 0,
    output: combinedOutput,
    error: exitCode !== 0 ? (stderr || compileOutput || 'Non-zero exit code.') : undefined,
    exitCode,
  };

  self.postMessage(response);
};