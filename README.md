# Mirage — Private Crypto Merchant Gateway

Zero-trace Solana payments via ephemeral rollups (MagicBlock). Merchants receive funds privately through facade addresses — no on-chain link between payer and merchant vault.

## Pages

| File | Purpose |
|------|---------|
| `index.html` | Landing page |
| `onboarding.html` | Merchant signup + wallet setup (Privy) |
| `dashboard.html` | Merchant command center — generate payment links, view vault, manage API keys |
| `checkout.html` | Buyer-facing ephemeral checkout |

## Architecture

- **MerchantVault** — on-chain account storing merchant's facade address and settlement config
- **PaymentSession** — ephemeral rollup account (MagicBlock ER) created per transaction
- **Privacy model** — buyer pays facade address (ATA PDA owner), funds settle to vault off-chain, zero mainnet trace

## Stack

- Frontend: Pure HTML/CSS/JS (Privy for social login + embedded wallets)
- Program: Anchor (Solana) — `MerchantVault`, `PaymentSession` accounts
- Ephemeral layer: MagicBlock SDK

## Deploy

Connected to Netlify — pushes to `main` deploy automatically.
