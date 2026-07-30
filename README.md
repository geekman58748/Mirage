# BlackRail — Private Merchant Payment Gateway on Solana

> **Every payment hides your business. Every address dies after one use.**

Live demo → [blackrail.xyz](https://blackrail.xyz)  
Merchant portal → [blackrail.xyz/pages/dashboard.html](https://blackrail.xyz/pages/dashboard.html)  
API → [mirage-production-6dfc.up.railway.app](https://mirage-production-6dfc.up.railway.app)

---

## The Problem

Public blockchains are surveillance infrastructure for your competitors.

When a merchant accepts crypto payments to a fixed wallet address, anyone can watch it in real-time: total revenue, order frequency, biggest customers, slow months. A Solana wallet address is a permanent, public business ledger — visible to every competitor, data broker, and bad actor with a browser.

No serious merchant would publish their bank balance on a billboard. But that's exactly what crypto payments force them to do today.

---

## What BlackRail Does

BlackRail is a private payment gateway. Every checkout session generates a **disposable, one-time facade address**. The buyer pays it on-chain like any normal SPL transfer. The merchant's real vault address never appears anywhere in the transaction trail.

The facade is swept to the merchant's private vault using **MagicBlock's Private Ephemeral Rollup infrastructure** — routing funds through MagicBlock's internal ER network rather than a direct on-chain transfer, breaking the public link between buyer and merchant.

```
Buyer wallet  →  Ephemeral facade  →  [MagicBlock ER]  →  Merchant vault
   (public)         (disposable)         (private)          (hidden)
```

After settlement, the facade address is destroyed. The on-chain record shows a payment to an address that no longer exists and cannot be traced back to the merchant.

---

## Why This Is an Ephemeral Rollups Use Case

MagicBlock's Ephemeral Rollups aren't just for games. They're **programmable private state transitions** — and payment settlement is exactly that: a state change (facade → vault) that should be private, atomic, and fast.

BlackRail uses the **MagicBlock Payments API (`/v1/spl/transfer` with `visibility: "private"`)** to route the sweep through MagicBlock's ER infrastructure. The on-chain settlement doesn't show a direct facade→vault SPL transfer. It routes through MagicBlock's internal ephemeral network (`EiV97...`), surfacing on-chain only at the vault receive — with no readable link to the source facade.

This is the core primitive that makes BlackRail possible. Without private ER routing, the sweep would be visible on-chain and the privacy guarantee collapses.

---

## How It Works — Full Flow

```
1. MERCHANT creates a checkout session via API or dashboard
   POST /api/sessions → { facadeAddress, sessionId, checkoutURL }

2. SERVER generates a fresh Solana keypair (the "facade")
   createFacade() → ephemeral keypair stored server-side only

3. BUYER pays the facade address (standard SPL USDC transfer)
   Normal on-chain transaction. Facade address is publicly visible.

4. SERVER detects payment via balance polling
   GET /api/sessions/:id/balance → checks facade ATA balance

5. SERVER triggers private settlement via MagicBlock
   POST https://payments.magicblock.app/v1/spl/transfer
   { from: facade, to: vaultATA, visibility: "private", gasless: true }

6. MAGICBLOCK returns a partially-signed VersionedTransaction
   Crank keypair (CrankS2f...) pre-signs. Server adds facade signature.
   vtx.addSignature(facadePubkey, nacl.sign.detached(msg, facadeSecretKey))
   → preserves crank signature, avoids double-sign wipe

7. SERVER submits the versioned transaction
   Funds route through MagicBlock's ER network → vault receives net USDC
   No direct facade→vault link exists on-chain

8. SESSION marked settled. Facade keypair discarded.
```

---

## Technical Notes for Judges

**Fee handling:** MagicBlock charges ~0.2 USDC flat on top of the transfer amount (`gasless: true` mode). BlackRail does a two-call approach — first call to get the fee, subtract from amount, second call with adjusted amount so the facade balance covers both. This was a non-obvious integration detail.

**Signature preservation:** `VersionedTransaction.sign([facade])` wipes existing signatures, including MagicBlock's crank pre-signature. We use `vtx.addSignature()` directly with `nacl.sign.detached()` to add the facade signature without disturbing the crank's. Critical for the transaction to be valid.

**Gasless minimum:** `gasless: true` requires ≥ 0.5 USDC. Payments below this threshold fall back to standard SPL (not private). This is surfaced in the UI.

**Atomic settlement guard:** Session status updated with `WHERE status = 'active'` in the same SQL query that triggers settlement, preventing duplicate settle attempts under concurrent poll hits.

**DB:** Neon Postgres via Drizzle ORM. Schema: `sessions` (facade keypair encrypted at rest, status, amount, expiry) + `payments` (settled records).

---

## Stack

| Layer | Tech |
|---|---|
| Frontend | Static HTML/CSS/JS on Netlify |
| API | Express + TypeScript on Railway |
| Database | Neon Postgres (Drizzle ORM) |
| Auth | Privy (Google, Twitter, email OTP) |
| Blockchain | Solana devnet, `@solana/web3.js` |
| Privacy layer | **MagicBlock Payments API — Private ER routing** |
| QR codes | QRCode.js |

---

## API Reference

```
POST   /api/sessions          Create checkout session → facade address + QR
GET    /api/sessions/:id       Get session state
GET    /api/sessions/:id/balance  Check facade on-chain balance
POST   /api/sessions/:id/settle   Trigger private MB settlement
GET    /api/payments           Merchant payment history
GET    /api/vault/balance      Vault USDC balance
POST   /api/vault/withdraw     Withdraw from vault to any address
```

---

## Hackathon Track

**MagicBlock Blitz — Ephemeral Rollups / Private ERs**

BlackRail demonstrates a real-world payment primitive built on MagicBlock's private ER infrastructure. The use case is immediately legible to non-crypto users, the integration is non-trivial (fee handling, signature preservation, atomic guards), and the product is fully live end-to-end on Solana devnet.

Privacy in crypto payments is a $10B+ unsolved problem. BlackRail is the first working implementation of merchant payment privacy using Ephemeral Rollups.

---

## Vault

- Server keypair (vault owner): `2QGJqSPWogpnrsrEagH4Mn28JjvuxMjrNMPbUst56j6Y`
- Vault USDC ATA: `B82AzAWZsvVUwW1iddK8H45E1rj6QKS36X9FPFtHmbjM`
- Network: Solana devnet

---

*Built at MagicBlock Blitz 2025.*
