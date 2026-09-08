const CONTROL_SLOTS = 5;
const HEADER_BYTES = CONTROL_SLOTS * Int32Array.BYTES_PER_ELEMENT;
const DEFAULT_CAPACITY = 256 * 1024;

export const STDIN_OPEN = 0;
export const STDIN_CLOSED = 1;
export const STDIN_ABORTED = 2;

export interface SharedStdin {
  buffer: SharedArrayBuffer;
  control: Int32Array;
  data: Uint8Array;
}

export const createSharedStdin = (
  initialInput = '',
  capacity = DEFAULT_CAPACITY,
): SharedStdin => {
  const buffer = new SharedArrayBuffer(HEADER_BYTES + capacity);
  const stdin = getSharedStdin(buffer);
  const written = appendSharedStdin(stdin, initialInput);
  if (written !== new TextEncoder().encode(initialInput).length) {
    throw new Error(
      'Initial input exceeds the interactive terminal buffer limit.',
    );
  }
  return stdin;
};

export const getSharedStdin = (
  buffer: SharedArrayBuffer,
): SharedStdin => ({
  buffer,
  control: new Int32Array(buffer, 0, CONTROL_SLOTS),
  data: new Uint8Array(buffer, HEADER_BYTES),
});

export const appendSharedStdin = (
  stdin: SharedStdin,
  input: string,
): number => {
  const bytes = new TextEncoder().encode(input);
  return writeSharedStdin(stdin, bytes);
};

export const writeSharedStdin = (
  stdin: SharedStdin,
  bytes: Uint8Array,
): number => {
  const available = stdin.data.length - Atomics.load(stdin.control, 4);
  const count = Math.min(available, bytes.length);
  const writePosition = Atomics.load(stdin.control, 0);

  for (let index = 0; index < count; index += 1) {
    stdin.data[(writePosition + index) % stdin.data.length] =
      bytes[index];
  }

  Atomics.store(
    stdin.control,
    0,
    (writePosition + count) % stdin.data.length,
  );
  Atomics.add(stdin.control, 4, count);
  if (count > 0) {
    Atomics.add(stdin.control, 3, 1);
    Atomics.notify(stdin.control, 3);
  }

  return count;
};

export const readSharedStdin = (
  stdin: SharedStdin,
  requested: number,
): Uint8Array => {
  const count = Math.min(requested, Atomics.load(stdin.control, 4));
  const readPosition = Atomics.load(stdin.control, 1);
  const result = new Uint8Array(count);

  for (let index = 0; index < count; index += 1) {
    result[index] =
      stdin.data[(readPosition + index) % stdin.data.length];
  }

  Atomics.store(
    stdin.control,
    1,
    (readPosition + count) % stdin.data.length,
  );
  Atomics.sub(stdin.control, 4, count);
  if (count > 0) {
    Atomics.add(stdin.control, 3, 1);
    Atomics.notify(stdin.control, 3);
  }

  return result;
};

export const closeSharedStdin = (
  stdin: SharedStdin,
  state: typeof STDIN_CLOSED | typeof STDIN_ABORTED = STDIN_CLOSED,
): void => {
  Atomics.store(stdin.control, 2, state);
  Atomics.add(stdin.control, 3, 1);
  Atomics.notify(stdin.control, 3);
};
