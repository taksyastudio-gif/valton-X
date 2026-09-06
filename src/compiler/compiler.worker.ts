/**
 * compiler.worker.ts
 *
 * Browser-native C/C++ execution worker.
 *
 * Pipeline:
 *   compiler-client → postMessage({ code, language, stdin })
 *   → browsercc.compile()   (Clang + LLD in WASM, produces a WASI module)
 *   → WASI.start()          (@bjorn3/browser_wasi_shim)
 *   → postMessage({ success, output, error, exitCode })
 *
 * stdin is upfront/prepared — it is provided before execution begins.
 * This is NOT live/interactive stdin. The UI must represent it accordingly.
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
  /** Upfront/prepared stdin content (newline-separated lines). */
  stdin?: string;
}

interface WorkerResponse {
  success: boolean;
  output: string;
  error?: string;
  exitCode?: number | null;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/**
 * Runs a compiled WASI module with the provided stdin.
 * Returns { stdout, stderr, exitCode }.
 */
const runWasiModule = (
  module: WebAssembly.Module,
  stdin: string,
): { stdout: string; stderr: string; exitCode: number } => {
  let stdoutBuf = '';
  let stderrBuf = '';

  const stdinBytes = encoder.encode(stdin.endsWith('\n') ? stdin : `${stdin}\n`);

  const fds = [
    // fd 0 – stdin: prepared input file
    new OpenFile(new File(stdinBytes)),
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
  const { code, language, stdin = '' } = event.data;

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
  const { stdout, stderr, exitCode } = runWasiModule(module, stdin);

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