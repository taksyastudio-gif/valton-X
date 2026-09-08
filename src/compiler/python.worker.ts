import type {
  ExecutionPhase,
  ExecutionStatus,
  OutputStream,
  RuntimeEvent,
  RuntimeRequest,
} from './execution-protocol';
import type { loadPyodide } from 'pyodide';

const PYODIDE_BASE_URL = '/pyodide/';
const PYODIDE_VERSION = '0.25.1';
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

  await pyodide.loadPackage(
    `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/sqlite3-1.0.0.zip`,
  );
};

class SharedStdinReader {
  private readonly control: Int32Array;
  private readonly data: Uint8Array;
  private readonly decoder = new TextDecoder();

  constructor(buffer: SharedArrayBuffer) {
    this.control = new Int32Array(buffer, 0, 4);
    this.data = new Uint8Array(buffer, 16);
  }

  public readLine(): string {
    while (true) {
      const writePosition = Atomics.load(this.control, 0);
      const readPosition = Atomics.load(this.control, 1);

      for (
        let index = readPosition;
        index < writePosition;
        index += 1
      ) {
        if (this.data[index] !== 10) {
          continue;
        }

        const line = this.decoder.decode(
          this.data.slice(readPosition, index),
        );

        Atomics.store(this.control, 1, index + 1);
        return line;
      }

      if (Atomics.load(this.control, 2) === 1) {
        if (readPosition < writePosition) {
          const remaining = this.decoder.decode(
            this.data.slice(readPosition, writePosition),
          );

          Atomics.store(this.control, 1, writePosition);
          return remaining;
        }

        return '';
      }

      const version = Atomics.load(this.control, 3);
      Atomics.wait(this.control, 3, version);
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
  const sharedStdin = session.stdinBuffer
    ? new SharedStdinReader(session.stdinBuffer)
    : null;

  let stdinOffset = 0;
  let stdinRequested = false;

  const emit = (stream: OutputStream, text: string): void => {
    if (!text) {
      return;
    }

    outputChunks.push(text);
    postStream(requestId, stream, text, attempt);
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
      success: true,
      output: outputChunks.join(''),
      exitCode: 0,
      waitingForInput: false,
      status: 'completed',
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

    if (request.type === 'stdin') {
      handleStdin(request);
      return;
    }

    if (request.type === 'compile') {
      handleCompile(request);
    }
  },
);