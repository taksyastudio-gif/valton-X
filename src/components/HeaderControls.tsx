import {
  Download,
  MessageSquare,
  Palette,
  Play,
  RotateCcw,
  Square,
  Trash2,
} from 'lucide-react';
import type { FC } from 'react';

import { FirebaseAuthButton } from './FirebaseAuthButton';
import type { EditorTheme } from '../types/byteplay';

interface HeaderControlsProps {
  isRunning: boolean;
  activeTheme: EditorTheme;

  onThemeChange: (theme: EditorTheme) => void;
  onRun: () => void;
  onClear: () => void;
  onReset: () => void;
  onExport: () => void;
  onFeedbackClick: () => void;
}

export const HeaderControls: FC<HeaderControlsProps> = ({
  isRunning,
  activeTheme,
  onThemeChange,
  onRun,
  onClear,
  onReset,
  onExport,
  onFeedbackClick,
}) => {
  return (
    <header className="app-header z-30 flex w-full shrink-0 select-none flex-col border-b border-theme bg-surface">
      <div className="main-header-row flex min-h-[52px] w-full items-center justify-between gap-3 px-3 sm:px-4">
        <div className="brand-block flex min-w-0 shrink-0 items-center gap-2.5">
          <div className="flex min-w-0 items-center gap-2">
            <div className="flex min-w-0 flex-col">
              <span className="truncate text-sm font-bold leading-tight tracking-tight text-primary sm:text-base">
                Valton X
              </span>
              <span className="hidden text-[10px] leading-tight text-muted sm:block">
                by TAKSYA STUDIO
              </span>
            </div>

            <span className="hidden rounded border border-indigo-500/20 bg-indigo-500/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-indigo-400 md:inline">
              Browser IDE
            </span>
          </div>
        </div>

        <div className="flex min-w-0 items-center justify-center gap-1.5 sm:gap-2">
          <button
            aria-label={
              isRunning ? 'Stop execution' : 'Run code'
            }
            className={[
              'flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition-all active:scale-95 disabled:cursor-not-allowed disabled:opacity-50 sm:px-4',
              isRunning
                ? 'bg-red-700 hover:bg-red-600 focus-visible:ring-red-500'
                : 'bg-emerald-700 hover:bg-emerald-600 focus-visible:ring-emerald-500',
            ].join(' ')}
            onClick={onRun}
            type="button"
          >
            {isRunning ? (
              <Square
                aria-hidden="true"
                fill="currentColor"
                size={12}
              />
            ) : (
              <Play
                aria-hidden="true"
                fill="currentColor"
                size={13}
              />
            )}

            <span className="hidden sm:inline">
              {isRunning ? 'Stop Execution' : 'Run Code'}
            </span>
          </button>

          <label
            className="secondary-action flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium"
            title="Change editor theme"
          >
            <Palette aria-hidden="true" size={13} />
            <span className="sr-only">Theme</span>
            <select
              aria-label="Editor theme"
              className="max-w-20 cursor-pointer bg-transparent text-xs outline-none sm:max-w-24"
              onChange={(event) =>
                onThemeChange(event.target.value as EditorTheme)
              }
              value={activeTheme}
            >
              <option value="black">Black</option>
              <option value="white">White</option>
              <option value="cyberpunk">Cyberpunk</option>
            </select>
          </label>

          <button
            aria-label="Clear terminal"
            className="secondary-action flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium sm:px-3"
            onClick={onClear}
            title="Clear terminal"
            type="button"
          >
            <Trash2 aria-hidden="true" size={13} />
            <span className="hidden sm:inline">Clear</span>
          </button>

          <button
            aria-label="Reset workspace"
            className="secondary-action flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium sm:px-3"
            onClick={onReset}
            title="Reset workspace"
            type="button"
          >
            <RotateCcw aria-hidden="true" size={13} />
            <span className="hidden sm:inline">Reset</span>
          </button>

          <span
            aria-hidden="true"
            className="mx-1 hidden h-4 w-px bg-[var(--border)] md:block"
          />

          <button
            aria-label="Export project"
            className="secondary-action hidden items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium md:flex"
            onClick={onExport}
            type="button"
          >
            <Download aria-hidden="true" size={13} />
            <span>Export</span>
          </button>

          <button
            aria-label="Send feedback"
            className="secondary-action flex h-8 w-8 items-center justify-center rounded-lg border"
            onClick={onFeedbackClick}
            title="Feedback"
            type="button"
          >
            <MessageSquare aria-hidden="true" size={14} />
          </button>

          <FirebaseAuthButton />
        </div>

      </div>
    </header>
  );
};

export default HeaderControls;