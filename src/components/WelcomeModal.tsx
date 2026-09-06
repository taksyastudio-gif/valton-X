import { useEffect, type FC, type MouseEvent } from 'react';
import { X } from 'lucide-react';

interface WelcomeModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const WELCOME_DISMISSED_KEY = 'valton-x-welcome-dismissed';

const dismissWelcome = (): void => {
  window.localStorage.setItem(WELCOME_DISMISSED_KEY, 'true');
};

export const WelcomeModal: FC<WelcomeModalProps> = ({ isOpen, onClose }) => {
  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        dismissWelcome();
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) {
    return null;
  }

  const handleDismiss = (): void => {
    dismissWelcome();
    onClose();
  };

  const handleBackdropClick = (event: MouseEvent<HTMLDivElement>): void => {
    if (event.target === event.currentTarget) {
      handleDismiss();
    }
  };

  return (
    <div
      aria-labelledby="welcome-modal-title"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onMouseDown={handleBackdropClick}
      role="dialog"
    >
      <div className="modal-panel w-full max-w-[450px] rounded-xl border p-6 shadow-2xl">
        <div className="mb-4 flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div>
              <h2
                className="text-lg font-bold text-primary"
                id="welcome-modal-title"
              >
                Welcome to Valton X
              </h2>
              <p className="text-xs text-muted">by TAKSYA STUDIO</p>
            </div>
          </div>

          <button
            aria-label="Close welcome dialog"
            className="icon-action rounded-md p-1.5"
            onClick={handleDismiss}
            type="button"
          >
            <X size={18} />
          </button>
        </div>

        <p className="mb-6 text-sm leading-relaxed text-secondary">
           Valton X is a free browser-based workspace for writing and running
          C, C++, Python, HTML, CSS, and JavaScript. Your code runs locally in
          your browser whenever the selected language supports it.
        </p>

        <div className="flex flex-col gap-3 sm:flex-row">
          <button
            className="primary-action flex-1 rounded-lg px-4 py-2.5 text-sm font-semibold"
            onClick={handleDismiss}
            type="button"
          >
            Start coding
          </button>

          <button
            className="secondary-action flex-1 rounded-lg px-4 py-2.5 text-sm font-medium"
            onClick={handleDismiss}
            type="button"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

// eslint-disable-next-line react-refresh/only-export-components
export const shouldShowWelcome = (): boolean => {
  if (typeof window === 'undefined') {
    return false;
  }

  return window.localStorage.getItem(WELCOME_DISMISSED_KEY) !== 'true';
};

export default WelcomeModal;