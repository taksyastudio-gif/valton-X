/// <reference types="node" />

import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

// -----------------------------------------------------------------------------
// Email Export Serverless Function – environment validation & top‑level error guard
// -----------------------------------------------------------------------------

export default async function handler(req, res) {
  try {
    const requiredEnv = {
      FIREBASE_PROJECT_ID: process.env.FIREBASE_PROJECT_ID,
      FIREBASE_CLIENT_EMAIL: process.env.FIREBASE_CLIENT_EMAIL,
      FIREBASE_PRIVATE_KEY: process.env.FIREBASE_PRIVATE_KEY,
      SUPABASE_URL: process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
      TURNSTILE_SECRET_KEY: process.env.TURNSTILE_SECRET_KEY,
      BREVO_API_KEY: process.env.BREVO_API_KEY,
      BREVO_SENDER_EMAIL: process.env.BREVO_SENDER_EMAIL,
    };

    for (const [name, value] of Object.entries(requiredEnv)) {
      if (!value) {
        console.error(`${name} is missing`);
        return res.status(500).json({ error: `${name} is not configured on the server.` });
      }
    }

    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return res.status(405).json({ error: 'Method not allowed' });
    }

    const { email, filename, content, turnstileToken } = req.body ?? {};

    const authorization = req.headers.authorization;
    const idToken =
      typeof authorization === 'string' &&
      authorization.startsWith('Bearer ')
        ? authorization.slice('Bearer '.length)
        : '';

    if (!idToken) {
      return res.status(401).json({ error: 'Sign-in is required before sending an email export.' });
    }

    // ---------------------------------------------------------------------
    // Firebase authentication
    // ---------------------------------------------------------------------
    const { FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY } = requiredEnv;
    const firebaseApp =
      getApps()[0] ??
      initializeApp({
        credential: cert({
          projectId: FIREBASE_PROJECT_ID,
          clientEmail: FIREBASE_CLIENT_EMAIL,
          privateKey: FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
        }),
      });
    let authenticatedUser;
    try {
      authenticatedUser = await getAuth(firebaseApp).verifyIdToken(idToken);
    } catch (error) {
      console.error('Firebase token verification failed:', error);
      return res.status(401).json({ error: 'Your sign-in session is invalid or expired.' });
    }

    if (!turnstileToken || typeof turnstileToken !== 'string') {
      return res.status(400).json({ error: 'Security verification is required.' });
    }

    // ---------------------------------------------------------------------
    // Supabase quota handling
    // ---------------------------------------------------------------------
    const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = requiredEnv;
    const quotaHeaders = {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
    };
    const exportDate = new Date().toISOString().slice(0, 10);
    const quotaUrl =
      `${SUPABASE_URL}/rest/v1/email_export_usage` +
      `?firebase_uid=eq.${encodeURIComponent(authenticatedUser.uid)}` +
      `&export_date=eq.${exportDate}&select=id,status,created_at&limit=1`;
    let quotaId;
    try {
      const quotaResponse = await fetch(quotaUrl, { headers: quotaHeaders });
      const existingRows = await quotaResponse.json();
      if (!quotaResponse.ok || !Array.isArray(existingRows)) {
        throw new Error('Quota lookup failed.');
      }
      const existing = existingRows[0];
      if (existing?.status === 'sent') {
        return res.status(429).json({ error: 'Your daily email export has already been used.', fallbackAllowed: true });
      }
      if (existing?.status === 'pending') {
        const createdAt = Date.parse(existing.created_at);
        if (Number.isFinite(createdAt) && Date.now() - createdAt < 10 * 60 * 1000) {
          return res.status(429).json({ error: 'An email export is already being processed.', fallbackAllowed: true });
        }
        await fetch(`${SUPABASE_URL}/rest/v1/email_export_usage?id=eq.${existing.id}`, {
          method: 'DELETE',
          headers: quotaHeaders,
        });
      }
      const claimResponse = await fetch(`${SUPABASE_URL}/rest/v1/email_export_usage`, {
        method: 'POST',
        headers: { ...quotaHeaders, Prefer: 'return=representation' },
        body: JSON.stringify({
          firebase_uid: authenticatedUser.uid,
          export_date: exportDate,
          recipient_email: email,
          status: 'pending',
        }),
      });
      if (!claimResponse.ok) {
        if (claimResponse.status === 409) {
          return res.status(429).json({ error: 'Your daily email export has already been used.', fallbackAllowed: true });
        }
        throw new Error('Quota claim failed.');
      }
      const claimedRows = await claimResponse.json();
      quotaId = claimedRows[0]?.id;
      if (!quotaId) {
        throw new Error('Quota claim did not return an id.');
      }
    } catch (error) {
      console.error('Email export quota failed:', error);
      return res.status(503).json({ error: 'Email export is temporarily unavailable.', fallbackAllowed: true });
    }

    // ---------------------------------------------------------------------
    // Turnstile verification
    // ---------------------------------------------------------------------
    const { TURNSTILE_SECRET_KEY } = requiredEnv;
    try {
      const verificationResponse = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ secret: TURNSTILE_SECRET_KEY, response: turnstileToken }),
      });
      const verification = await verificationResponse.json();
      if (!verification.success) {
        return res.status(403).json({ error: 'Security verification failed. Please try again.' });
      }
    } catch (error) {
      console.error('Turnstile verification failed:', error);
      return res.status(502).json({ error: 'Security verification could not be completed.' });
    }

    // ---------------------------------------------------------------------
    // Input validation
    // ---------------------------------------------------------------------
    if (!email || typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'A valid recipient email is required.' });
    }
    if (!filename || typeof filename !== 'string') {
      return res.status(400).json({ error: 'filename is required.' });
    }
    if (typeof content !== 'string') {
      return res.status(400).json({ error: 'content is required.' });
    }
    if (content.length > 10 * 1024 * 1024) {
      return res.status(413).json({ error: 'The export is too large to email.' });
    }

    // ---------------------------------------------------------------------
    // Brevo email sending
    // ---------------------------------------------------------------------
    const { BREVO_API_KEY, BREVO_SENDER_EMAIL, BREVO_SENDER_NAME } = requiredEnv;
    const body = {
      sender: { email: BREVO_SENDER_EMAIL, name: BREVO_SENDER_NAME || 'Valton X' },
      to: [{ email }],
      subject: `Valton X export: ${filename}`,
      htmlContent: `\n<p>Here is your exported project source <strong>${filename}</strong> from Valton X:</p>\n<pre style="background:#f4f4f4;padding:12px;border-radius:6px;overflow:auto;font-size:13px;">${content.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</pre>\n<p style="color:#888;font-size:12px;">Sent from Valton X — Browser-Native Web IDE</p>`,
    };
    console.info('Email export requested by Firebase user:', authenticatedUser.uid);
    try {
      const brevoResponse = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'api-key': BREVO_API_KEY },
        body: JSON.stringify(body),
      });
      if (!brevoResponse.ok) {
        const txt = await brevoResponse.text();
        console.error('Brevo API error:', brevoResponse.status, txt);
        await releaseQuota(SUPABASE_URL, quotaHeaders, quotaId);
        return res.status(502).json({ error: 'Email provider rejected the request.', fallbackAllowed: true });
      }
      const providerResult = await brevoResponse.json();
      // Update quota as sent
      await fetch(`${SUPABASE_URL}/rest/v1/email_export_usage?id=eq.${quotaId}`, {
        method: 'PATCH',
        headers: { ...quotaHeaders, Prefer: 'return=minimal' },
        body: JSON.stringify({
          status: 'sent',
          provider_message_id: providerResult.messageId ?? null,
          sent_at: new Date().toISOString(),
        }),
      });
      return res.status(200).json({ success: true });
    } catch (error) {
      console.error('Brevo request failed:', error);
      await releaseQuota(SUPABASE_URL, quotaHeaders, quotaId);
      return res.status(502).json({ error: 'Failed to send email.', fallbackAllowed: true });
    }
  } catch (unhandled) {
    console.error('Unhandled exception in export‑email handler:', unhandled);
    return res.status(502).json({ error: 'Internal server error – please try again later.' });
  }
}

// ---------------------------------------------------------------------------
// Helper: release the Supabase quota row if something goes wrong
// ---------------------------------------------------------------------------
async function releaseQuota(supabaseUrl, headers, quotaId) {
  if (!quotaId) return;
  await fetch(`${supabaseUrl}/rest/v1/email_export_usage?id=eq.${quotaId}`, {
    method: 'DELETE',
    headers,
  });
}
