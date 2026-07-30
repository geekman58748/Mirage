# Deploying BlackRail outside Replit

## Stack

- **Frontend:** Static HTML — Netlify (auto-deploys from `main`)
- **API:** Express/TypeScript — Railway (auto-deploys from `main`)
- **DB:** Neon Postgres (Drizzle ORM)
- **Auth:** Privy
- **Chain:** Solana devnet / MagicBlock Payments API

---

## 1. Database (Neon)

1. Go to [neon.tech](https://neon.tech) → create a free account → create a project called `blackrail`
2. Copy the connection string — it looks like `postgres://user:pass@host/dbname`
3. Run migrations: `pnpm --filter @workspace/db run db:push`

---

## 2. API Server (Railway)

1. Go to [railway.app](https://railway.app) → New Project → Deploy from GitHub repo → pick `geekman58748/blackrail`
2. Add the following environment variables in Railway:

```
NEON_DATABASE_URL=<your neon connection string>
SESSION_SECRET=<random 64-char string>
SERVER_KEYPAIR=<base58-encoded server keypair>
USDC_MINT=4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU
MERCHANT_USDC_ATA=<your vault ATA address>
PRIVY_APP_ID=<your privy app id>
PRIVY_APP_SECRET=<your privy app secret>
```

3. Railway picks up `nixpacks.toml` automatically — no extra config needed
4. Once deployed, copy the Railway URL

---

## 3. Frontend (Netlify)

1. Go to [netlify.com](https://netlify.com) → Add new site → Import from Git → pick `geekman58748/blackrail`
2. Build command: *(leave blank — static site)*
3. Publish directory: `/` (root)
4. Add environment variable:

```
API_BASE=https://<your-railway-url>
```

5. Update the `API_BASE` constant in `pages/dashboard.html`, `pages/checkout.html`, and `index.html` to point to your Railway URL if different from `mirage-production-6dfc.up.railway.app`

---

## Vault

Server wallet pubkey: `2QGJqSPWogpnrsrEagH4Mn28JjvuxMjrNMPbUst56j6Y`  
Vault ATA: `B82AzAWZsvVUwW1iddK8H45E1rj6QKS36X9FPFtHmbjM`

---

## Mainnet

Mainnet-ready — two steps:
1. Deploy the Anchor program on mainnet and update `ANCHOR_PROGRAM_ID` in Railway env vars
2. Update `SOLANA_RPC_URL`, `USDC_MINT`, and `MAGICBLOCK_API_URL` to mainnet values

That is it. No architecture changes required.
