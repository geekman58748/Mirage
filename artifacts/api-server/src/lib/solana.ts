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

/**
 * Creates a one-time facade keypair and its USDC ATA on base layer.
 * Returns the facade's SOL public key (shown to buyer in checkout) and the
 * secret keypair for later settlement.
 */
export async function createFacade(): Promise<{
  facadeAddress: string;   // facade SOL public key – paste into any wallet
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
 * Returns the USDC balance of the facade's ATA on base layer (lamports = USDC micro-units).
 * Returns 0n if the ATA doesn't exist or has no balance yet.
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
 * Sweeps facade ATA → merchant ATA and closes the facade ATA to recover rent.
 * Signs with both server (fee payer) and facade keypair (token authority).
 */
export async function settleFacade(
  keypairB58: string,
  facadeAddress: string
): Promise<string> {
  const { usdcMint, merchantAta, base, server } = cfg();
  const facade = Keypair.fromSecretKey(bs58.decode(keypairB58));
  const facadeAtaPk = getAssociatedTokenAddressSync(usdcMint, new PublicKey(facadeAddress));

  const acct = await getAccount(base, facadeAtaPk);
  const amount = acct.amount;
  if (amount === 0n) throw new Error("facade ATA has zero balance");

  const transferIx = createTransferInstruction(
    facadeAtaPk,
    merchantAta,
    facade.publicKey,
    amount
  );
  const closeIx = createCloseAccountInstruction(
    facadeAtaPk,
    server.publicKey,   // rent refund goes to server
    facade.publicKey    // authority
  );

  const tx = new Transaction().add(transferIx, closeIx);
  const sig = await sendAndConfirmTransaction(base, tx, [server, facade]);
  return sig;
}
