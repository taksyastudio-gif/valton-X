/// <reference types="node" />

import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

// Vercel serverless function: secure Brevo email export proxy.
// The client never sees BREVO_API_KEY; this handler sends the email
// server-side using the Brevo v3 SMTP API.

export default async function handler(req, res) {
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
    return res.status(401).json({
      error: 'Sign-in is required before sending an email export.',
    });
  }

  const firebaseProjectId = process.env.FIREBASE_PROJECT_ID;
  const firebaseClientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const firebasePrivateKey = process.env.FIREBASE_PRIVATE_KEY;

  if (
    !firebaseProjectId ||
    !firebaseClientEmail ||
    !firebasePrivateKey
  ) {
    console.error('Firebase server credentials are not configured.');
    return res.status(503).json({
      error: 'Authentication service is not configured on the server.',
    });
  }

  let authenticatedUser;

  try {
    const firebaseApp =
      getApps()[0] ??
      initializeApp({
        credential: cert({
          projectId: firebaseProjectId,
          clientEmail: firebaseClientEmail,
          privateKey: firebasePrivateKey.replace(/\\n/g, '\n'),
        }),
      });

    authenticatedUser = await getAuth(firebaseApp).verifyIdToken(idToken);
  } catch (error) {
    console.error('Firebase token verification failed:', error);
    return res.status(401).json({
      error: 'Your sign-in session is invalid or expired.',
    });
  }

  if (!turnstileToken || typeof turnstileToken !== 'string') {
    return res.status(400).json({
      error: 'Security verification is required.',
    });
  }

  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseServiceRoleKey) {
    console.error('Supabase server quota credentials are not configured.');
    return res.status(503).json({
      error: 'Export quota service is not configured on the server.',
    });
  }

  const quotaHeaders = {
    apikey: supabaseServiceRoleKey,
    Authorization: `Bearer ${supabaseServiceRoleKey}`,
    'Content-Type': 'application/json',
  };
  const exportDate = new Date().toISOString().slice(0, 10);
  const quotaUrl =
    `${supabaseUrl}/rest/v1/email_export_usage` +
    `?firebase_uid=eq.${encodeURIComponent(authenticatedUser.uid)}` +
    `&export_date=eq.${exportDate}&select=id,status,created_at&limit=1`;
  let quotaId;

  try {
    const quotaResponse = await fetch(quotaUrl, {
      headers: quotaHeaders,
    });
    const existingRows = await quotaResponse.json();

    if (!quotaResponse.ok || !Array.isArray(existingRows)) {
      throw new Error('Quota lookup failed.');
    }

    const existing = existingRows[0];

    if (existing?.status === 'sent') {
      return res.status(429).json({
        error: 'Your daily email export has already been used.',
        fallbackAllowed: true,
      });
    }

    if (existing?.status === 'pending') {
      const createdAt = Date.parse(existing.created_at);

      if (
        Number.isFinite(createdAt) &&
        Date.now() - createdAt < 10 * 60 * 1000
      ) {
        return res.status(429).json({
          error: 'An email export is already being processed.',
          fallbackAllowed: true,
        });
      }

      await fetch(
        `${supabaseUrl}/rest/v1/email_export_usage?id=eq.${existing.id}`,
        {
          method: 'DELETE',
          headers: quotaHeaders,
        },
      );
    }

    const claimResponse = await fetch(
      `${supabaseUrl}/rest/v1/email_export_usage`,
      {
        method: 'POST',
        headers: {
          ...quotaHeaders,
          Prefer: 'return=representation',
        },
        body: JSON.stringify({
          firebase_uid: authenticatedUser.uid,
          export_date: exportDate,
          recipient_email: email,
          status: 'pending',
        }),
      },
    );

    if (!claimResponse.ok) {
      if (claimResponse.status === 409) {
        return res.status(429).json({
          error: 'Your daily email export has already been used.',
          fallbackAllowed: true,
        });
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
    return res.status(503).json({
      error: 'Email export is temporarily unavailable.',
      fallbackAllowed: true,
    });
  }

  const turnstileSecret = process.env.TURNSTILE_SECRET_KEY;

  if (!turnstileSecret) {
    console.error('TURNSTILE_SECRET_KEY is not configured.');
    return res.status(503).json({
      error: 'Security verification is not configured on the server.',
    });
  }

  try {
    const verificationResponse = await fetch(
      'https://challenges.cloudflare.com/turnstile/v0/siteverify',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          secret: turnstileSecret,
          response: turnstileToken,
        }),
      },
    );
    const verification = await verificationResponse.json();

    if (!verification.success) {
      return res.status(403).json({
        error: 'Security verification failed. Please try again.',
      });
    }
  } catch (error) {
    console.error('Turnstile verification failed:', error);
    return res.status(502).json({
      error: 'Security verification could not be completed.',
    });
  }

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

  const apiKey = process.env.BREVO_API_KEY;
  const senderEmail = process.env.BREVO_SENDER_EMAIL;
  const senderName = process.env.BREVO_SENDER_NAME || 'Valton X';

  if (!apiKey || !senderEmail) {
    console.error(
      'BREVO_API_KEY or BREVO_SENDER_EMAIL is not configured.',
    );
    return res.status(500).json({
      error: 'Email service is not configured on the server.',
    });
  }

  const body = {
    sender: { email: senderEmail, name: senderName },
    to: [{ email }],
    subject: `Valton X export: ${filename}`,
    htmlContent: `
      <p>Here is your exported project source <strong>${filename}</strong> from Valton X:</p>
      <pre style="background:#f4f4f4;padding:12px;border-radius:6px;overflow:auto;font-size:13px;">${content.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</pre>
      <p style="color:#888;font-size:12px;">Sent from Valton X — Browser-Native Web IDE</p>
    `,
  };

  console.info('Email export requested by Firebase user:', authenticatedUser.uid);

  try {
    const response = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-key': apiKey,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text();
      console.error('Brevo API error:', response.status, text);
      await releaseQuota(supabaseUrl, quotaHeaders, quotaId);
      return res.status(502).json({
        error: 'Email provider rejected the request.',
        fallbackAllowed: true,
      });
    }

    const providerResult = await response.json();
    const updateResponse = await fetch(
      `${supabaseUrl}/rest/v1/email_export_usage?id=eq.${quotaId}`,
      {
        method: 'PATCH',
        headers: {
          ...quotaHeaders,
          Prefer: 'return=minimal',
        },
        body: JSON.stringify({
          status: 'sent',
          provider_message_id: providerResult.messageId ?? null,
          sent_at: new Date().toISOString(),
        }),
      },
    );

    if (!updateResponse.ok) {
      console.error('Could not finalize email export quota.');
    }

    return res.status(200).json({ success: true });
  } catch (error) {
    console.error('Brevo request failed:', error);
    await releaseQuota(supabaseUrl, quotaHeaders, quotaId);
    return res.status(502).json({
      error: 'Failed to send email.',
      fallbackAllowed: true,
    });
  }
}

async function releaseQuota(
  supabaseUrl,
  headers,
  quotaId,
) {
  if (!quotaId) {
    return;
  }

  await fetch(
    `${supabaseUrl}/rest/v1/email_export_usage?id=eq.${quotaId}`,
    {
      method: 'DELETE',
      headers,
    },
  );
}
