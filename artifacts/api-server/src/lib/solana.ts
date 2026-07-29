import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  createAssociatedTokenAccountInstruction,
  createCloseAccountInstruction,
  createTransferInstruction,
  getAssociatedTokenAddressSync,
  getAccount,
} from "@solana/spl-token";
import bs58 from "bs58";

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

export function isWithdrawConfigured(): boolean {
  return !!(process.env.VAULT_KEYPAIR && isErConfigured());
}

function cfg() {
  return {
    usdcMint: new PublicKey(process.env.USDC_MINT!),
    merchantAta: new PublicKey(process.env.MERCHANT_USDC_ATA!),
    base: new Connection(
      process.env.SOLANA_RPC ?? "https://api.devnet.solana.com",
      "confirmed"
    ),
    server: Keypair.fromSecretKey(bs58.decode(process.env.SERVER_KEYPAIR!)),
  };
}

/** Live on-chain USDC balance of the merchant vault ATA. */
export async function getVaultBalance(): Promise<bigint> {
  const { merchantAta, base } = cfg();
  try {
    const acct = await getAccount(base, merchantAta);
    return acct.amount;
  } catch {
    return 0n;
  }
}

/**
 * Creates a one-time facade keypair and its USDC ATA on base layer.
 * Returns the facade's SOL public key (what buyer pastes into any wallet).
 */
export async function createFacade(): Promise<{
  facadeAddress: string;
  keypairB58: string;
}> {
  const { usdcMint, base, server } = cfg();
  const facade = Keypair.generate();
  const facadeAta = getAssociatedTokenAddressSync(usdcMint, facade.publicKey);

  const tx = new Transaction().add(
    createAssociatedTokenAccountInstruction(
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

/** USDC balance of facade's ATA on base layer. Returns 0n if not yet funded. */
export async function getFacadeBalance(facadeAddress: string): Promise<bigint> {
  const { usdcMint, base } = cfg();
  try {
    const facadeAta = getAssociatedTokenAddressSync(
      usdcMint,
      new PublicKey(facadeAddress)
    );
    const acct = await getAccount(base, facadeAta);
    return acct.amount;
  } catch {
    return 0n;
  }
}

/**
 * Sweeps facade ATA → merchant vault ATA via a direct SPL transfer,
 * then closes the facade ATA to recover rent back to the server.
 * The one-time facade address is the privacy layer — the merchant vault
 * address is never shown to the buyer at any point in the checkout flow.
 */
export async function settleFacade(
  keypairB58: string,
  facadeAddress: string
): Promise<string> {
  const { usdcMint, merchantAta, base, server } = cfg();
  const facade = Keypair.fromSecretKey(bs58.decode(keypairB58));
  const facadeAtaPk = getAssociatedTokenAddressSync(usdcMint, facade.publicKey);

  const acct = await getAccount(base, facadeAtaPk);
  const amount = acct.amount;
  if (amount === 0n) throw new Error("facade ATA has zero balance");

  const tx = new Transaction().add(
    // Transfer full balance facade → merchant vault
    createTransferInstruction(facadeAtaPk, merchantAta, facade.publicKey, amount),
    // Close facade ATA and return rent to server
    createCloseAccountInstruction(facadeAtaPk, server.publicKey, facade.publicKey)
  );

  const sig = await sendAndConfirmTransaction(base, tx, [server, facade]);
  return sig;
}

/**
 * Withdraws USDC from the merchant vault to a destination wallet.
 * `destination` can be either a wallet address (ATA is derived automatically)
 * or an existing USDC token account address.
 * Requires VAULT_KEYPAIR env var — the base58 private key of the wallet
 * that owns MERCHANT_USDC_ATA (i.e. the vault wallet's secret key).
 */
export async function withdrawFromVault(
  destination: string,
  amount: bigint
): Promise<string> {
  if (!process.env.VAULT_KEYPAIR) throw new Error("VAULT_KEYPAIR not configured");
  const { usdcMint, merchantAta, base, server } = cfg();
  const vault = Keypair.fromSecretKey(bs58.decode(process.env.VAULT_KEYPAIR));

  const acct = await getAccount(base, merchantAta);
  const available = acct.amount;
  if (available === 0n) throw new Error("vault is empty");
  const sendAmount = amount === 0n ? available : amount;
  if (sendAmount > available) throw new Error(`only ${Number(available) / 1e6} USDC available`);

  // Derive destination ATA from wallet address; if it's already an ATA that's fine too
  const destPk = new PublicKey(destination);
  const destAta = getAssociatedTokenAddressSync(usdcMint, destPk);

  const tx = new Transaction().add(
    createTransferInstruction(merchantAta, destAta, vault.publicKey, sendAmount)
  );
  const sig = await sendAndConfirmTransaction(base, tx, [server, vault]);
  return sig;
}
