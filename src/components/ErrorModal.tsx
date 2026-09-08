import { Stethoscope, X } from 'lucide-react';
import { useEffect, useRef, type FC } from 'react';
import { FriendlyErrorPanel } from './FriendlyErrorPanel';

interface ErrorModalProps {
  isOpen: boolean;
  onClose: () => void;
  rawError: string;
  language: string;
  fileName?: string;
  onJumpToError?: (line: number, column: number) => void;
  onClear?: () => void;
}

export const ErrorModal: FC<ErrorModalProps> = ({
  isOpen,
  onClose,
  rawError,
  language,
  fileName,
  onJumpToError,
  onClear,
}) => {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (isOpen) {
      previousFocusRef.current =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;

      if (!dialog.open) {
        dialog.showModal();
      }

      closeButtonRef.current?.focus();
    } else {
      if (dialog.open) {
        dialog.close();
      }

      previousFocusRef.current?.focus();
    }
  }, [isOpen]);

  const handleCancel = (): void => {
    onClose();
  };

  return (
    <dialog
      ref={dialogRef}
      aria-describedby="doctor-error-content"
      aria-labelledby="doctor-error-title"
      className="w-full max-w-2xl rounded-xl border border-rose-500/40 bg-slate-900 p-0 text-slate-100 shadow-2xl backdrop:bg-slate-950/80 backdrop:backdrop-blur-sm"
      onCancel={handleCancel}
    >
      <div className="flex items-center justify-between border-b border-rose-500/20 bg-slate-800 px-4 py-3">
        <div className="flex items-center gap-3">
          <span
            aria-label="Valton X AI Doctor"
            className="flex h-11 w-11 items-center justify-center rounded-full border border-cyan-400/50 bg-slate-950 shadow-[0_0_18px_rgba(34,211,238,0.25)]"
            role="img"
          >
            <svg
              aria-hidden="true"
              className="h-9 w-9"
              viewBox="0 0 48 48"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <defs>
                <linearGradient
                  id="doctor-coat"
                  x1="10"
                  y1="30"
                  x2="38"
                  y2="47"
                  gradientUnits="userSpaceOnUse"
                >
                  <stop stopColor="#67E8F9" />
                  <stop offset="1" stopColor="#2563EB" />
                </linearGradient>
                <filter id="doctor-glow">
                  <feGaussianBlur stdDeviation="1.4" result="blur" />
                  <feMerge>
                    <feMergeNode in="blur" />
                    <feMergeNode in="SourceGraphic" />
                  </feMerge>
                </filter>
              </defs>
              <path
                d="M15 29.5 8.5 34 6 46h36l-2.5-12-6.5-4.5"
                fill="url(#doctor-coat)"
                stroke="#A5F3FC"
                strokeWidth="1.2"
              />
              <path
                d="M18 27.5v4.2l6 5 6-5v-4.2"
                fill="#0F172A"
                stroke="#67E8F9"
                strokeWidth="1"
              />
              <path
                d="M15 14c0-6 4-10 9-10s9 4 9 10v8c0 6-4 10-9 10s-9-4-9-10v-8Z"
                fill="#1E293B"
                stroke="#CBD5E1"
                strokeWidth="1.2"
              />
              <path
                d="M13 15c.5-7 4.5-11 11-11s10.5 4 11 11l-3-2-3 2-5-2-5 2-3-2-3 2Z"
                fill="#334155"
                stroke="#94A3B8"
                strokeWidth="1"
              />
              <path
                d="M17 17.5h14v5H17v-5Z"
                fill="#082F49"
                stroke="#22D3EE"
                strokeWidth="1"
                filter="url(#doctor-glow)"
              />
              <path
                d="M20 20h2m4 0h2"
                stroke="#A5F3FC"
                strokeLinecap="round"
                strokeWidth="1.2"
              />
              <path
                d="M23 25h2m-1 0v2"
                stroke="#67E8F9"
                strokeLinecap="round"
                strokeWidth="1"
              />
              <path
                d="M34 34h4m-2-2v4"
                stroke="#F8FAFC"
                strokeLinecap="round"
                strokeWidth="1.5"
              />
              <path
                d="M12 37h4m-2-2v4"
                stroke="#E0F2FE"
                strokeLinecap="round"
                strokeWidth="1.2"
              />
            </svg>
          </span>
          <h3
            className="flex items-center gap-2 text-sm font-semibold text-rose-300"
            id="doctor-error-title"
          >
            <Stethoscope aria-hidden="true" size={16} />
            Doctor&apos;s full check-up
          </h3>
        </div>
        <button
          aria-label="Close error modal"
          className="icon-action rounded p-1"
          onClick={onClose}
          ref={closeButtonRef}
          type="button"
        >
          <X aria-hidden="true" size={16} />
        </button>
      </div>
      <div
        className="max-h-[75vh] overflow-y-auto p-4"
        id="doctor-error-content"
      >
        <FriendlyErrorPanel
          rawError={rawError}
          language={language}
          fileName={fileName}
          onJumpToError={onJumpToError}
          onClear={onClear}
        />
      </div>
    </dialog>
  );
};
