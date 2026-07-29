# Deploying Mirage outside Replit

Two services to deploy. Both are free, no Supabase.

---

## 1 — Database: Neon (free Postgres)

1. Go to [neon.tech](https://neon.tech) → create a free account → create a project called `mirage`
2. Copy the **connection string** — looks like:
   ```
   postgresql://user:password@ep-xxx.us-east-2.aws.neon.tech/neondb?sslmode=require
   ```
3. Save it — you'll paste it as `DATABASE_URL` in Railway next.

Run migrations against Neon once you have the URL:
```bash
DATABASE_URL="postgresql://..." pnpm --filter @workspace/db exec drizzle-kit push
```

---

## 2 — API Server: Railway

1. Go to [railway.app](https://railway.app) → New Project → Deploy from GitHub repo → pick `geekman58748/Mirage`
2. Set **Root Directory** to `artifacts/api-server`
3. Add these environment variables in Railway:
   ```
   DATABASE_URL   = <your Neon connection string>
   SESSION_SECRET = <any random 32-char string>
   PORT           = 8080
   NODE_ENV       = production
   ```
4. Railway auto-detects `railway.json` and builds + starts the server.
5. Once deployed, copy the Railway URL — looks like `https://mirage-api-production.up.railway.app`

---

## 3 — Frontend: Tell Netlify the API URL

In Netlify → Site Settings → Environment Variables, add:
```
MIRAGE_API_BASE = https://mirage-api-production.up.railway.app/api
```

Then in your HTML, the `window.MIRAGE_API_BASE` injection:

Add this to `netlify.toml`:
```toml
[[headers]]
  for = "/*"
  [headers.values]
    Content-Security-Policy = ""

[[plugins]]
# no plugin needed — use a _headers file or inject via edge function
```

Simplest approach — add one line in each HTML page `<head>`:
```html
<script>window.MIRAGE_API_BASE = '%%MIRAGE_API_BASE%%';</script>
```
Netlify replaces `%%VAR%%` with environment variables at build time when using the
[Netlify Build plugin for env injection](https://github.com/netlify/netlify-plugin-inline-env).

Or just hardcode the Railway URL directly in the two HTML files once you have it.

---

## Summary

| What | Where | Cost |
|---|---|---|
| Database | Neon | Free (0.5 GB storage) |
| API | Railway | Free ($5/mo credit) |
| Frontend | Netlify | Free |
