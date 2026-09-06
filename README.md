# Valton X

A browser-based C and HTML learning app with a real backend compiler path for deployment.

## Local development

```bash
npm install
npm run dev
npm run server
```

The frontend expects a backend URL in `.env` when using the production compiler path:

```env
VITE_BACKEND_URL=http://localhost:3001
PORT=3001
```

### Supabase feedback

Copy and run [`supabase/feedback.sql`](supabase/feedback.sql) in the Supabase SQL
editor, then set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in the frontend
environment. The policy permits feedback submissions but does not expose
feedback rows for public reads.

### Email export

The Export dialog can send the current project source to a recipient through
the Vercel serverless function at `/api/export-email`. Configure these
variables in the Vercel project settings:

```env
FIREBASE_PROJECT_ID=valton-x
FIREBASE_CLIENT_EMAIL=your-firebase-admin-client-email
FIREBASE_PRIVATE_KEY=your-firebase-admin-private-key
TURNSTILE_SECRET_KEY=your-turnstile-secret-key
VITE_SUPABASE_URL=your-supabase-project-url
SUPABASE_SERVICE_ROLE_KEY=your-supabase-service-role-key
BREVO_API_KEY=your-brevo-api-key
BREVO_SENDER_EMAIL=your-verified-sender@example.com
BREVO_SENDER_NAME=Valton X
```

The sender address must be verified in Brevo. The Brevo API key remains
server-side and must not use a `VITE_` prefix. Run
[`supabase/email_export_usage.sql`](supabase/email_export_usage.sql) in the
Supabase SQL editor before enabling email export. Each Firebase account gets
one successful email export per UTC day. If delivery is unavailable, the
client offers a ZIP download and a `mailto:` fallback.

## Render deployment

This project includes a Render config at [render.yaml](render.yaml) for the backend service.

### Recommended deployment structure

- Frontend: Vercel
- Backend: Render web service (Docker)
- C compiler: GCC installed in the backend container via the Dockerfile

### Deploy to Render

1. Push this repo to GitHub.
2. In Render, create a new Web Service.
3. Connect the repo.
4. Render will detect [render.yaml](render.yaml).
5. Confirm the service uses the Dockerfile.
6. The service will expose `/health` for health checks.

The backend listens on `PORT`, and the Docker image installs `gcc` and `build-essential` automatically.

### Frontend environment variable after deployment

Set this in your Vercel app:

```env
VITE_BACKEND_URL=https://your-render-backend-url.onrender.com
```

This tells the frontend to send C compile requests to the backend instead of the browser worker fallback.
