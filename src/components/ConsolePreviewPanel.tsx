import {
  ArrowDownToLine,
  ArrowRightToLine,
  CircleAlert,
  Trash2,
} from 'lucide-react';
import type { FC } from 'react';

import { FriendlyErrorPanel } from './FriendlyErrorPanel';
import { InteractiveTerminal } from './InteractiveTerminal';
import { buildWebPreview } from '../utils/webPreview';

import type {
  EditorTheme,
  FileItem,
  SupportedLanguage,
  TerminalPosition,
} from '../types/byteplay';
import type { ExecutionStatus } from '../compiler/execution-protocol';

interface ConsolePreviewPanelProps {
  activeLanguage: SupportedLanguage;
  activeTheme?: EditorTheme;
  files: FileItem[];
  webEntryPoint?: string;
  terminalLogs: string[];
  htmlPreviewDoc?: string | null;

  errorOutput?: string;
  errorFileName?: string;
  onJumpToError?: (line: number, column: number) => void;
  onClearError?: () => void;

  onSendInput: (input: string) => void;
  stdinInput?: string;
  onStdinInputChange?: (value: string) => void;
  onClearTerminal: () => void;
  isWaitingForInput?: boolean;
  executionStatus: ExecutionStatus;
  clearGeneration: number;
  terminalPosition: TerminalPosition;
  onTerminalPositionChange: (
    position: TerminalPosition,
  ) => void;
}

const STATUS_CONFIG: Record<
  ExecutionStatus,
  { label: string; color: string }
> = {
  idle: { label: 'Ready', color: 'text-muted' },
  preparing: {
    label: 'Preparing...',
    color: 'text-cyan-400',
  },
  compiling: {
    label: 'Compiling...',
    color: 'text-cyan-400',
  },
  running: {
    label: 'Running...',
    color: 'text-emerald-400',
  },
  'waiting-input': {
    label: 'Waiting for input',
    color: 'font-bold text-amber-400 animate-pulse',
  },
  completed: {
    label: 'Completed',
    color: 'text-emerald-400',
  },
  failed: {
    label: 'Failed',
    color: 'text-red-400',
  },
  stopped: {
    label: 'Stopped',
    color: 'text-muted',
  },
  timeout: {
    label: 'Timed out',
    color: 'text-orange-400',
  },
  'memory-limit': {
    label: 'Memory limit exceeded',
    color: 'text-orange-400',
  },
  'output-limit': {
    label: 'Output limit exceeded',
    color: 'text-orange-400',
  },
  'process-limit': {
    label: 'Process limit exceeded',
    color: 'text-orange-400',
  },
  'sandbox-error': {
    label: 'Sandbox error',
    color: 'text-red-400',
  },
  'infrastructure-error': {
    label: 'Infrastructure error',
    color: 'text-red-400',
  },
};

export const ConsolePreviewPanel: FC<
  ConsolePreviewPanelProps
> = ({
  activeLanguage,
  activeTheme = 'black',
  files,
  webEntryPoint,
  terminalLogs,
  htmlPreviewDoc = null,
  errorOutput = '',
  errorFileName,
  onJumpToError,
  onClearError,
  onSendInput,
  stdinInput = '',
  onStdinInputChange,
  onClearTerminal,
  isWaitingForInput = false,
  executionStatus,
  clearGeneration,
  terminalPosition,
  onTerminalPositionChange,
}) => {
  const isWebPreview =
    activeLanguage === 'html' ||
    activeLanguage === 'css' ||
    activeLanguage === 'javascript';

  const status = STATUS_CONFIG[executionStatus];

  const preview = isWebPreview
    ? buildWebPreview(files, webEntryPoint)
    : null;

  const documentToRender =
    htmlPreviewDoc || preview?.document || null;

  const nextPosition =
    terminalPosition === 'bottom' ? 'right' : 'bottom';

  return (
    <section className="console-panel flex h-full min-w-0 flex-col border-t border-theme bg-surface font-mono text-xs">
      <header className="console-panel-header flex h-9 shrink-0 items-center justify-between border-b border-theme px-3.5">
        <div className="flex min-w-0 items-center gap-2.5">
          <span
            aria-hidden="true"
            className={[
              'font-bold',
              isWebPreview
                ? 'text-orange-400'
                : 'text-emerald-400',
            ].join(' ')}
          >
            {isWebPreview ? '◉' : '>_'}
          </span>

          <span className="truncate font-sans text-xs font-semibold uppercase tracking-wider text-primary">
            {isWebPreview
              ? 'Live Web Preview'
              : 'Interactive Terminal'}
          </span>

          {!isWebPreview ? (
            <span
              className={[
                'ml-1 text-[11px]',
                status.color,
              ].join(' ')}
              role="status"
            >
              • {status.label}
            </span>
          ) : preview?.entryFileName ? (
            <span className="hidden truncate text-[10px] text-muted sm:inline">
              • {preview.entryFileName}
            </span>
          ) : null}
        </div>

        <div className="flex shrink-0 items-center gap-1">
          {!isWebPreview ? (
            <button
              aria-label={`Move terminal to the ${nextPosition} panel`}
              className="icon-action rounded p-1"
              onClick={() =>
                onTerminalPositionChange(nextPosition)
              }
              title={`Move terminal to ${nextPosition}`}
              type="button"
            >
              {terminalPosition === 'bottom' ? (
                <ArrowRightToLine
                  aria-hidden="true"
                  size={14}
                />
              ) : (
                <ArrowDownToLine
                  aria-hidden="true"
                  size={14}
                />
              )}
            </button>
          ) : null}

          <button
            aria-label={
              isWebPreview
                ? 'Clear web preview'
                : 'Clear terminal'
            }
            className="icon-action rounded p-1 hover:text-red-400"
            onClick={onClearTerminal}
            title={
              isWebPreview
                ? 'Clear web preview'
                : 'Clear terminal'
            }
            type="button"
          >
            <Trash2 aria-hidden="true" size={14} />
          </button>
        </div>
      </header>

      {isWebPreview ? (
        <div className="relative min-h-0 flex-1 bg-white">
          {documentToRender ? (
            <iframe
              className="h-full w-full border-0"
              referrerPolicy="no-referrer"
              sandbox="allow-scripts allow-modals"
              srcDoc={documentToRender}
              title="Valton X web project preview"
            />
          ) : (
            <div className="flex h-full items-center justify-center bg-slate-950 p-4 text-center text-xs italic text-slate-400">
              <p>
                Create an <code>index.html</code> file and press
                “Run Code” to render the web project.
              </p>
            </div>
          )}

          {preview && preview.diagnostics.length > 0 ? (
            <div
              aria-label="Web preview diagnostics"
              className="absolute bottom-3 left-3 right-3 max-h-32 overflow-y-auto rounded-lg border border-amber-500/30 bg-slate-950/95 p-2 text-[11px] text-amber-200 shadow-lg"
              role="status"
            >
              <div className="mb-1 flex items-center gap-1.5 font-semibold text-amber-300">
                <CircleAlert
                  aria-hidden="true"
                  size={13}
                />
                <span>Preview diagnostics</span>
              </div>

              <div className="space-y-1">
                {preview.diagnostics.map((diagnostic) => (
                  <p
                    key={`${diagnostic.fileName}:${diagnostic.message}`}
                  >
                    <span className="font-semibold">
                      {diagnostic.fileName}:
                    </span>{' '}
                    {diagnostic.message}
                  </p>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {errorOutput.trim() ? (
            <div className="min-h-0 max-h-[58%] shrink-0 overflow-y-auto border-b border-theme px-2 pt-2">
              <FriendlyErrorPanel
                fileName={errorFileName}
                language={activeLanguage}
                onClear={onClearError}
                onJumpToError={onJumpToError}
                rawError={errorOutput}
              />
            </div>
          ) : null}

          <div className="min-h-0 flex-1 overflow-hidden">
            {onStdinInputChange ? (
              <div className="border-b border-theme bg-surface-raised p-2">
                <label
                  className="mb-1 block text-[11px] font-semibold text-secondary"
                  htmlFor="program-stdin"
                >
                  Program input (one value or line per input)
                </label>
                <textarea
                  aria-describedby="program-stdin-help"
                  className="input-field min-h-10 w-full resize-y rounded border px-2 py-1.5 text-xs outline-none"
                  id="program-stdin"
                  onChange={(event) =>
                    onStdinInputChange(event.target.value)
                  }
                  placeholder="Example: 10 20"
                  value={stdinInput}
                />
                <p
                  className="mt-1 text-[10px] text-muted"
                  id="program-stdin-help"
                >
                  Enter values before clicking Run Code. C and C++ read this
                  text through standard input.
                </p>
              </div>
            ) : null}
            <InteractiveTerminal
              clearGeneration={clearGeneration}
              isWaitingForInput={isWaitingForInput}
              onInput={onSendInput}
              terminalLogs={terminalLogs}
              theme={activeTheme}
            />
          </div>
        </div>
      )}
    </section>
  );
};

export default ConsolePreviewPanel;