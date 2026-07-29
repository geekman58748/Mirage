import { Router } from "express";
import { desc, eq, sum } from "drizzle-orm";
import { db, paymentsTable } from "@workspace/db";
import { LogPaymentBody } from "@workspace/api-zod";

const router = Router();

router.get("/payments/stats", async (req, res): Promise<void> => {
  const merchantId = req.query.merchantId as string | undefined;

  const query = db.select().from(paymentsTable).orderBy(desc(paymentsTable.createdAt));
  const all = merchantId
    ? await query.where(eq(paymentsTable.merchantId, merchantId))
    : await query;

  const totalUSDC = all.reduce((acc, p) => acc + parseFloat(p.amount), 0);
  const recent = all.slice(0, 10).map(serialize);

  res.json({ totalUSDC, totalPayments: all.length, recent });
});

router.get("/payments", async (req, res): Promise<void> => {
  const merchantId = req.query.merchantId as string | undefined;
  const query = db.select().from(paymentsTable).orderBy(desc(paymentsTable.createdAt));
  const rows = merchantId
    ? await query.where(eq(paymentsTable.merchantId, merchantId))
    : await query;
  res.json(rows.map(serialize));
});

router.post("/payments", async (req, res): Promise<void> => {
  const parsed = LogPaymentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { amount, currency, facadeAddress, sessionId, txHash, merchantId } = parsed.data;
  const [row] = await db
    .insert(paymentsTable)
    .values({
      amount: String(amount),
      currency: currency ?? "USDC",
      facadeAddress,
      sessionId: sessionId ?? null,
      txHash: txHash ?? null,
      merchantId: merchantId ?? null,
    })
    .returning();
  res.status(201).json(serialize(row));
});

function serialize(p: typeof paymentsTable.$inferSelect) {
  return {
    id: p.id,
    amount: parseFloat(p.amount),
    currency: p.currency,
    facadeAddress: p.facadeAddress,
    sessionId: p.sessionId,
    txHash: p.txHash,
    merchantId: p.merchantId,
    createdAt: p.createdAt.toISOString(),
  };
}

export default router;
