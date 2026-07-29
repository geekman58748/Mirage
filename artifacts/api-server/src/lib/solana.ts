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
import {
  delegateSpl,
  withdrawSpl,
} from "@magicblock-labs/ephemeral-rollups-sdk";
import bs58 from "bs58";

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
    er: new Connection(
      process.env.ER_RPC ?? "https://devnet.magicblock.app",
      { commitment: "confirmed", wsEndpoint: process.env.ER_WS ?? "wss://devnet.magicblock.app" }
    ),
    server: Keypair.fromSecretKey(bs58.decode(process.env.SERVER_KEYPAIR!)),
  };
}

export async function createAndDelegateFacade(): Promise<{
  facadeAddress: string;
  keypairB58: string;
}> {
  const { usdcMint, validator, base, server } = cfg();
  const facade = Keypair.generate();
  const facadeAta = getAssociatedTokenAddressSync(usdcMint, facade.publicKey);

  const createAtaIx = createAssociatedTokenAccountInstruction(
    server.publicKey,
    facadeAta,
    facade.publicKey,
    usdcMint
  );

  const delegateIxs = await delegateSpl(facade.publicKey, usdcMint, 0n, {
    validator,
    payer: server.publicKey,
    idempotent: true,
  });

  const tx = new Transaction().add(createAtaIx, ...delegateIxs);
  await sendAndConfirmTransaction(base, tx, [server, facade]);

  return {
    facadeAddress: facadeAta.toBase58(),
    keypairB58: bs58.encode(facade.secretKey),
  };
}

export async function getFacadeBalance(facadeAddress: string): Promise<bigint> {
  const { er } = cfg();
  try {
    const acct = await getAccount(er, new PublicKey(facadeAddress));
    return acct.amount;
  } catch {
    return 0n;
  }
}

export async function settleFacade(
  keypairB58: string,
  facadeAddress: string
): Promise<string> {
  const { usdcMint, merchantAta, validator, base, server } = cfg();
  const facade = Keypair.fromSecretKey(bs58.decode(keypairB58));
  const facadeAtaPk = new PublicKey(facadeAddress);

  // Get current balance on base layer (post-undelegate)
  const acct = await getAccount(base, facadeAtaPk);
  const amount = acct.amount;
  if (amount === 0n) throw new Error("facade ATA has zero balance");

  // Withdraw from ER → base layer facade ATA
  const withdrawIxs = await withdrawSpl(facade.publicKey, usdcMint, amount, {
    validator,
    payer: server.publicKey,
    idempotent: false,
  });
  const withdrawTx = new Transaction().add(...withdrawIxs);
  await sendAndConfirmTransaction(base, withdrawTx, [server, facade]);

  // Transfer facade ATA → merchant ATA + close facade ATA (recover rent)
  const transferIx = createTransferInstruction(
    facadeAtaPk,
    merchantAta,
    facade.publicKey,
    amount
  );
  const closeIx = createCloseAccountInstruction(
    facadeAtaPk,
    server.publicKey,
    facade.publicKey
  );
  const settleTx = new Transaction().add(transferIx, closeIx);
  const sig = await sendAndConfirmTransaction(base, settleTx, [server, facade]);
  return sig;
}
