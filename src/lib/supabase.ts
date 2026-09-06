import { createClient } from '@supabase/supabase-js';

import type {
  EditorTheme,
  SupportedLanguage,
} from '../types/byteplay';

const supabaseUrl = (
  import.meta.env.VITE_SUPABASE_URL ?? ''
).trim();

const supabaseAnonKey = (
  import.meta.env.VITE_SUPABASE_ANON_KEY ?? ''
).trim();

const configuredBackendUrl = (
  import.meta.env.VITE_BACKEND_URL ?? ''
).trim();

const MAX_FEEDBACK_LENGTH = 5000;

export const isSupabaseConfigured = Boolean(
  supabaseUrl && supabaseAnonKey,
);

/**
 * Supabase is optional. Feedback falls back to the configured REST endpoint
 * when credentials are intentionally absent.
 */
export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl, supabaseAnonKey)
  : null;

export type FeedbackType =
  | 'bug'
  | 'suggestion'
  | 'feedback';

export interface FeedbackSubmission {
  type: FeedbackType;
  message: string;
  theme: EditorTheme;
  language: SupportedLanguage;
  app_version: string;
}

export async function submitUserFeedback(
  payload: FeedbackSubmission,
): Promise<void> {
  const validatedPayload = validateFeedbackPayload(payload);

  if (supabase) {
    try {
      const { error } = await supabase
        .from('feedback')
        .insert([validatedPayload]);

      if (!error) {
        return;
      }

      throw new Error(
        error.message || 'Failed to submit feedback to Supabase.',
      );
    } catch (error) {
      if (error instanceof Error && error.message !== 'Failed to fetch') {
        throw error;
      }

      await submitFeedbackThroughRest(validatedPayload);
      return;
    }
  }

  await submitFeedbackThroughRest(validatedPayload);
}

function validateFeedbackPayload(
  payload: FeedbackSubmission,
): FeedbackSubmission {
  const message = payload.message.trim();

  if (!message) {
    throw new Error('Please enter a message.');
  }

  if (message.length > MAX_FEEDBACK_LENGTH) {
    throw new Error(
      `Please keep your message under ${MAX_FEEDBACK_LENGTH} characters.`,
    );
  }

  if (!isFeedbackType(payload.type)) {
    throw new Error('Please choose a valid feedback type.');
  }

  if (!payload.theme || !payload.language) {
    throw new Error(
      'Feedback is missing the current editor context.',
    );
  }

  return {
    ...payload,
    message,
    app_version: payload.app_version.trim() || '0.0.0',
  };
}

async function submitFeedbackThroughRest(
  payload: FeedbackSubmission,
): Promise<void> {
  const endpoint = configuredBackendUrl
    ? `${configuredBackendUrl.replace(/\/$/, '')}/api/feedback`
    : '/api/feedback';

  let response: Response;

  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
  } catch {
    throw new Error(
      'Feedback service is unavailable. Check your connection and try again.',
    );
  }

  if (response.ok) {
    return;
  }

  const errorMessage = await readErrorMessage(response);

  throw new Error(errorMessage || 'Failed to submit feedback.');
}

async function readErrorMessage(
  response: Response,
): Promise<string | null> {
  const contentType = response.headers.get('content-type') ?? '';

  if (contentType.includes('application/json')) {
    const body: unknown = await response.json();

    if (typeof body === 'object' && body !== null) {
      const record = body as Record<string, unknown>;

      if (typeof record.error === 'string') {
        return record.error;
      }

      if (typeof record.message === 'string') {
        return record.message;
      }
    }

    return null;
  }

  const text = await response.text();
  return text.trim() || null;
}

function isFeedbackType(value: string): value is FeedbackType {
  return (
    value === 'bug' ||
    value === 'suggestion' ||
    value === 'feedback'
  );
}