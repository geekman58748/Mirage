import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  VersionedTransaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createCloseAccountInstruction,
  createTransferInstruction,
  getAssociatedTokenAddressSync,
  getAccount,
} from "@solana/spl-token";
import bs58 from "bs58";
import nacl from "tweetnacl";

export const PROGRAM_ID = new PublicKey(
  process.env.PROGRAM_ID ?? "D6au34Ft153B5ghrujVzTg4nGJFiitpePnoQ666JPzB7"
);

const MB_API = "https://payments.magicblock.app";
const CLUSTER = "devnet";

// ── Token cache keyed by pubkey ───────────────────────────────────────────────
const tokenCache = new Map<string, { token: string; expiresAt: number }>();

async function getMbToken(keypair: Keypair): Promise<string> {
  const pubkey = keypair.publicKey.toBase58();
  const cached = tokenCache.get(pubkey);
  if (cached && Date.now() < cached.expiresAt) return cached.token;

  // 1. Get challenge
  const challengeRes = await fetch(
    `${MB_API}/v1/spl/challenge?pubkey=${pubkey}&cluster=${CLUSTER}`
  );
  if (!challengeRes.ok) throw new Error(`MB challenge failed: ${challengeRes.status}`);
  const { challenge } = await challengeRes.json() as { challenge: string };

  // 2. Sign challenge with keypair
  const msgBytes = Buffer.from(challenge, "utf8");
  const sigBytes = nacl.sign.detached(msgBytes, keypair.secretKey);
  const signature = bs58.encode(sigBytes);

  // 3. Login → get token
  const loginRes = await fetch(`${MB_API}/v1/spl/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pubkey, challenge, signature, cluster: CLUSTER }),
  });
  if (!loginRes.ok) {
    const err = await loginRes.text();
    throw new Error(`MB login failed: ${loginRes.status} ${err}`);
  }
  const { token } = await loginRes.json() as { token: string };

  // Cache for 50 minutes (tokens typically last ~1h)
  tokenCache.set(pubkey, { token, expiresAt: Date.now() + 50 * 60 * 1000 });
  return token;
}

// ── Config ────────────────────────────────────────────────────────────────────
export function isErConfigured(): boolean {
  return !!(process.env.SERVER_KEYPAIR && process.env.USDC_MINT);
}

export function isWithdrawConfigured(): boolean {
  return isErConfigured();
}

function cfg() {
  const server = Keypair.fromSecretKey(bs58.decode(process.env.SERVER_KEYPAIR!));
  const usdcMint = new PublicKey(process.env.USDC_MINT!);
  const merchantAta = process.env.MERCHANT_USDC_ATA
    ? new PublicKey(process.env.MERCHANT_USDC_ATA)
    : getAssociatedTokenAddressSync(usdcMint, server.publicKey);
  return {
    usdcMint,
    merchantAta,
    base: new Connection(
      process.env.SOLANA_RPC ?? "https://api.devnet.solana.com",
      "confirmed"
    ),
    server,
  };
}

// ── Vault ─────────────────────────────────────────────────────────────────────
export async function getVaultBalance(): Promise<bigint> {
  const { merchantAta, base } = cfg();
  try {
    const acct = await getAccount(base, merchantAta);
    return acct.amount;
  } catch {
    return 0n;
  }
}

export function getVaultAddress(): { wallet: string; ata: string } {
  const { server, merchantAta } = cfg();
  return { wallet: server.publicKey.toBase58(), ata: merchantAta.toBase58() };
}

// ── Facade ────────────────────────────────────────────────────────────────────
export async function createFacade(): Promise<{
  facadeAddress: string;
  keypairB58: string;
}> {
  const { usdcMint, base, server } = cfg();
  const facade = Keypair.generate();
  const facadeAta = getAssociatedTokenAddressSync(usdcMint, facade.publicKey);

  const tx = new Transaction().add(
    createAssociatedTokenAccountIdempotentInstruction(
      server.publicKey,
      facadeAta,
      facade.publicKey,
      usdcMint
    )
  );
  await sendAndConfirmTransaction(base, tx, [server]);

  return {
    facadeAddress: facade.publicKey.toBase58(),
    keypairB58: bs58.encode(facade.secretKey),
  };
}

export async function getFacadeBalance(facadeAddress: string): Promise<bigint> {
  const { usdcMint, base } = cfg();
  try {
    const facadeAta = getAssociatedTokenAddressSync(usdcMint, new PublicKey(facadeAddress));
    const acct = await getAccount(base, facadeAta);
    return acct.amount;
  } catch {
    return 0n;
  }
}

/**
 * Settles facade → merchant vault privately via MagicBlock's Payments API.
 * Falls back to a plain on-chain SPL transfer if the MB API is unavailable.
 * Returns { sig, private: true/false } so callers know which path was used.
 */
export async function settleFacade(
  keypairB58: string,
  _facadeAddress: string
): Promise<{ sig: string; private: boolean }> {
  const { usdcMint, merchantAta, base, server } = cfg();
  const facade = Keypair.fromSecretKey(bs58.decode(keypairB58));
  const facadeAtaPk = getAssociatedTokenAddressSync(usdcMint, facade.publicKey);

  const acct = await getAccount(base, facadeAtaPk);
  const amount = acct.amount;
  if (amount === 0n) throw new Error("facade ATA has zero balance");

  // ── Try MagicBlock private settlement first (requires ≥ 0.5 USDC for gasless) ──
  const MB_MIN = 500_000n; // 0.5 USDC in lamports
  if (amount < MB_MIN) {
    console.log(`[settle] amount ${amount} < MB minimum, skipping MB → plain SPL`);
  }
  if (amount >= MB_MIN) try {
    const token = await getMbToken(facade);

    const payload = {
      from: facade.publicKey.toBase58(),
      to: server.publicKey.toBase58(),
      mint: usdcMint.toBase58(),
      amount: Number(amount),
      visibility: "private",
      fromBalance: "base",
      toBalance: "base",
      gasless: true,
      initAtasIfMissing: true,
      cluster: CLUSTER,
    };
    console.log("[settle] MB transfer payload:", JSON.stringify(payload));

    const res = await fetch(`${MB_API}/v1/spl/transfer`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    });

    const rawBody = await res.text();
    console.log("[settle] MB response status:", res.status, "body:", rawBody);

    if (res.ok) {
      let data: {
        signature?: string; sig?: string; txId?: string;
        transactionBase64?: string;
        requiredSigners?: string[];
        sendTo?: string;
      } = {};
      try { data = JSON.parse(rawBody); } catch {}

      // MB returns an unsigned tx — sign with facade keypair and submit
      if (data.transactionBase64) {
        const txBytes = Buffer.from(data.transactionBase64, "base64");
        let sig: string;
        try {
          const vtx = VersionedTransaction.deserialize(txBytes);
          vtx.sign([facade]);
          sig = await base.sendRawTransaction(vtx.serialize(), { skipPreflight: true });
          await base.confirmTransaction(sig, "confirmed");
        } catch (vtxErr) {
          console.warn("[settle] versioned tx failed, trying legacy:", vtxErr);
          const ltx = Transaction.from(txBytes);
          ltx.partialSign(facade);
          sig = await base.sendRawTransaction(ltx.serialize(), { skipPreflight: true });
          await base.confirmTransaction(sig, "confirmed");
        }
        console.log("[settle] MB private tx signed + confirmed:", sig);
        return { sig, private: true };
      }

      const sig = data.signature ?? data.sig ?? data.txId ?? "mb-private";
      console.log("[settle] MagicBlock private transfer sig:", sig);
      return { sig, private: true };
    }

    console.warn("[settle] MB API failed, falling back:", res.status, rawBody);
  } catch (mbErr) {
    console.warn("[settle] MB API error, falling back:", mbErr);
  }

  // ── Fallback: plain on-chain SPL transfer ──
  const tx = new Transaction().add(
    createAssociatedTokenAccountIdempotentInstruction(
      server.publicKey, merchantAta, server.publicKey, usdcMint
    ),
    createTransferInstruction(facadeAtaPk, merchantAta, facade.publicKey, amount),
    createCloseAccountInstruction(facadeAtaPk, server.publicKey, facade.publicKey)
  );
  const sig = await sendAndConfirmTransaction(base, tx, [server, facade]);
  console.log("[settle] fallback plain SPL transfer:", sig);
  return { sig, private: false };
}

// ── Withdraw ──────────────────────────────────────────────────────────────────
export async function withdrawFromVault(
  destination: string,
  amount: bigint
): Promise<string> {
  const { usdcMint, merchantAta, base, server } = cfg();

  const acct = await getAccount(base, merchantAta);
  const available = acct.amount;
  if (available === 0n) throw new Error("vault is empty");
  const sendAmount = amount === 0n ? available : amount;
  if (sendAmount > available) throw new Error(`only ${Number(available) / 1e6} USDC available`);

  const destPk = new PublicKey(destination);
  const destAta = getAssociatedTokenAddressSync(usdcMint, destPk);

  const tx = new Transaction().add(
    createAssociatedTokenAccountIdempotentInstruction(server.publicKey, destAta, destPk, usdcMint),
    createTransferInstruction(merchantAta, destAta, server.publicKey, sendAmount)
  );
  const sig = await sendAndConfirmTransaction(base, tx, [server]);
  return sig;
}
