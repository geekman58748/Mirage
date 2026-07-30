# BlackRail: Private Payment Gateway on Solana

> **Every payment hides your business. Every address dies after one use.**

Live demo: [blackrail.xyz](https://blackrail.xyz)  
Merchant portal: [blackrail.xyz/pages/dashboard.html](https://blackrail.xyz/pages/dashboard.html)  
API: [mirage-production-6dfc.up.railway.app](https://mirage-production-6dfc.up.railway.app)

---

## The Problem

Public blockchains are surveillance infrastructure for your competitors.

When anyone accepts crypto payments to a fixed wallet address, every detail is permanently visible on-chain: total revenue, order frequency, biggest customers, slow months, transaction sizes. A Solana wallet address is a public business ledger that anyone with a browser can read in real time.

Banks and centralized payment processors have always kept this data private by default. Stripe, Paystack, PayPal, and every bank in the world hold your revenue figures behind closed doors. The merchant sees them. The processor sees them. Nobody else does.

But centralized systems have a different problem: **they own your data, and they sell it.**

Cases are well-documented across both US and Nigerian fintech markets where centralized processors and financial institutions have monetized sensitive merchant data, including total revenue figures, sales velocity, loss patterns, and customer behaviour, by selling aggregated or identifiable data to competitors, insurers, lenders, and data brokers willing to pay for it. Paystack, Stripe, and PayPal all operate under terms of service that permit broad data sharing for "business purposes." The merchant never knows.

Crypto fixes the centralization problem but introduces a worse one: the data is now public to everyone, not just the processor.

BlackRail fixes both.

---

## Proven Demand: What We Are Building On

BlackRail draws direct inspiration from the payment infrastructure that already processes billions in volume. These products proved the market exists. BlackRail extends them into the privacy layer they were never designed to have.

**Stripe (US):** The global standard for developer payment APIs. Stripe processes hundreds of billions annually and built the concept of checkout sessions, webhook-driven settlement, and API-first merchant tooling. BlackRail's session model, API surface, and dashboard UX are directly inspired by Stripe. What Stripe cannot offer: any form of on-chain privacy.

**Paystack (Nigeria/Africa):** Acquired by Stripe for $200M. Built the same checkout session model for African merchants and proved massive demand for developer-friendly payment infrastructure in emerging markets. Nigerian merchants specifically face elevated risk from data exposure due to inconsistent data protection enforcement. BlackRail's privacy guarantees are especially relevant here.

**PayPal (Global):** The original internet payment layer. 400M+ active users. PayPal proved that merchants want abstraction between the payer and their real financial identity. BlackRail brings that abstraction to crypto natively.

**The gap all three share:** They are centralized. They hold the data. They can sell it, subpoena it, or leak it. BlackRail is the first implementation of the payment session model that is private by cryptographic architecture, not by policy.

---

## Who BlackRail Is Built For

BlackRail was built with merchants as the primary user but the architecture serves anyone who receives payments and values financial privacy:

- **Merchants** accepting crypto who do not want competitors tracking their revenue
- **Freelancers and agencies** invoicing clients without exposing their full transaction history
- **DAOs and protocol treasuries** receiving contributions without revealing treasury inflows
- **Individuals** receiving peer payments without linking their identity to a permanent address
- **Any operator** in a jurisdiction where financial surveillance poses a legal or personal risk

The merchant portal is the first surface. The primitive is universal.

---

## What BlackRail Does

BlackRail is a private payment gateway. Every checkout session generates a **disposable, one-time facade address**. The buyer pays it on-chain like any normal SPL transfer. The real vault address never appears anywhere in the transaction trail.

The facade is swept to the private vault using **MagicBlock's Private Ephemeral Rollup infrastructure**, routing funds through MagicBlock's internal ER network rather than a direct on-chain transfer, breaking the public link between payer and recipient.

```
Buyer wallet  -->  Ephemeral facade  -->  [MagicBlock ER]  -->  Merchant vault
  (public)           (disposable)            (private)            (hidden)
```

After settlement, the facade address is destroyed. The on-chain record shows a payment to an address that no longer exists and cannot be traced back to the vault.

---

## Why This Is an Ephemeral Rollups Use Case

MagicBlock's Ephemeral Rollups are not just for games. They are **programmable private state transitions**, and payment settlement is exactly that: a state change (facade to vault) that should be private, atomic, and fast.

BlackRail uses the **MagicBlock Payments API (`/v1/spl/transfer` with `visibility: "private"`)** to route the sweep through MagicBlock's ER infrastructure. The on-chain settlement does not show a direct facade-to-vault SPL transfer. It routes through MagicBlock's internal ephemeral network (`EiV97...`), surfacing on-chain only at the vault receive, with no readable link to the source facade.

This is the core primitive that makes BlackRail possible. Without private ER routing, the sweep is visible on-chain and the privacy guarantee collapses.

---

## How It Works: Full Flow

```
1. MERCHANT creates a checkout session via API or dashboard
   POST /api/sessions --> { facadeAddress, sessionId, checkoutURL }

2. SERVER generates a fresh Solana keypair (the "facade")
   createFacade() --> ephemeral keypair stored server-side only

3. BUYER pays the facade address (standard SPL USDC transfer)
   Normal on-chain transaction. Facade address is publicly visible.

4. SERVER detects payment via balance polling
   GET /api/sessions/:id/balance --> checks facade ATA balance

5. SERVER triggers private settlement via MagicBlock
   POST https://payments.magicblock.app/v1/spl/transfer
   { from: facade, to: vaultATA, visibility: "private", gasless: true }

6. MAGICBLOCK returns a partially-signed VersionedTransaction
   Crank keypair (CrankS2f...) pre-signs. Server adds facade signature.
   vtx.addSignature(facadePubkey, nacl.sign.detached(msg, facadeSecretKey))
   Preserves crank signature. Avoids double-sign wipe.

7. SERVER submits the versioned transaction
   Funds route through MagicBlock's ER network --> vault receives net USDC
   No direct facade-to-vault link exists on-chain

8. SESSION marked settled. Facade keypair discarded.
```

---

## Technical Notes for Judges

**Fee handling:** MagicBlock charges approximately 0.2 USDC flat on top of the transfer amount in `gasless: true` mode. BlackRail uses a two-call approach: first call to get the fee, subtract from amount, second call with the adjusted amount so the facade balance covers both. Non-obvious integration detail that took iteration to solve.

**Signature preservation:** `VersionedTransaction.sign([facade])` wipes existing signatures, including MagicBlock's crank pre-signature. We use `vtx.addSignature()` directly with `nacl.sign.detached()` to inject the facade signature without disturbing the crank's. Critical for the transaction to be valid.

**Gasless minimum:** `gasless: true` requires a minimum of 0.5 USDC. Payments below this threshold fall back to standard SPL (not private). Surfaced in the UI.

**Atomic settlement guard:** Session status is updated with `WHERE status = 'active'` in the same SQL statement that triggers settlement, preventing duplicate settle attempts under concurrent poll hits.

**DB:** Neon Postgres via Drizzle ORM. Schema: `sessions` (facade keypair, status, amount, expiry) and `payments` (settled records).

---

## Stack

| Layer | Tech |
|---|---|
| Frontend | Static HTML/CSS/JS on Netlify |
| API | Express + TypeScript on Railway |
| Database | Neon Postgres (Drizzle ORM) |
| Auth | Privy (Google, X, email OTP) |
| Blockchain | Solana devnet, `@solana/web3.js` |
| Privacy layer | **MagicBlock Payments API: Private ER routing** |

---

## API Reference

```
POST   /api/sessions                  Create checkout session
GET    /api/sessions/:id              Get session state
GET    /api/sessions/:id/balance      Check facade on-chain balance
POST   /api/sessions/:id/settle       Trigger private MB settlement
GET    /api/payments                  Payment history
GET    /api/vault/balance             Vault USDC balance
POST   /api/vault/withdraw            Withdraw to any address
```

---

## Hackathon Track

**MagicBlock Blitz: Ephemeral Rollups / Private ERs**

BlackRail demonstrates a real-world payment primitive built entirely on MagicBlock's private ER infrastructure. The use case is immediately legible to non-crypto users, the integration is non-trivial (fee handling, signature preservation, atomic guards), and the product is fully live end-to-end on Solana devnet.

The market it targets already processes hundreds of billions of dollars annually through centralized processors. The privacy problem it solves is real, documented, and affects every merchant, freelancer, and individual who receives money. BlackRail is the first working implementation of that solution using Ephemeral Rollups.

---

## Vault

- Vault owner: `2QGJqSPWogpnrsrEagH4Mn28JjvuxMjrNMPbUst56j6Y`
- Vault USDC ATA: `B82AzAWZsvVUwW1iddK8H45E1rj6QKS36X9FPFtHmbjM`
- Network: Solana devnet

---

*Built at MagicBlock Blitz 2025.*
