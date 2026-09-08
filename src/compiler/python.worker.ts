import type {
  ExecutionPhase,
  ExecutionStatus,
  OutputStream,
  RuntimeEvent,
  RuntimeRequest,
} from './execution-protocol';
import type { loadPyodide } from 'pyodide';
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

const PYODIDE_BASE_URL = '/pyodide/';
const SQLITE_PACKAGE_NAME = 'sqlite3';
const SQLITE_PACKAGE_URL =
  `${PYODIDE_BASE_URL}sqlite3-1.0.0.zip`;
const STDIN_REQUIRED_MARKER = '__FORGEBYTEX_STDIN_REQUIRED__';

type LoadPyodide = typeof loadPyodide;
type PyodideRuntime = Awaited<ReturnType<LoadPyodide>>;

interface ExecutionSession {
  code: string;
  stdin: string;
  stdinBuffer?: SharedArrayBuffer;
  attempt: number;
}

interface PythonRunResult {
  success: boolean;
  output: string;
  error?: string;
  exitCode?: number | null;
  waitingForInput?: boolean;
  status: ExecutionStatus;
  phase: ExecutionPhase;
}

let loadPyodideFunction: LoadPyodide | null = null;
let pyodidePromise: Promise<PyodideRuntime> | null = null;
let executionQueue: Promise<void> = Promise.resolve();

const executionSessions = new Map<string, ExecutionSession>();

class StdinRequiredError extends Error {
  constructor() {
    super(STDIN_REQUIRED_MARKER);
    this.name = 'StdinRequiredError';
  }
}

const postEvent = (event: RuntimeEvent): void => {
  self.postMessage(event);
};

const postStatus = (
  requestId: string,
  status: ExecutionStatus,
  attempt: number,
): void => {
  postEvent({
    type: 'status',
    requestId,
    status,
    attempt,
  });
};

const postStream = (
  requestId: string,
  stream: OutputStream,
  text: string,
  attempt: number,
): void => {
  if (!text) {
    return;
  }

  postEvent({
    type: 'stream',
    requestId,
    stream,
    text,
    attempt,
  });
};

const enqueueExecution = (task: () => Promise<void>): void => {
  executionQueue = executionQueue.then(task, task);
};

const getLoadPyodide = async (): Promise<LoadPyodide> => {
  if (loadPyodideFunction) {
    return loadPyodideFunction;
  }

  const response = await fetch(`${PYODIDE_BASE_URL}pyodide.mjs`);

  if (!response.ok) {
    throw new Error(
      `Unable to load local Pyodide runtime (${response.status}).`,
    );
  }

  const source = await response.text();
  const moduleUrl = URL.createObjectURL(
    new Blob([source], { type: 'text/javascript' }),
  );

  try {
    const module = (await import(
      /* @vite-ignore */
      moduleUrl
    )) as { loadPyodide: LoadPyodide };

    loadPyodideFunction = module.loadPyodide;
    return loadPyodideFunction;
  } finally {
    URL.revokeObjectURL(moduleUrl);
  }
};

const getPyodideRuntime = async (): Promise<PyodideRuntime> => {
  if (!pyodidePromise) {
    pyodidePromise = (async () => {
      const loadPyodide = await getLoadPyodide();

      return loadPyodide({
        indexURL: PYODIDE_BASE_URL,
      });
    })().catch((error: unknown) => {
      pyodidePromise = null;
      throw error;
    });
  }

  return pyodidePromise;
};

const ensurePythonPackages = async (
  pyodide: PyodideRuntime,
  code: string,
): Promise<void> => {
  // Pyodide keeps sqlite3 outside the standard library bundle. Load it only
  // for programs that request it so normal Python startup stays fast.
  if (!/\b(?:import\s+sqlite3|from\s+sqlite3\s+import)\b/.test(code)) {
    return;
  }

  try {
    await pyodide.loadPackage(SQLITE_PACKAGE_NAME);
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : String(error);

    throw new Error(
      `The local SQLite package could not be loaded. ` +
      `Make sure ${SQLITE_PACKAGE_URL} is deployed. ${message}`,
      { cause: error },
    );
  }
};

class SharedStdinReader {
  private readonly stdin: ReturnType<typeof getSharedStdin>;
  private readonly decoder = new TextDecoder();
  private bufferedText = '';

  constructor(buffer: SharedArrayBuffer) {
    this.stdin = getSharedStdin(buffer);
  }

  public readLine(): string {
    while (true) {
      const bufferedNewline = this.bufferedText.indexOf('\n');
      if (bufferedNewline >= 0) {
        const line = this.bufferedText.slice(0, bufferedNewline);
        this.bufferedText = this.bufferedText.slice(
          bufferedNewline + 1,
        );
        return line;
      }

      const available = Atomics.load(this.stdin.control, 4);
      if (available > 0) {
        const chunk = readSharedStdin(this.stdin, available);
        this.bufferedText += this.decoder.decode(chunk);
        continue;
      }

      const state = Atomics.load(this.stdin.control, 2);
      if (state === STDIN_CLOSED || state === STDIN_ABORTED) {
        const remaining = this.bufferedText;
        this.bufferedText = '';
        return remaining;
      }

      const version = Atomics.load(this.stdin.control, 3);
      Atomics.wait(this.stdin.control, 3, version);
    }
  }
}

const runPython = async (
  requestId: string,
  session: ExecutionSession,
): Promise<PythonRunResult> => {
  const attempt = session.attempt;
  const pyodide = await getPyodideRuntime();
  await ensurePythonPackages(pyodide, session.code);
  const outputChunks: string[] = [];
  let outputBytes = 0;
  let outputLimitReached = false;
  const sharedStdin = session.stdinBuffer
    ? new SharedStdinReader(session.stdinBuffer)
    : null;

  let stdinOffset = 0;
  let stdinRequested = false;

  const emit = (stream: OutputStream, text: string): void => {
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
      outputChunks.push(visible);
      postStream(requestId, stream, visible, attempt);
    }
    if (visible.length < text.length || outputBytes >= MAX_OUTPUT_BYTES) {
      outputLimitReached = true;
      postStream(
        requestId,
        'stderr',
        `\n${OUTPUT_LIMIT_MESSAGE}\n`,
        attempt,
      );
    }
  };

  pyodide.setStdout({
    batched: (text: string) => emit('stdout', text),
  });

  pyodide.setStderr({
    batched: (text: string) => {
      if (!text.includes(STDIN_REQUIRED_MARKER)) {
        emit('stderr', text);
      }
    },
  });

  pyodide.setStdin({
    stdin: () => {
      stdinRequested = true;

      if (sharedStdin) {
        return sharedStdin.readLine();
      }

      if (stdinOffset < session.stdin.length) {
        const newlineIndex = session.stdin.indexOf('\n', stdinOffset);

        if (newlineIndex === -1) {
          const remaining = session.stdin.slice(stdinOffset);
          stdinOffset = session.stdin.length;
          return remaining;
        }

        const line = session.stdin.slice(stdinOffset, newlineIndex);
        stdinOffset = newlineIndex + 1;
        return line;
      }

      throw new StdinRequiredError();
    },
  });

  postStatus(requestId, 'running', attempt);

  const globals = pyodide.toPy({});

  try {
    const result = await pyodide.runPythonAsync(session.code, {
      globals,
      locals: globals,
    });

    if (
      result !== undefined &&
      result !== null &&
      String(result) !== 'None'
    ) {
      const value = `${String(result)}\n`;
      emit('stdout', value);
    }

    return {
      success: !outputLimitReached,
      output: outputLimitReached
        ? OUTPUT_LIMIT_MESSAGE
        : outputChunks.join(''),
      error: outputLimitReached
        ? OUTPUT_LIMIT_MESSAGE
        : undefined,
      exitCode: outputLimitReached ? 1 : 0,
      waitingForInput: false,
      status: outputLimitReached ? 'output-limit' : 'completed',
      phase: 'run',
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);

    if (
      error instanceof StdinRequiredError ||
      stdinRequested ||
      message.includes(STDIN_REQUIRED_MARKER) ||
      message.includes('Errno 29')
    ) {
      return {
        success: false,
        output: outputChunks.join(''),
        error: '',
        exitCode: null,
        waitingForInput: true,
        status: 'waiting-input',
        phase: 'run',
      };
    }

    return {
      success: false,
      output: message,
      error: message,
      exitCode: 1,
      waitingForInput: false,
      status: 'failed',
      phase: message.includes('SyntaxError') ? 'compile' : 'run',
    };
  } finally {
    globals.destroy();
  }
};

const finishSession = (
  requestId: string,
  session: ExecutionSession,
  result: PythonRunResult,
): void => {
  postEvent({
    type: 'result',
    requestId,
    success: result.success,
    output: result.output,
    error: result.error,
    exitCode: result.exitCode ?? null,
    waitingForInput: result.waitingForInput ?? false,
    status: result.status,
    phase: result.phase,
  });

  if (result.waitingForInput) {
    session.attempt += 1;
  } else {
    executionSessions.delete(requestId);
    // Cleanup stdin buffer after normal completion
    if (session.stdinBuffer) {
      try {
        closeSharedStdin(
          getSharedStdin(session.stdinBuffer),
          STDIN_CLOSED,
        );
      } catch (error: unknown) {
        console.warn('Unable to close Python stdin buffer.', error);
      }
    }
  }
};

const failSession = (
  requestId: string,
  attempt: number,
  error: unknown,
): void => {
  const message = error instanceof Error ? error.message : String(error);

  postStatus(requestId, 'failed', attempt);
  postEvent({
    type: 'result',
    requestId,
    success: false,
    output: message,
    error: message,
    exitCode: null,
    waitingForInput: false,
    status: 'failed',
    phase: 'run',
  });

  executionSessions.delete(requestId);
};

const runSession = async (
  requestId: string,
  session: ExecutionSession,
): Promise<void> => {
  if (!pyodidePromise) {
    postStatus(requestId, 'preparing', session.attempt);
  }

  try {
    finishSession(
      requestId,
      session,
      await runPython(requestId, session),
    );
  } catch (error: unknown) {
    failSession(requestId, session.attempt, error);
  }
};

const handleCompile = (
  request: Extract<RuntimeRequest, { type: 'compile' }>,
): void => {
  const session: ExecutionSession = {
    code: request.code,
    stdin: request.stdin ?? '',
    stdinBuffer: request.stdinBuffer,
    attempt: 1,
  };

  executionSessions.set(request.requestId, session);
  enqueueExecution(() => runSession(request.requestId, session));
};

const handleStdin = (
  request: Extract<RuntimeRequest, { type: 'stdin' }>,
): void => {
  const session = executionSessions.get(request.requestId);

  if (!session) {
    return;
  }

  session.stdin += `${request.input}\n`;
  enqueueExecution(() => runSession(request.requestId, session));
};

self.addEventListener(
  'message',
  (event: MessageEvent<RuntimeRequest>) => {
    const request = event.data;

    if (!request) {
      return;
    }

    // Stop handling – abort any pending stdin reads
    if (request.type === 'stop') {
      const buffer = request.stdinBuffer;
      if (buffer) {
        closeSharedStdin(
          getSharedStdin(buffer),
          STDIN_ABORTED,
        );
      }
      return;
    }

    if (request.type === 'stdin') {
      handleStdin(request);
      return;
    }

    if (request.type === 'compile') {
      handleCompile(request);
    }
  },
);