# Mirage — Private Crypto Merchant Gateway

> One-time ephemeral addresses. Zero on-chain link between buyer and merchant.

---

## What's built

| Layer | Status | Notes |
|---|---|---|
| Landing page (`index.html`) | ✅ Working | Privy auth (email OTP + Google/Twitter OAuth) |
| Merchant dashboard (`pages/dashboard.html`) | ✅ Working | Live stats + payment feed from API |
| Buyer checkout (`pages/checkout.html`) | ✅ Working | URL-param driven; logs real payment on confirm |
| OAuth callback (`pages/auth-callback.html`) | ✅ Working | Exchanges code → token, redirects to dashboard |
| Express API (`artifacts/api-server`) | ✅ Running | In-memory ledger; resets on restart |

---

## Stack

- **Frontend** — pure HTML/CSS/JS, no build step, deployed to Netlify via GitHub push to `main`
- **Auth** — [Privy](https://privy.io) App ID `cms56lvu500030ckz9hxe7lex`, direct REST API calls (no SDK)
- **Payments API** — Replit Express (`artifacts/api-server`), in-memory store for now
- **Blockchain** — Solana (devnet for now); MagicBlock ephemeral rollups planned

---

## Auth implementation

Auth uses **direct `fetch` calls to Privy's REST API** — no SDK, no CDN imports.

```
POST https://auth.privy.io/api/v1/passwordless/init          → send email OTP
POST https://auth.privy.io/api/v1/passwordless/authenticate  → verify code → get token
POST https://auth.privy.io/api/v1/oauth/init                 → get Google/Twitter redirect URL
POST https://auth.privy.io/api/v1/oauth/authenticate         → exchange OAuth code → get token
```

Token is stored in `localStorage` as `privy_token`. Dashboard reads it to gate access.

**Privy dashboard requirements** (`dashboard.privy.io`):
- Email, Google, Twitter login methods must be toggled **on**
- Your Netlify URL must be in **Allowed Origins**

---

## API routes

Base URL: set `window.MIRAGE_API_BASE` or falls back to `/api` (works proxied in Replit dev).

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | Liveness check |
| `POST` | `/api/payments` | Log a payment `{ amount, currency, session, txHash? }` |
| `GET` | `/api/payments` | Full payment ledger |
| `GET` | `/api/payments/stats` | Totals + 10 most recent payments |

---

## Deploying

- **Frontend** → push to `main`; Netlify auto-deploys.
- **API** → runs on Replit (`artifacts/api-server`). Set `MIRAGE_API_BASE` in the frontend to the Replit dev domain when testing from Netlify.

---

## What's next (proposed tasks)

### Task 1 — MagicBlock ephemeral sessions ⬅ do this first
Wire `POST /api/sessions/create` to generate a real one-time facade address per checkout via the MagicBlock SDK. Update `checkout.html` to pull the address from the API instead of the hardcoded placeholder. **This is the core privacy feature — nothing is actually private yet.**

### Task 2 — Anchor program: MerchantVault
On-chain identity for merchants. `initialize_merchant` instruction creates a `MerchantVault` PDA that owns sessions. `close_session` settles funds and closes the ephemeral account. Requires Rust/Anchor toolchain.

### Task 3 — Mobile companion app
Expo artifact for merchants: monitor live payments and generate shareable checkout links on the go.

---

## File structure

```
/
├── index.html                  # Landing + sign-in modal
├── pages/
│   ├── dashboard.html          # Merchant portal
│   ├── checkout.html           # Buyer-facing payment page
│   └── auth-callback.html      # OAuth redirect handler
├── assets/
│   ├── css/                    # Stylesheets
│   ├── js/                     # JS modules
│   └── img/                    # Images
├── artifacts/
│   └── api-server/             # Replit Express API
│       └── src/routes/
│           ├── payments.ts     # Payment log endpoints
│           └── index.ts        # Router mount
├── netlify.toml                # SPA redirect rule
└── README.md
```
