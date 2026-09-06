import { useState, type FC } from 'react';

import {
  submitUserFeedback,
  type FeedbackType,
} from '../lib/supabase';
import type {
  EditorTheme,
  SupportedLanguage,
} from '../types/byteplay';

interface FeedbackModalProps {
  currentLanguage: SupportedLanguage;
  currentTheme: EditorTheme;
  isOpen: boolean;
  onClose: () => void;
}

export const FeedbackModal: FC<FeedbackModalProps> = ({
  currentLanguage,
  currentTheme,
  isOpen,
  onClose,
}) => {
  const [type, setType] = useState<FeedbackType>('bug');
  const [message, setMessage] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!isOpen) {
    return null;
  }

  const handleSubmit = async (): Promise<void> => {
    setStatus(null);
    setIsSubmitting(true);

    try {
      await submitUserFeedback({
        type,
        message,
        theme: currentTheme,
        language: currentLanguage,
        app_version: 'valton-x',
      });
      setMessage('');
      setStatus('Thanks — your feedback was sent.');
    } catch (error: unknown) {
      setStatus(
        error instanceof Error
          ? error.message
          : 'Feedback could not be sent.',
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      aria-labelledby="feedback-title"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
      role="dialog"
    >
      <div
        className="w-full max-w-md rounded-xl border border-theme bg-surface p-5 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <h2
          className="text-base font-semibold text-primary"
          id="feedback-title"
        >
          Send feedback
        </h2>
        <p className="mt-1 text-xs text-muted">
          Report a bug, suggest an improvement, or share your
          experience.
        </p>

        <label className="mt-4 block text-xs font-medium text-secondary">
          Feedback type
          <select
            className="input-field mt-1 w-full rounded border px-3 py-2 text-sm outline-none"
            onChange={(event) =>
              setType(event.target.value as FeedbackType)
            }
            value={type}
          >
            <option value="bug">Bug report</option>
            <option value="suggestion">Suggestion</option>
            <option value="feedback">General feedback</option>
          </select>
        </label>

        <label className="mt-3 block text-xs font-medium text-secondary">
          Message
          <textarea
            className="input-field mt-1 min-h-28 w-full resize-y rounded border px-3 py-2 text-sm outline-none"
            maxLength={5000}
            onChange={(event) => setMessage(event.target.value)}
            placeholder="Describe your experience..."
            value={message}
          />
        </label>

        {status ? (
          <p className="mt-3 text-xs text-secondary">{status}</p>
        ) : null}

        <div className="mt-4 flex justify-end gap-2">
          <button
            className="secondary-action rounded border px-3 py-2 text-xs font-medium"
            onClick={onClose}
            type="button"
          >
            Close
          </button>
          <button
            className="primary-action rounded px-3 py-2 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-50"
            disabled={isSubmitting}
            onClick={() => void handleSubmit()}
            type="button"
          >
            {isSubmitting ? 'Sending…' : 'Send feedback'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default FeedbackModal;
