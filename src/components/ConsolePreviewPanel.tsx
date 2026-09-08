import {
  ArrowDownToLine,
  ArrowRightToLine,
  CircleAlert,
  Trash2,
} from 'lucide-react';
import type { FC } from 'react';
import { useEffect, useState } from 'react';
import { InteractiveTerminal } from './InteractiveTerminal';
import { buildWebPreview } from '../utils/webPreview';
import { ErrorModal } from './ErrorModal';
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
  onInterrupt?: () => void;
  onEof?: () => void;
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
  onInterrupt,
  onEof,
  onClearTerminal,
  isWaitingForInput = false,
  executionStatus,
  clearGeneration,
  terminalPosition,
  onTerminalPositionChange,
}) => {
  const [showErrorModal, setShowErrorModal] = useState(false);

  useEffect(() => {
    // Automatically open the Doctor only when a new runtime error arrives.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setShowErrorModal(Boolean(errorOutput.trim()));
  }, [errorOutput]);
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
    {/* Error handling – show a button to open modal */}
    {errorOutput.trim() ? (
      <div className="flex items-center gap-2 mb-2">
        <button
          className="primary-action inline-flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-semibold"
          onClick={() => setShowErrorModal(true)}
          type="button"
        >
          Open Doctor check-up
        </button>
        {/* Optional clear error button */}
        {onClearError ? (
          <button
            className="icon-action rounded p-1"
            onClick={onClearError}
            aria-label="Dismiss error"
            title="Dismiss error"
            type="button"
          >
            <span aria-hidden="true">×</span>
          </button>
        ) : null}
      </div>
    ) : null}
    {/* Doctor modal */}
    <ErrorModal
      isOpen={showErrorModal}
      onClose={() => setShowErrorModal(false)}
      rawError={errorOutput}
      language={activeLanguage}
      fileName={errorFileName}
      onJumpToError={onJumpToError}
      onClear={onClearError}
    />
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="min-h-0 flex-1 overflow-hidden">
        <InteractiveTerminal
          clearGeneration={clearGeneration}
          isWaitingForInput={isWaitingForInput}
          onInput={onSendInput}
          onInterrupt={onInterrupt}
          onEof={onEof}
          terminalLogs={terminalLogs}
          theme={activeTheme}
        />
      </div>
    </div>
        </div>
      )}
    </section>
  );
};

export default ConsolePreviewPanel;