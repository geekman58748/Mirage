import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  createAssociatedTokenAccountInstruction,
  getAssociatedTokenAddressSync,
  getAccount,
} from "@solana/spl-token";
import {
  transferSpl,
} from "@magicblock-labs/ephemeral-rollups-sdk";
import bs58 from "bs58";

/**
 * Returns the live on-chain USDC balance of the merchant vault ATA (base layer).
 */
export async function getVaultBalance(): Promise<bigint> {
  const { merchantAta, base } = cfg();
  try {
    const acct = await getAccount(base, merchantAta);
    return acct.amount;
  } catch {
    return 0n;
  }
}

export const PROGRAM_ID = new PublicKey(
  process.env.PROGRAM_ID ?? "D6au34Ft153B5ghrujVzTg4nGJFiitpePnoQ666JPzB7"
);

export function isErConfigured(): boolean {
  return !!(
    process.env.SERVER_KEYPAIR &&
    process.env.MERCHANT_USDC_ATA &&
    process.env.USDC_MINT
  );
}

function cfg() {
  return {
    usdcMint: new PublicKey(process.env.USDC_MINT!),
    merchantAta: new PublicKey(process.env.MERCHANT_USDC_ATA!),
    validator: new PublicKey(
      process.env.ER_VALIDATOR ?? "mAGicPQYBMvcYveUZA5F5UNNwyHvfYh5xkLS2Fr1mev"
    ),
    base: new Connection(
      process.env.SOLANA_RPC ?? "https://api.devnet.solana.com",
      "confirmed"
    ),
    server: Keypair.fromSecretKey(bs58.decode(process.env.SERVER_KEYPAIR!)),
  };
}

/**
 * Creates a one-time facade keypair and its USDC ATA on base layer.
 * Returns the facade's SOL public key (what buyer pastes into any wallet)
 * and the secret keypair for later settlement.
 */
export async function createFacade(): Promise<{
  facadeAddress: string;  // facade SOL public key – paste into any wallet
  keypairB58: string;
}> {
  const { usdcMint, base, server } = cfg();
  const facade = Keypair.generate();
  const facadeAta = getAssociatedTokenAddressSync(usdcMint, facade.publicKey);

  const createAtaIx = createAssociatedTokenAccountInstruction(
    server.publicKey,   // server pays rent
    facadeAta,
    facade.publicKey,
    usdcMint
  );

  const tx = new Transaction().add(createAtaIx);
  await sendAndConfirmTransaction(base, tx, [server]);

  return {
    facadeAddress: facade.publicKey.toBase58(),
    keypairB58: bs58.encode(facade.secretKey),
  };
}

/**
 * Returns the USDC balance of the facade's ATA on base layer.
 * Returns 0n if the ATA has no balance yet.
 */
export async function getFacadeBalance(facadeAddress: string): Promise<bigint> {
  const { usdcMint, base } = cfg();
  try {
    const facadePk = new PublicKey(facadeAddress);
    const facadeAta = getAssociatedTokenAddressSync(usdcMint, facadePk);
    const acct = await getAccount(base, facadeAta);
    return acct.amount;
  } catch {
    return 0n;
  }
}

/**
 * Privately sweeps facade ATA → merchant vault using the Ephemeral SPL Token
 * Program's shuttle mechanism.
 *
 * Privacy guarantee: the merchant's address is encrypted with the validator's
 * Ed25519 public key and stored as 80 bytes of ciphertext in the instruction
 * data — it is never a readable account key in any base-layer transaction.
 * A blockchain explorer sees the facade ATA and a set of PDAs, but has no
 * direct on-chain link to the merchant's wallet address.
 */
export async function settleFacade(
  keypairB58: string,
  facadeAddress: string
): Promise<string> {
  const { usdcMint, merchantAta, validator, base, server } = cfg();
  const facade = Keypair.fromSecretKey(bs58.decode(keypairB58));
  const facadeAtaPk = getAssociatedTokenAddressSync(
    usdcMint,
    facade.publicKey
  );

  // Confirm balance on base layer before settling
  const acct = await getAccount(base, facadeAtaPk);
  const amount = acct.amount;
  if (amount === 0n) throw new Error("facade ATA has zero balance");

  // Derive merchant wallet from their ATA (needed as `to` for transferSpl)
  const merchantAtaAcct = await getAccount(base, merchantAta);
  const merchantWallet = merchantAtaAcct.owner;

  // Private transfer via Ephemeral SPL Token Program.
  // `initVaultIfMissing: true` is idempotent — safe to include every call
  // and ensures the vault + transfer queue exist on first use.
  const ixs = await transferSpl(
    facade.publicKey,    // from: facade wallet (owns the funded ATA)
    merchantWallet,      // to: merchant wallet (ENCRYPTED in instruction data)
    usdcMint,
    amount,
    {
      payer: server.publicKey,
      validator,
      visibility: "private",
      fromBalance: "base",
      toBalance: "base",
      initVaultIfMissing: true,
      shuttleId: Math.floor(Math.random() * 1_000_000),
      privateTransfer: {
        minDelayMs: 0n,
        maxDelayMs: 5_000n,
        split: 1,
      },
    }
  );

  const tx = new Transaction().add(...ixs);
  const sig = await sendAndConfirmTransaction(base, tx, [server, facade]);
  return sig;
}
