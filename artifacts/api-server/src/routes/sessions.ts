import { Router } from "express";
import { eq } from "drizzle-orm";
import { randomBytes } from "crypto";
import { db, sessionsTable } from "@workspace/db";
import { CreateSessionBody } from "@workspace/api-zod";

const router = Router();

// Stub facade address generator — replace with MagicBlock SDK in Task 1
function generateFacadeAddress(): string {
  return randomBytes(32).toString("hex").slice(0, 44);
}

router.get("/sessions", async (req, res): Promise<void> => {
  const merchantId = req.query.merchantId as string | undefined;
  if (!merchantId) {
    const rows = await db.select().from(sessionsTable);
    res.json(rows.map(serialize));
    return;
  }
  const rows = await db
    .select()
    .from(sessionsTable)
    .where(eq(sessionsTable.merchantId, merchantId));
  res.json(rows.map(serialize));
});

router.post("/sessions", async (req, res): Promise<void> => {
  const parsed = CreateSessionBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { label, expiryMinutes, amount, currency, merchantId } = parsed.data;
  const mins = expiryMinutes ?? 15;
  const expiresAt = new Date(Date.now() + mins * 60 * 1000);
  const id = randomBytes(16).toString("hex");
  const facadeAddress = generateFacadeAddress();

  const [row] = await db
    .insert(sessionsTable)
    .values({
      id,
      facadeAddress,
      label,
      expiryMinutes: mins,
      amount: amount != null ? String(amount) : null,
      currency: currency ?? "USDC",
      merchantId: merchantId ?? null,
      status: "active",
      expiresAt,
    })
    .returning();

  const origin = req.headers.origin ?? `${req.protocol}://${req.get("host")}`;
  res.status(201).json(serializeWithUrl(row, origin));
});

router.get("/sessions/:id", async (req, res): Promise<void> => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const [row] = await db
    .select()
    .from(sessionsTable)
    .where(eq(sessionsTable.id, id));
  if (!row) {
    res.status(404).json({ error: "Session not found" });
    return;
  }
  // Auto-expire stale sessions
  if (row.status === "active" && row.expiresAt < new Date()) {
    await db
      .update(sessionsTable)
      .set({ status: "expired" })
      .where(eq(sessionsTable.id, id));
    row.status = "expired";
  }
  const origin = req.headers.origin ?? `${req.protocol}://${req.get("host")}`;
  res.json(serializeWithUrl(row, origin));
});

router.delete("/sessions/:id", async (req, res): Promise<void> => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const [row] = await db
    .update(sessionsTable)
    .set({ status: "expired" })
    .where(eq(sessionsTable.id, id))
    .returning();
  if (!row) {
    res.status(404).json({ error: "Session not found" });
    return;
  }
  const origin = req.headers.origin ?? `${req.protocol}://${req.get("host")}`;
  res.json(serializeWithUrl(row, origin));
});

function serialize(s: typeof sessionsTable.$inferSelect) {
  return {
    id: s.id,
    facadeAddress: s.facadeAddress,
    label: s.label,
    expiryMinutes: s.expiryMinutes,
    amount: s.amount != null ? parseFloat(s.amount) : null,
    currency: s.currency,
    merchantId: s.merchantId,
    status: s.status,
    createdAt: s.createdAt.toISOString(),
    expiresAt: s.expiresAt.toISOString(),
  };
}

function serializeWithUrl(s: typeof sessionsTable.$inferSelect, origin: string) {
  return {
    ...serialize(s),
    checkoutUrl: `${origin}/pages/checkout.html?session=${s.id}`,
  };
}

export default router;
