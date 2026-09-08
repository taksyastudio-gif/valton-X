import {
  useEffect,
  useRef,
  type FC,
} from 'react';
import { Terminal } from 'xterm';
import type { ITheme } from 'xterm';

import 'xterm/css/xterm.css';

import type { EditorTheme } from '../types/byteplay';

interface InteractiveTerminalProps {
  terminalLogs: string[];
  isWaitingForInput?: boolean;
  onInput: (value: string) => void;
  onInterrupt?: () => void;
  onEof?: () => void;
  clearGeneration?: number;
  theme?: EditorTheme;
}

const XTERM_THEMES: Record<EditorTheme, ITheme> = {
  black: {
    background: '#060910',
    foreground: '#f8fafc',
    cursor: '#38bdf8',
    selectionBackground: '#1e3a8a80',
    black: '#0f172a',
    red: '#f87171',
    green: '#34d399',
    yellow: '#fbbf24',
    blue: '#60a5fa',
    magenta: '#c084fc',
    cyan: '#22d3ee',
    white: '#e2e8f0',
  },
  white: {
    background: '#f8fafc',
    foreground: '#0f172a',
    cursor: '#2563eb',
    selectionBackground: '#bfdbfe',
    black: '#0f172a',
    red: '#dc2626',
    green: '#059669',
    yellow: '#d97706',
    blue: '#2563eb',
    magenta: '#9333ea',
    cyan: '#0891b2',
    white: '#64748b',
  },
  cyberpunk: {
    background: '#050410',
    foreground: '#f0f6fc',
    cursor: '#06b6d4',
    selectionBackground: 'rgba(6, 182, 212, 0.25)',
    black: '#0e0c24',
    red: '#fb7185',
    green: '#34d399',
    yellow: '#facc15',
    blue: '#38bdf8',
    magenta: '#c084fc',
    cyan: '#06b6d4',
    white: '#f0f6fc',
  },
};

const fitTerminal = (
  terminal: Terminal,
  container: HTMLDivElement,
): void => {
  const measure = container.querySelector(
    '.xterm-char-measure-element',
  );
  const rect = measure?.getBoundingClientRect();
  if (
    !rect ||
    !Number.isFinite(rect.width) ||
    !Number.isFinite(rect.height) ||
    rect.width < 4 ||
    rect.height < 8
  ) {
    return;
  }

  const width = rect.width;
  const height = rect.height;
  const cols = Math.max(
    1,
    Math.floor((container.clientWidth - 4) / width),
  );
  const rows = Math.max(
    1,
    Math.floor((container.clientHeight - 4) / height),
  );

  if (cols < 20 || rows < 5) {
    return;
  }

  if (cols !== terminal.cols || rows !== terminal.rows) {
    terminal.resize(cols, rows);
  }
};

export const InteractiveTerminal: FC<
  InteractiveTerminalProps
> = ({
  terminalLogs,
  isWaitingForInput = false,
  onInput,
  onInterrupt,
  onEof,
  clearGeneration = 0,
  theme = 'black',
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);

  const inputBufferRef = useRef('');
  const cursorPositionRef = useRef(0);
  const historyRef = useRef<string[]>([]);
  const historyIndexRef = useRef(-1);
  const onInputRef = useRef(onInput);
  const onInterruptRef = useRef(onInterrupt);
  const onEofRef = useRef(onEof);
  const waitingRef = useRef(isWaitingForInput);

  const previousLogCountRef = useRef(0);
  const previousClearGenerationRef =
    useRef(clearGeneration);

  useEffect(() => {
    onInputRef.current = onInput;
  }, [onInput]);

  useEffect(() => {
    onInterruptRef.current = onInterrupt;
    onEofRef.current = onEof;
  }, [onEof, onInterrupt]);

  useEffect(() => {
    waitingRef.current = isWaitingForInput;

    const terminal = terminalRef.current;

    if (!terminal) {
      return;
    }

    terminal.options.cursorBlink = isWaitingForInput;

    if (isWaitingForInput) {
      terminal.focus();
    }
  }, [isWaitingForInput]);

  useEffect(() => {
    const container = containerRef.current;

    if (!container) {
      return;
    }

    const terminal = new Terminal({
      allowProposedApi: true,
      convertEol: true,
      cursorBlink: waitingRef.current,
      cursorStyle: 'block',
      disableStdin: false,
      fontFamily:
        "'JetBrains Mono', 'Fira Code', 'Cascadia Code', Consolas, monospace",
      fontSize: 13,
      lineHeight: 1.4,
      scrollback: 5000,
      theme: XTERM_THEMES[theme],
    });

    terminalRef.current = terminal;

    const openFrame = window.requestAnimationFrame(() => {
      if (terminalRef.current !== terminal) {
        return;
      }

      terminal.open(container);
      terminal.focus();
      fitTerminal(terminal, container);
    });

    const dataSubscription = terminal.onData((data) => {
      if (data === '\u0003') {
        terminal.write('^C\r\n');
        inputBufferRef.current = '';
        cursorPositionRef.current = 0;
        historyIndexRef.current = -1;
        onInterruptRef.current?.();
        return;
      }

      if (data === '\u0004') {
        if (!inputBufferRef.current) {
          terminal.write('^D\r\n');
          onEofRef.current?.();
        }
        return;
      }

      if (data === '\u000c') {
        terminal.clear();
        terminal.write('\r\n');
        return;
      }

      if (!waitingRef.current) {
        return;
      }

      if (data === '\u007f' || data === '\b') {
        if (cursorPositionRef.current === 0) {
          return;
        }

        inputBufferRef.current =
          inputBufferRef.current.slice(
            0,
            cursorPositionRef.current - 1,
          ) +
          inputBufferRef.current.slice(cursorPositionRef.current);
        cursorPositionRef.current -= 1;
        redrawInput(
          terminal,
          inputBufferRef.current,
          cursorPositionRef.current,
        );
        return;
      }

      if (data === '\r' || data === '\n') {
        const input = inputBufferRef.current;

        if (input) {
          historyRef.current = [
            ...historyRef.current.filter(
              (entry) => entry !== input,
            ),
            input,
          ].slice(-50);
        }
        historyIndexRef.current = -1;
        inputBufferRef.current = '';
        cursorPositionRef.current = 0;

        terminal.write('\r\n');

        // The worker receives one complete line. The parent App
        // is responsible for adding the newline expected by C/Python.
        onInputRef.current(input);
        return;
      }

      if (data === '\u001b[A' || data === '\u001b[B') {
        const history = historyRef.current;
        if (history.length === 0) {
          return;
        }
        if (data === '\u001b[A') {
          historyIndexRef.current = Math.min(
            historyIndexRef.current + 1,
            history.length - 1,
          );
        } else {
          historyIndexRef.current = Math.max(
            historyIndexRef.current - 1,
            -1,
          );
        }
        inputBufferRef.current =
          historyIndexRef.current >= 0
            ? history[
                history.length - 1 - historyIndexRef.current
              ]
            : '';
        cursorPositionRef.current = inputBufferRef.current.length;
        redrawInput(
          terminal,
          inputBufferRef.current,
          cursorPositionRef.current,
        );
        return;
      }

      if (data === '\u001b[D') {
        cursorPositionRef.current = Math.max(
          cursorPositionRef.current - 1,
          0,
        );
        terminal.write('\u001b[D');
        return;
      }

      if (data === '\u001b[C') {
        cursorPositionRef.current = Math.min(
          cursorPositionRef.current + 1,
          inputBufferRef.current.length,
        );
        terminal.write('\u001b[C');
        return;
      }

      if (data.startsWith('\u001b')) {
        return;
      }

      inputBufferRef.current =
        inputBufferRef.current.slice(
          0,
          cursorPositionRef.current,
        ) +
        data +
        inputBufferRef.current.slice(cursorPositionRef.current);
      cursorPositionRef.current += data.length;
      redrawInput(
        terminal,
        inputBufferRef.current,
        cursorPositionRef.current,
      );
    });

    const pasteHandler = (event: ClipboardEvent): void => {
      if (!waitingRef.current) {
        return;
      }

      const pasted = event.clipboardData?.getData('text/plain');
      if (!pasted) {
        return;
      }

      event.preventDefault();
      const normalized = pasted
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n')
        .replace(/\n/g, ' ');
      inputBufferRef.current =
        inputBufferRef.current.slice(
          0,
          cursorPositionRef.current,
        ) +
        normalized +
        inputBufferRef.current.slice(cursorPositionRef.current);
      cursorPositionRef.current += normalized.length;
      redrawInput(
        terminal,
        inputBufferRef.current,
        cursorPositionRef.current,
      );
    };

    const resizeObserver = new ResizeObserver(() => {
      fitTerminal(terminal, container);
    });

    container.addEventListener('paste', pasteHandler);
    resizeObserver.observe(container);

    return () => {
      window.cancelAnimationFrame(openFrame);
      dataSubscription.dispose();
      resizeObserver.disconnect();
      container.removeEventListener('paste', pasteHandler);

      terminal.dispose();
      terminalRef.current = null;
      inputBufferRef.current = '';
      cursorPositionRef.current = 0;
      historyIndexRef.current = -1;
      previousLogCountRef.current = 0;
    };
  }, [theme]);

  useEffect(() => {
    const terminal = terminalRef.current;

    if (!terminal) {
      return;
    }

    terminal.options.theme = XTERM_THEMES[theme];
  }, [theme]);

  useEffect(() => {
    const terminal = terminalRef.current;

    if (!terminal) {
      return;
    }

    if (
      clearGeneration !==
      previousClearGenerationRef.current
    ) {
      previousClearGenerationRef.current =
        clearGeneration;

      previousLogCountRef.current = 0;
      inputBufferRef.current = '';
      cursorPositionRef.current = 0;
      historyIndexRef.current = -1;

      terminal.clear();
      terminal.reset();
    }
  }, [clearGeneration]);

  useEffect(() => {
    const terminal = terminalRef.current;

    if (!terminal) {
      return;
    }

    if (
      terminalLogs.length <
      previousLogCountRef.current
    ) {
      terminal.clear();
      terminal.reset();
      previousLogCountRef.current = 0;
    }

    const newEntries = terminalLogs.slice(
      previousLogCountRef.current,
    );

    for (const entry of newEntries) {
      terminal.write(formatTerminalEntry(entry));
    }

    previousLogCountRef.current = terminalLogs.length;

    if (newEntries.length > 0) {
      terminal.scrollToBottom();
    }
  }, [terminalLogs]);

  return (
    <div className="h-full w-full bg-terminal-bg p-2">
      <div
        aria-label={
          isWaitingForInput
            ? 'Program input terminal'
            : 'Program output terminal'
        }
        className="h-full w-full overflow-hidden rounded-md"
        ref={containerRef}
      />
    </div>
  );
};

const redrawInput = (
  terminal: Terminal,
  value: string,
  cursorPosition: number,
): void => {
  const cursorOffset = value.length - cursorPosition;
  terminal.write(`\r\x1b[2K${value}`);
  if (cursorOffset > 0) {
    terminal.write(`\x1b[${cursorOffset}D`);
  }
};

const formatTerminalEntry = (text: string): string => {
  if (!text) {
    return '';
  }

  const normalized = text
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n');

  return normalized
    .split('\n')
    .map((line) => `${line}\r\n`)
    .join('');
};

export default InteractiveTerminal;