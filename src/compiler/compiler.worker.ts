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

import {
  Clang,
  LLD,
  compile,
  setUpSysroot,
} from 'browsercc';
import sysrootUrl from 'browsercc/dist/sysroot.tar?url';
import {
  WASI,
  File,
  OpenFile,
  ConsoleStdout,
  PreopenDirectory,
} from '@bjorn3/browser_wasi_shim';
import {
  closeSharedStdin,
  getSharedStdin,
  readSharedStdin,
  STDIN_ABORTED,
  STDIN_CLOSED,
} from './shared-stdin';
import {
  MAX_OUTPUT_BYTES,
  OUTPUT_LIMIT_MESSAGE,
} from './execution-protocol';

interface WorkerRequest {
  code: string;
  language: 'c' | 'cpp';
  stdinBuffer: SharedArrayBuffer;
  stdin?: string;
  requestId: string;
}

interface WorkerResponse {
  type?: 'stream' | 'result';
  requestId?: string;
  stream?: 'stdout' | 'stderr';
  text?: string;
  attempt?: number;
  status?: 'completed' | 'failed' | 'output-limit';
  success?: boolean;
  output?: string;
  error?: string;
  exitCode?: number | null;
}

interface CompilerInvocation {
  compilerArgs: string[];
  compilerArtifact: string;
  linkerArgs: string[];
  linerArtifact: string;
}

const CONIO_COMPAT_HEADER = `
#ifndef VALTON_X_CONIO_H
#define VALTON_X_CONIO_H

#include <stdio.h>

#define BLACK 0
#define BLUE 1
#define GREEN 2
#define CYAN 3
#define RED 4
#define MAGENTA 5
#define BROWN 6
#define LIGHTGRAY 7
#define DARKGRAY 8
#define LIGHTBLUE 9
#define LIGHTGREEN 10
#define LIGHTCYAN 11
#define LIGHTRED 12
#define LIGHTMAGENTA 13
#define YELLOW 14
#define WHITE 15

static inline int getch(void) {
  return getchar();
}

static inline int getche(void) {
  int character = getchar();
  if (character != EOF) {
    putchar(character);
  }
  return character;
}

static inline int kbhit(void) {
  return 0;
}

static inline void clrscr(void) {
  fputs("\\033[2J\\033[H", stdout);
}

static inline void gotoxy(int column, int row) {
  (void)column;
  (void)row;
}

static inline void textcolor(int color) {
  (void)color;
}

static inline void textbackground(int color) {
  (void)color;
}

#define cprintf printf
#define cputs puts
#define putch putchar

#endif
`;

const C_EXTRA_FILES = {
  '/include/conio.h': CONIO_COMPAT_HEADER,
};

const getCCompilerInvocation = async (
  fileName: string,
  source: string,
  flags: string[],
  sysroot: ArrayBuffer,
): Promise<CompilerInvocation> => {
  let stderr = '';
  const clang = await Clang({
    thisProgram: 'clang',
    printErr: (data: string) => {
      stderr += `${data}\n`;
    },
  });

  clang.FS.writeFile(fileName, source);
  setUpSysroot(clang, sysroot, C_EXTRA_FILES);
  clang.FS.mkdirTree('/lib/wasm32-wasi');
  clang.FS.mkdirTree('/include/c++/v1');
  clang.FS.writeFile(
    '/lib/wasm32-wasi/crt1-command.o',
    new Uint8Array(0),
  );
  clang.FS.writeFile(
    '/lib/wasm32-wasi/crt1-reactor.o',
    new Uint8Array(0),
  );

  const exitCode = clang.callMain([
    fileName,
    ...flags,
    '-###',
  ]);

  if (exitCode !== 0) {
    throw new Error(
      stderr || `Clang driver failed with code ${exitCode}.`,
    );
  }

  const lines = stderr.split('\n');
  const getArgs = (key: string): {
    args: string[];
    outputFileName: string;
  } => {
    const line = lines.find((entry) => entry.includes(key)) ?? '';
    const args = (line.match(/"([^"]*)"/g) ?? [])
      .map((value) => value.slice(1, -1))
      .slice(1);
    const outputIndex = args.findIndex(
      (arg) => arg === '-o',
    );

    return {
      args,
      outputFileName: args[outputIndex + 1] ?? '',
    };
  };

  const compiler = getArgs('-cc1');
  const linker = getArgs('wasm-ld');

  return {
    compilerArgs: compiler.args,
    compilerArtifact: compiler.outputFileName,
    linkerArgs: linker.args,
    linerArtifact: linker.outputFileName,
  };
};

const compileC = async (
  source: string,
  fileName: string,
  flags: string[],
): Promise<{ compileOutput: string; module: WebAssembly.Module | null }> => {
  let stderr = '';
  const clangPromise = Clang({
    thisProgram: 'clang',
    printErr: (data: string) => {
      stderr += `${data}\n`;
    },
  });
  const lldPromise = LLD({
    thisProgram: 'wasm-ld',
    printErr: (data: string) => {
      stderr += `${data}\n`;
    },
  });
  const sysroot = await (await fetch(sysrootUrl)).arrayBuffer();
  const invocation = await getCCompilerInvocation(
    fileName,
    source,
    flags,
    sysroot,
  );
  const clang = await clangPromise;

  clang.FS.writeFile(fileName, source);
  setUpSysroot(clang, sysroot, C_EXTRA_FILES);

  if (clang.callMain(invocation.compilerArgs) !== 0) {
    return { compileOutput: stderr, module: null };
  }

  const binary = clang.FS.readFile(
    invocation.compilerArtifact,
    { encoding: 'binary' },
  );
  const lld = await lldPromise;

  lld.FS.writeFile(invocation.compilerArtifact, binary);
  setUpSysroot(lld, sysroot, C_EXTRA_FILES);

  if (lld.callMain(invocation.linkerArgs) !== 0) {
    return { compileOutput: stderr, module: null };
  }

  const output = lld.FS.readFile(
    invocation.linerArtifact,
    { encoding: 'binary' },
  );

  return {
    compileOutput: stderr,
    module: await WebAssembly.compile(output),
  };
};

class SharedStdinFile extends OpenFile {
  private readonly stdin: ReturnType<typeof getSharedStdin>;

  public constructor(buffer: SharedArrayBuffer) {
    super(new File(new Uint8Array(), { readonly: true }));
    this.stdin = getSharedStdin(buffer);
  }

  public override fd_read(size: number): {
    ret: number;
    data: Uint8Array;
  } {
    while (true) {
      if (Atomics.load(this.stdin.control, 4) > 0) {
        return {
          ret: 0,
          data: readSharedStdin(this.stdin, size),
        };
      }

      const state = Atomics.load(this.stdin.control, 2);
      if (state === STDIN_CLOSED || state === STDIN_ABORTED) {
        return { ret: 0, data: new Uint8Array() };
      }

      const version = Atomics.load(this.stdin.control, 3);
      Atomics.wait(this.stdin.control, 3, version);
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
  requestId: string,
): {
  stdout: string;
  stderr: string;
  exitCode: number;
  outputLimitReached: boolean;
} => {
  let stdoutBuf = '';
  let stderrBuf = '';
  let outputBytes = 0;
  let outputLimitReached = false;
  const stdoutDecoder = new TextDecoder();
  const stderrDecoder = new TextDecoder();

  const emit = (
    stream: 'stdout' | 'stderr',
    text: string,
  ): void => {
    if (!text || outputLimitReached) {
      return;
    }
    const bytes = new TextEncoder().encode(text);
    const remaining = MAX_OUTPUT_BYTES - outputBytes;
    const visible = bytes.length <= remaining
      ? text
      : new TextDecoder().decode(bytes.slice(0, remaining));
    outputBytes += new TextEncoder().encode(visible).length;
    if (visible) {
      self.postMessage({
        type: 'stream',
        requestId,
        stream,
        text: visible,
        attempt: 1,
      } satisfies WorkerResponse);
    }
    if (visible.length < text.length || outputBytes >= MAX_OUTPUT_BYTES) {
      outputLimitReached = true;
      self.postMessage({
        type: 'stream',
        requestId,
        stream: 'stderr',
        text: `\n${OUTPUT_LIMIT_MESSAGE}\n`,
        attempt: 1,
      } satisfies WorkerResponse);
    }
  };

  const fds = [
    // fd 0 – stdin: terminal-backed shared input
    new SharedStdinFile(stdinBuffer),
    // fd 1 – stdout
    new ConsoleStdout((chunk: Uint8Array) => {
      const text = stdoutDecoder.decode(chunk, { stream: true });
      if (!outputLimitReached) stdoutBuf += text;
      emit('stdout', text);
    }),
    // fd 2 – stderr
    new ConsoleStdout((chunk: Uint8Array) => {
      const text = stderrDecoder.decode(chunk, { stream: true });
      if (!outputLimitReached) stderrBuf += text;
      emit('stderr', text);
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

  const remainingStdout = stdoutDecoder.decode();
  const remainingStderr = stderrDecoder.decode();
  if (remainingStdout) {
    stdoutBuf += remainingStdout;
    emit('stdout', remainingStdout);
  }
  if (remainingStderr) {
    stderrBuf += remainingStderr;
    emit('stderr', remainingStderr);
  }

  return {
    stdout: stdoutBuf,
    stderr: stderrBuf,
    exitCode,
    outputLimitReached,
  };
};

self.onmessage = async (
  event: MessageEvent<WorkerRequest>,
): Promise<void> => {
  const { code, language, stdinBuffer, requestId } = event.data;

  const fileName =
    language === 'cpp' ? 'main.cpp' : 'main.c';

  // Compiler flags: C99 for .c, C++17 for .cpp
  const flags =
    language === 'cpp'
      ? [
          '--target=wasm32-wasi',
          '--sysroot=/',
          '-x',
          'c++',
          '-std=c++17',
          '-O1',
          '-Wall',
          '-fno-exceptions',
        ]
      : [
          '--target=wasm32-wasi',
          '--sysroot=/',
          '-x',
          'c',
          '-std=c17',
          '-O1',
          '-Wall',
        ];

  let compileResult: { compileOutput: string; module: WebAssembly.Module | null };

  try {
    const result =
      language === 'c'
        ? await compileC(code, fileName, flags)
        : await compile({ source: code, fileName, flags });
    compileResult = {
      compileOutput: result.compileOutput ?? '',
      module: result.module,
    };
  } catch (error: unknown) {
    const msg =
      error instanceof Error ? error.message : String(error);
    const response: WorkerResponse = {
      type: 'result',
      requestId,
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
      type: 'result',
      requestId,
      success: false,
      output: compileOutput,
      error: compileOutput || 'Compilation failed with no diagnostic output.',
      exitCode: null,
    };
    self.postMessage(response);
    return;
  }

  // Compilation succeeded – execute with WASI.
  let executionResult: {
    stdout: string;
    stderr: string;
    exitCode: number;
    outputLimitReached: boolean;
  };

  try {
    executionResult = runWasiModule(
      module,
      stdinBuffer,
      requestId,
    );
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : String(error);

    self.postMessage({
      type: 'result',
      requestId,
      success: false,
      output: '',
      error: `[C/C++ runtime error] ${message}`,
      exitCode: null,
    } satisfies WorkerResponse);
    return;
  }

  const {
    stdout,
    stderr,
    exitCode,
    outputLimitReached,
  } = executionResult;

  // Combine stdout + stderr into a single output string so the terminal
  // receives them in a reasonable order.  stderr is appended after stdout
  // unless stdout is empty, in which case only stderr is shown.
  const combinedOutput = stderr
    ? stdout
      ? `${stdout}\n[stderr]\n${stderr}`
      : stderr
    : stdout;

  const response: WorkerResponse = {
    type: 'result',
    requestId,
    success: exitCode === 0,
    output: outputLimitReached
      ? OUTPUT_LIMIT_MESSAGE
      : combinedOutput,
    error: outputLimitReached
      ? OUTPUT_LIMIT_MESSAGE
      : exitCode !== 0
        ? (stderr || compileOutput || 'Non-zero exit code.')
        : undefined,
    status: outputLimitReached
      ? 'output-limit'
      : exitCode === 0
        ? 'completed'
        : 'failed',
    exitCode,
  };

  self.postMessage(response);




};

// ==== NEW: stop handling ==== //
self.addEventListener(
  'message',
  (event: MessageEvent<{ type?: string; stdinBuffer?: SharedArrayBuffer }>) => {
  if (event.data.type === 'stop') {
    const buffer = event.data.stdinBuffer;
    if (buffer) {
      closeSharedStdin(
        getSharedStdin(buffer),
        STDIN_ABORTED,
      );
    }
  }
  },
);