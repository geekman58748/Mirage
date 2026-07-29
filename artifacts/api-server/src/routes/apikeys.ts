import { Router } from "express";
import { createHash, randomBytes } from "crypto";
import { eq } from "drizzle-orm";
import { db, apiKeysTable } from "@workspace/db";
import { CreateApiKeyBody } from "@workspace/api-zod";

const router = Router();

router.get("/api-keys", async (req, res): Promise<void> => {
  const merchantId = req.query.merchantId as string | undefined;
  if (!merchantId) {
    res.status(400).json({ error: "merchantId required" });
    return;
  }
  const rows = await db
    .select()
    .from(apiKeysTable)
    .where(eq(apiKeysTable.merchantId, merchantId));
  res.json(rows.map(serialize));
});

router.post("/api-keys", async (req, res): Promise<void> => {
  const parsed = CreateApiKeyBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { merchantId, label } = parsed.data;

  const raw = "mrg_live_" + randomBytes(12).toString("hex");
  const prefix = raw.slice(0, 20);
  const hash = createHash("sha256").update(raw).digest("hex");

  const [row] = await db
    .insert(apiKeysTable)
    .values({ merchantId, keyHash: hash, keyPrefix: prefix, label: label ?? "Default" })
    .returning();

  res.status(201).json({ ...serialize(row), rawKey: raw });
});

router.delete("/api-keys/:id", async (req, res): Promise<void> => {
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(rawId, 10);
  const [row] = await db
    .delete(apiKeysTable)
    .where(eq(apiKeysTable.id, id))
    .returning();
  if (!row) {
    res.status(404).json({ error: "Key not found" });
    return;
  }
  res.json(serialize(row));
});

function serialize(k: typeof apiKeysTable.$inferSelect) {
  return {
    id: k.id,
    merchantId: k.merchantId,
    keyPrefix: k.keyPrefix,
    label: k.label,
    createdAt: k.createdAt.toISOString(),
    lastUsedAt: k.lastUsedAt ? k.lastUsedAt.toISOString() : null,
  };
}

export default router;
