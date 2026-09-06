/// <reference types="node" />

interface FeedbackRequest {
  type?: unknown;
  message?: unknown;
  theme?: unknown;
  language?: unknown;
  app_version?: unknown;
}

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return res.status(405).json({ error: 'Method not allowed' });
    }

    const body = (req.body ?? {}) as FeedbackRequest;
    const type = body.type;
    const message = typeof body.message === 'string' ? body.message.trim() : '';
    const theme = body.theme;
    const language = body.language;
    const appVersion =
      typeof body.app_version === 'string' && body.app_version.trim()
        ? body.app_version.trim()
        : '0.0.0';

    if (
      type !== 'bug' &&
      type !== 'suggestion' &&
      type !== 'feedback'
    ) {
      return res.status(400).json({ error: 'Please choose a valid feedback type.' });
    }

    if (!message || message.length > 5000) {
      return res.status(400).json({
        error: 'Feedback must contain between 1 and 5000 characters.',
      });
    }

    if (typeof theme !== 'string' || typeof language !== 'string') {
      return res.status(400).json({
        error: 'Feedback is missing the current editor context.',
      });
    }

    const supabaseUrl = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceRoleKey) {
      console.error('Feedback Supabase credentials are not configured.');
      return res.status(503).json({
        error: 'Feedback service is not configured on the server.',
      });
    }

    const response = await fetch(`${supabaseUrl}/rest/v1/feedback`, {
      method: 'POST',
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({
        type,
        message,
        theme,
        language,
        app_version: appVersion,
      }),
    });

    if (!response.ok) {
      const details = await response.text();
      console.error('Supabase feedback error:', response.status, details);
      return res.status(502).json({
        error: 'Supabase rejected the feedback.',
        details: details.slice(0, 300),
      });
    }

    return res.status(201).json({ success: true });
  } catch (error) {
    console.error('Unhandled feedback error:', error);
    return res.status(502).json({
      error: 'Feedback service is temporarily unavailable.',
    });
  }
}
