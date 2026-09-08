import {
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Lightbulb,
  MapPin,
  X,
} from 'lucide-react';
import { useMemo, useState, type FC } from 'react';

import {
  ErrorInterpreter,
  type HumorousErrorInsight,
} from '../compiler/error-interpreter';

interface FriendlyErrorPanelProps {
  rawError: string;
  language: string;
  fileName?: string;
  onJumpToError?: (
    line: number,
    column: number,
  ) => void;
  onClear?: () => void;
}

export const FriendlyErrorPanel: FC<
  FriendlyErrorPanelProps
> = ({
  rawError,
  language,
  fileName,
  onJumpToError,
  onClear,
}) => {
  const [showRawLog, setShowRawLog] = useState(false);
  const [showExplanation, setShowExplanation] =
    useState(true);

  const insight = useMemo<HumorousErrorInsight>(
    () => ErrorInterpreter.parse(rawError, language),
    [language, rawError],
  );

  const line = insight.lineNumber ?? null;
  const column = insight.columnNumber ?? 1;
  const hasLocation = line !== null && line > 0;

  const handleJumpToError = (): void => {
    if (line === null || !onJumpToError) {
      return;
    }

    onJumpToError(line, column);
  };

  return (
    <section
      aria-label="Valton X Error Doctor"
      aria-live="polite"
      className="my-2 flex max-h-full flex-col gap-3 overflow-y-auto rounded-xl border border-rose-500/30 bg-slate-900 p-4 font-sans shadow-2xl"
    >
      <header className="flex items-start justify-between gap-4 border-b border-rose-500/20 pb-3">
        <div className="flex min-w-0 items-start gap-3">
          <span
            aria-hidden="true"
            className="rounded-lg border border-rose-500/20 bg-rose-500/10 p-2 text-2xl"
          >
            {insight.emoji}
          </span>

          <div className="min-w-0">
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-widest text-rose-300/70">
              Valton X Error Doctor · Full check-up
            </p>

            <h3 className="text-sm font-bold tracking-wide text-rose-400">
              {insight.humorousTitle}
            </h3>

            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-400">
              {fileName ? (
                <span className="font-mono text-slate-300">
                  {fileName}
                </span>
              ) : null}

              {hasLocation ? (
                <span className="inline-flex items-center gap-1">
                  <MapPin
                    aria-hidden="true"
                    size={12}
                  />
                  Line {line}
                  {column > 1 ? `, Column ${column}` : ''}
                </span>
              ) : null}

              {insight.category &&
              insight.category !== 'unknown' ? (
                <span className="uppercase tracking-wider text-slate-500">
                  {insight.category}
                </span>
              ) : null}
              {insight.diagnosticType ? (
                <span className="rounded border border-cyan-500/20 px-1.5 py-0.5 uppercase tracking-wider text-cyan-300/80">
                  {insight.diagnosticType.replaceAll('_', ' ')}
                </span>
              ) : null}
            </div>
          </div>
        </div>

        {onClear ? (
          <button
            aria-label="Dismiss error"
            className="icon-action shrink-0 rounded p-1"
            onClick={onClear}
            title="Dismiss error"
            type="button"
          >
            <X aria-hidden="true" size={15} />
          </button>
        ) : null}
      </header>

      <div className="rounded-lg border border-slate-800 bg-slate-950/70 p-3">
        <button
          aria-controls="error-doctor-explanation"
          aria-expanded={showExplanation}
          className="flex w-full items-center justify-between text-left"
          onClick={() =>
            setShowExplanation((visible) => !visible)
          }
          type="button"
        >
          <span className="flex items-center gap-1.5 text-xs font-semibold text-slate-300">
            <Lightbulb
              aria-hidden="true"
              className="text-amber-300"
              size={14}
            />
            Doctor&apos;s findings
          </span>

          {showExplanation ? (
            <ChevronDown
              aria-hidden="true"
              className="text-slate-500"
              size={14}
            />
          ) : (
            <ChevronRight
              aria-hidden="true"
              className="text-slate-500"
              size={14}
            />
          )}
        </button>

        {showExplanation ? (
          <div
            className="mt-2 space-y-2"
            id="error-doctor-explanation"
          >
            <p className="text-xs leading-relaxed text-slate-300">
              Diagnosis: {insight.friendlyExplanation}
            </p>

            {insight.confidence !== undefined &&
            insight.confidence < 0.7 ? (
              <p className="text-[11px] leading-relaxed text-amber-300">
                The doctor cannot make a fully certain diagnosis yet.
                Check the reported line and the lines immediately
                above it.
              </p>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="rounded-lg border border-emerald-500/30 bg-emerald-950/20 p-3">
        <h4 className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-emerald-400">
          <span aria-hidden="true">💡</span>
          Doctor&apos;s prescription
        </h4>

        <p className="rounded border border-emerald-500/20 bg-emerald-950/40 p-2 font-mono text-xs leading-relaxed text-emerald-200/90">
          Prescription: {insight.suggestedFix}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {hasLocation && onJumpToError ? (
          <button
            className="primary-action inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold"
            onClick={handleJumpToError}
            type="button"
          >
            <ExternalLink
              aria-hidden="true"
              size={13}
            />
            Jump to error
          </button>
        ) : null}

        <button
          aria-controls="error-doctor-raw-log"
          aria-expanded={showRawLog}
          className="secondary-action inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 font-mono text-[11px]"
          onClick={() => setShowRawLog((visible) => !visible)}
          type="button"
        >
          {showRawLog ? (
            <ChevronDown aria-hidden="true" size={13} />
          ) : (
            <ChevronRight aria-hidden="true" size={13} />
          )}
          {showRawLog ? 'Hide lab report' : 'Show lab report'}
        </button>
      </div>

      {showRawLog ? (
        <pre
          className="max-h-64 overflow-x-auto whitespace-pre-wrap rounded-lg border border-slate-800 bg-slate-950 p-3 font-mono text-[11px] leading-normal text-rose-300/80 select-text"
          id="error-doctor-raw-log"
        >
          {insight.rawError}
        </pre>
      ) : null}
    </section>
  );
};

export default FriendlyErrorPanel;