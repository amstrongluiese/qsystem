import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, countersTable } from "@workspace/db";
import {
  CreateCounterBody,
  UpdateCounterBody,
  UpdateCounterParams,
  GetCounterParams,
  DeleteCounterParams,
  CounterLoginParams,
  CounterLoginBody,
} from "@workspace/api-zod";
import { emitQueueUpdate } from "../lib/socket.js";
import { autoAssignWaitingStudents } from "./queue.js";

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "admin123";

const router: IRouter = Router();

function canReceiveQueueAssignments(counter: typeof countersTable.$inferSelect) {
  return (
    counter.isActive &&
    (counter.type === "tagger" || counter.type === "evaluator" || counter.type === "hybrid") &&
    counter.status !== "break" &&
    counter.status !== "offline"
  );
}

async function markCounterOnline(counter: typeof countersTable.$inferSelect) {
  const nextStatus = counter.status === "offline" ? "available" : counter.status;
  await db
    .update(countersTable)
    .set({
      lastLoginAt: counter.lastLoginAt ?? new Date(),
      isOnline: true,
      status: nextStatus,
    })
    .where(eq(countersTable.id, counter.id));

  if (canReceiveQueueAssignments({ ...counter, isOnline: true, status: nextStatus })) {
    await autoAssignWaitingStudents(counter.id);
  }
  emitQueueUpdate();
}

// Staff login — unified endpoint for all roles
router.post("/staff/login", async (req, res): Promise<void> => {
  const { username, password } = req.body ?? {};
  if (!username || !password) {
    res.status(400).json({ error: "Username and password are required" });
    return;
  }

  // Admin shortcut
  if (String(username).toLowerCase() === "admin") {
    if (password !== ADMIN_PASSWORD) {
      res.status(401).json({ error: "Invalid credentials" });
      return;
    }
    res.json({
      token: Buffer.from(`admin:${Date.now()}`).toString("base64"),
      role: "admin",
      counterId: 0,
      counterName: "Admin",
    });
    return;
  }

  // Counter staff login
  const [counter] = await db
    .select()
    .from(countersTable)
    .where(eq(countersTable.username, String(username)));

  if (!counter) {
    res.status(401).json({ error: "Invalid credentials" });
    return;
  }

  if (counter.pin !== String(password)) {
    res.status(401).json({ error: "Invalid credentials" });
    return;
  }

  await markCounterOnline({ ...counter, lastLoginAt: new Date() });

  res.json({
    token: Buffer.from(`${counter.username}:${Date.now()}`).toString("base64"),
    role: counter.type,
    counterId: counter.id,
    counterName: counter.name,
  });
});

router.post("/staff/heartbeat", async (req, res): Promise<void> => {
  const counterId = Number(req.body?.counterId);
  if (!Number.isFinite(counterId) || counterId <= 0) {
    res.status(400).json({ error: "Valid counterId is required" });
    return;
  }

  const [counter] = await db.select().from(countersTable).where(eq(countersTable.id, counterId));
  if (!counter || !counter.isActive) {
    res.status(404).json({ error: "Counter not found or disabled" });
    return;
  }

  await markCounterOnline(counter);
  res.json({ success: true });
});

router.post("/staff/logout", async (req, res): Promise<void> => {
  const counterId = Number(req.body?.counterId);
  if (!Number.isFinite(counterId) || counterId <= 0) {
    res.status(400).json({ error: "Valid counterId is required" });
    return;
  }

  await db.update(countersTable).set({ isOnline: false }).where(eq(countersTable.id, counterId));
  emitQueueUpdate();
  res.json({ success: true });
});

router.get("/counters", async (_req, res): Promise<void> => {
  const counters = await db.select().from(countersTable).orderBy(countersTable.createdAt);
  const result = counters.map((c) => ({
    ...c,
    specialization: c.specialization ?? null,
    staffName: c.staffName ?? null,
    currentStudentId: c.currentStudentId ?? null,
    currentStudentName: c.currentStudentName ?? null,
  }));
  res.json(result);
});

router.post("/counters", async (req, res): Promise<void> => {
  const parsed = CreateCounterBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [counter] = await db.insert(countersTable).values(parsed.data).returning();
  res.status(201).json({
    ...counter,
    specialization: counter.specialization ?? null,
    staffName: counter.staffName ?? null,
    currentStudentId: counter.currentStudentId ?? null,
    currentStudentName: counter.currentStudentName ?? null,
  });
});

router.get("/counters/:id", async (req, res): Promise<void> => {
  const params = GetCounterParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [counter] = await db.select().from(countersTable).where(eq(countersTable.id, params.data.id));
  if (!counter) {
    res.status(404).json({ error: "Counter not found" });
    return;
  }
  emitQueueUpdate();
  res.json({
    ...counter,
    specialization: counter.specialization ?? null,
    staffName: counter.staffName ?? null,
    currentStudentId: counter.currentStudentId ?? null,
    currentStudentName: counter.currentStudentName ?? null,
  });
});

router.patch("/counters/:id", async (req, res): Promise<void> => {
  const params = UpdateCounterParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdateCounterBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [counter] = await db
    .update(countersTable)
    .set(parsed.data)
    .where(eq(countersTable.id, params.data.id))
    .returning();
  if (!counter) {
    res.status(404).json({ error: "Counter not found" });
    return;
  }
  res.json({
    ...counter,
    specialization: counter.specialization ?? null,
    staffName: counter.staffName ?? null,
    currentStudentId: counter.currentStudentId ?? null,
    currentStudentName: counter.currentStudentName ?? null,
  });
});

router.delete("/counters/:id", async (req, res): Promise<void> => {
  const params = DeleteCounterParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [counter] = await db.delete(countersTable).where(eq(countersTable.id, params.data.id)).returning();
  if (!counter) {
    res.status(404).json({ error: "Counter not found" });
    return;
  }
  res.sendStatus(204);
});

router.post("/counters/:id/login", async (req, res): Promise<void> => {
  const params = CounterLoginParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = CounterLoginBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [counter] = await db.select().from(countersTable).where(eq(countersTable.id, params.data.id));
  if (!counter) {
    res.status(404).json({ error: "Counter not found" });
    return;
  }
  if (counter.pin !== parsed.data.pin) {
    res.status(401).json({ error: "Invalid PIN" });
    return;
  }
  res.json({
    ...counter,
    specialization: counter.specialization ?? null,
    staffName: counter.staffName ?? null,
    currentStudentId: counter.currentStudentId ?? null,
    currentStudentName: counter.currentStudentName ?? null,
  });
});

export default router;
