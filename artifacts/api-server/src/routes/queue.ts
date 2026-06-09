import { Router, type IRouter } from "express";
import { eq, and, sql, notInArray } from "drizzle-orm";
import { db, queueTable, countersTable } from "@workspace/db";
import {
  RegisterStudentBody,
  GetStudentQueueStatusParams,
  ListQueueQueryParams,
  CallStudentParams,
  StartProcessingParams,
  CompleteProcessingParams,
  TransferToTaggerParams,
  TransferToTaggerBody,
  CancelQueueEntryParams,
  ReassignQueueParams,
  ReassignQueueBody,
  GetStudentQueueByNumberParams,
} from "@workspace/api-zod";
import { emitQueueUpdate } from "../lib/socket.js";
import { appendTvManualVoiceCommand } from "../lib/tv-voice-events.js";
import { isNull } from "drizzle-orm";

const router: IRouter = Router();

// Routing logic: determine workflow based on category/year/regularity
function determineWorkflow(
  category: string,
  yearLevel?: string | null,
  regularity?: string | null,
): "evaluation" | "direct_tagging" {
  if (category === "regular") return "direct_tagging";
  return "evaluation";
}

// Generate queue number
async function generateQueueNumber(workflow: "evaluation" | "direct_tagging"): Promise<string> {
  const prefix = workflow === "evaluation" ? "E" : "DT";
  const count = await db
    .select({ count: sql<number>`count(*)` })
    .from(queueTable)
    .where(eq(queueTable.workflow, workflow));
  const num = (Number(count[0]?.count ?? 0) + 1).toString().padStart(3, "0");
  return `${prefix}-${num}`;
}

// Find best available counter by type
async function findAvailableCounter(type: string, category?: string): Promise<number | null> {
  const eligibleTypeSql =
    type === "evaluator"
      ? sql`${countersTable.type} IN ('evaluator', 'hybrid')`
      : type === "tagger"
        ? sql`${countersTable.type} IN ('tagger', 'hybrid')`
        : eq(countersTable.type, type);

  const counters = await db
    .select()
    .from(countersTable)
    .where(
      and(
        eligibleTypeSql,
        eq(countersTable.isActive, true),
        eq(countersTable.isOnline, true),
        eq(countersTable.status, "available")
      )
    );
    
  if (counters.length === 0) return null;

  // Check specialization match if category provided
  if (category) {
    const specialized = counters.filter(c => c.specialization === category);
    if (specialized.length > 0) {
      specialized.sort((a, b) => a.currentQueueCount - b.currentQueueCount);
      return specialized[0].id;
    }
  }

  counters.sort((a, b) => a.currentQueueCount - b.currentQueueCount);
  return counters[0].id;
}

export async function autoAssignWaitingStudents(counterId: number) {
  const [counter] = await db
    .select()
    .from(countersTable)
    .where(
      and(
        eq(countersTable.id, counterId),
        eq(countersTable.isActive, true),
        eq(countersTable.isOnline, true),
        eq(countersTable.status, "available"),
      ),
    );
  if (!counter) return;

  const availableCounters = await db
    .select()
    .from(countersTable)
    .where(
      and(
        eq(countersTable.isActive, true),
        eq(countersTable.isOnline, true),
        eq(countersTable.status, "available"),
      ),
    );

  if (availableCounters.length === 0) return;

  const allWaiting = await db
    .select()
    .from(queueTable)
    .where(and(isNull(queueTable.assignedCounterId), eq(queueTable.status, "waiting")))
    .orderBy(queueTable.createdAt);

  if (allWaiting.length === 0) return;

  for (const student of allWaiting) {
    const eligibleCounters = availableCounters.filter((available) => {
      if (student.workflow === "evaluation") {
        return available.isActive && (available.type === "evaluator" || available.type === "hybrid");
      }
      return available.isActive && (available.type === "tagger" || available.type === "hybrid");
    });

    if (eligibleCounters.length === 0) continue;

    const specializedCounters = student.category
      ? eligibleCounters.filter((available) => available.specialization === student.category)
      : [];
    const assignPool = specializedCounters.length > 0 ? specializedCounters : eligibleCounters;

    assignPool.sort((a, b) => {
      if (a.currentQueueCount === b.currentQueueCount) return a.id - b.id;
      return a.currentQueueCount - b.currentQueueCount;
    });

    const selected = assignPool[0];
    if (!selected) continue;

    await db
      .update(queueTable)
      .set({ assignedCounterId: selected.id })
      .where(eq(queueTable.id, student.id));

    await db
      .update(countersTable)
      .set({ currentQueueCount: sql`${countersTable.currentQueueCount} + 1` })
      .where(eq(countersTable.id, selected.id));

    selected.currentQueueCount += 1;
  }
}


function serializeEntry(entry: typeof queueTable.$inferSelect, counterName?: string | null, taggerName?: string | null) {
  return {
    ...entry,
    studentNumber: entry.studentNumber ?? null,
    yearLevel: entry.yearLevel ?? null,
    regularity: entry.regularity ?? null,
    isWep: entry.isWep ?? false,
    isReturnee: entry.isReturnee ?? false,
    assignedCounterId: entry.assignedCounterId ?? null,
    assignedCounterName: counterName ?? null,
    evaluatedBy: entry.evaluatedBy ?? null,
    evaluatedAt: entry.evaluatedAt?.toISOString() ?? null,
    taggedBy: entry.taggedBy ?? null,
    taggedAt: entry.taggedAt?.toISOString() ?? null,
    taggerCounterId: entry.taggerCounterId ?? null,
    taggerCounterName: taggerName ?? null,
    calledAt: entry.calledAt?.toISOString() ?? null,
    startedAt: entry.startedAt?.toISOString() ?? null,
    completedAt: entry.completedAt?.toISOString() ?? null,
    createdByAssistantId: entry.createdByAssistantId ?? null,
    createdByAssistantAt: entry.createdByAssistantAt?.toISOString() ?? null,
    waitingPosition: null as number | null,
    estimatedWaitMinutes: null as number | null,
  };
}

// Student registration
router.post("/students/register", async (req, res): Promise<void> => {
  const parsed = RegisterStudentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { fullName, studentNumber, category, yearLevel, regularity, isWep, isReturnee } = parsed.data;
  const workflow = determineWorkflow(category, yearLevel, regularity);
  const counterType = workflow === "evaluation" ? "evaluator" : "tagger";
  const queueNumber = await generateQueueNumber(workflow);
  const assignedCounterId = await findAvailableCounter(counterType, category);

  const [entry] = await db
    .insert(queueTable)
    .values({
      queueNumber,
      fullName,
      studentNumber: studentNumber ?? null,
      category,
      yearLevel: yearLevel ?? null,
      regularity: regularity ?? null,
      isWep: isWep ?? false,
      isReturnee: isReturnee ?? false,
      workflow,
      assignedCounterId,
      status: "waiting",
    })
    .returning();

  // Increment counter queue count
  if (assignedCounterId) {
    await db
      .update(countersTable)
      .set({ currentQueueCount: sql`${countersTable.currentQueueCount} + 1` })
      .where(eq(countersTable.id, assignedCounterId));
  }

  // Get counter name for response
  let counterName: string | null = null;
  if (assignedCounterId) {
    const [c] = await db.select().from(countersTable).where(eq(countersTable.id, assignedCounterId));
    counterName = c?.name ?? null;
  }

  emitQueueUpdate();
  res.status(201).json(serializeEntry(entry, counterName));
});

router.post("/queue-assistant/walk-ins", async (req, res): Promise<void> => {
  const { fullName, studentType, queueType, assistantId } = req.body ?? {};
  const assistantNumericId = Number(assistantId);
  if (!fullName || !studentType || !queueType || !Number.isFinite(assistantNumericId)) {
    res.status(400).json({ error: "Student name, student type, queue type, and assistant id are required" });
    return;
  }

  const [assistant] = await db.select().from(countersTable).where(eq(countersTable.id, assistantNumericId));
  if (!assistant || assistant.type !== "queue_assistant" || !assistant.isActive) {
    res.status(403).json({ error: "Queue Assistant access required" });
    return;
  }

  const categoryMap: Record<string, string> = {
    regular_new: "regular",
    transferee: "transferee",
    old: "old",
    wep: "wep",
  };
  const workflow: "evaluation" | "direct_tagging" = queueType === "direct_tagging" ? "direct_tagging" : "evaluation";
  const category = categoryMap[String(studentType)] ?? "regular";
  const counterType = workflow === "evaluation" ? "evaluator" : "tagger";
  const queueNumber = await generateQueueNumber(workflow);
  const assignedCounterId = await findAvailableCounter(counterType, category);
  const createdAt = new Date();

  const [entry] = await db
    .insert(queueTable)
    .values({
      queueNumber,
      fullName: String(fullName).trim(),
      studentNumber: null,
      category,
      yearLevel: null,
      regularity: null,
      isWep: category === "wep",
      isReturnee: category === "old",
      workflow,
      assignedCounterId,
      status: "waiting",
      createdByAssistantId: assistant.id,
      createdByAssistantAt: createdAt,
    })
    .returning();

  if (assignedCounterId) {
    await db
      .update(countersTable)
      .set({ currentQueueCount: sql`${countersTable.currentQueueCount} + 1` })
      .where(eq(countersTable.id, assignedCounterId));
  }

  let counterName: string | null = null;
  if (assignedCounterId) {
    const [c] = await db.select().from(countersTable).where(eq(countersTable.id, assignedCounterId));
    counterName = c?.name ?? null;
  }

  emitQueueUpdate();
  res.status(201).json(serializeEntry(entry, counterName));
});

router.get("/queue-assistant/queues", async (req, res): Promise<void> => {
  const assistantId = Number(req.query.assistantId);
  const search = String(req.query.search ?? "").trim().toLowerCase();
  if (!Number.isFinite(assistantId)) {
    res.status(400).json({ error: "assistantId is required" });
    return;
  }

  const entries = await db
    .select()
    .from(queueTable)
    .where(
      and(
        eq(queueTable.createdByAssistantId, assistantId),
        sql`${queueTable.createdAt} >= CURRENT_DATE`,
      ),
    )
    .orderBy(queueTable.createdAt);

  const counters = await db.select().from(countersTable);
  const counterMap = new Map(counters.map((counter) => [counter.id, counter.name]));
  const filtered = search
    ? entries.filter((entry) => entry.queueNumber.toLowerCase().includes(search) || entry.fullName.toLowerCase().includes(search))
    : entries;

  res.json(
    filtered.map((entry) =>
      serializeEntry(entry, entry.assignedCounterId ? counterMap.get(entry.assignedCounterId) ?? null : null),
    ),
  );
});

// Get student queue status
router.get("/students/:queueId/status", async (req, res): Promise<void> => {
  const params = GetStudentQueueStatusParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [entry] = await db.select().from(queueTable).where(eq(queueTable.id, params.data.queueId));
  if (!entry) {
    res.status(404).json({ error: "Queue entry not found" });
    return;
  }

  let counterName: string | null = null;
  let taggerName: string | null = null;
  if (entry.assignedCounterId) {
    const [c] = await db.select().from(countersTable).where(eq(countersTable.id, entry.assignedCounterId));
    counterName = c?.name ?? null;
  }
  if (entry.taggerCounterId) {
    const [t] = await db.select().from(countersTable).where(eq(countersTable.id, entry.taggerCounterId));
    taggerName = t?.name ?? null;
  }

  // Calculate waiting position
  const waiting = await db
    .select()
    .from(queueTable)
    .where(
      and(
        eq(queueTable.assignedCounterId, entry.assignedCounterId!),
        eq(queueTable.status, "waiting"),
      ),
    );
  const position = waiting.findIndex((q) => q.id === entry.id) + 1;

  const result = serializeEntry(entry, counterName, taggerName);
  result.waitingPosition = position > 0 ? position : null;
  result.estimatedWaitMinutes = position > 0 ? position * 8 : null;

  res.json(result);
});

// Get student queue by number string
router.get("/students/track/:queueNumber", async (req, res): Promise<void> => {
  const params = GetStudentQueueByNumberParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [entry] = await db
    .select()
    .from(queueTable)
    .where(eq(queueTable.queueNumber, params.data.queueNumber.toUpperCase()));
    
  if (!entry) {
    res.status(404).json({ error: "Queue entry not found" });
    return;
  }

  let counterName: string | null = null;
  let taggerName: string | null = null;
  if (entry.assignedCounterId) {
    const [c] = await db.select().from(countersTable).where(eq(countersTable.id, entry.assignedCounterId));
    counterName = c?.name ?? null;
  }
  if (entry.taggerCounterId) {
    const [t] = await db.select().from(countersTable).where(eq(countersTable.id, entry.taggerCounterId));
    taggerName = t?.name ?? null;
  }

  const result = serializeEntry(entry, counterName, taggerName);
  res.json(result);
});

// List queue
router.get("/queue", async (req, res): Promise<void> => {
  const params = ListQueueQueryParams.safeParse(req.query);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const conditions = [];
  if (params.data.counterId) {
    conditions.push(eq(queueTable.assignedCounterId, params.data.counterId));
  }
  if (params.data.status) {
    conditions.push(eq(queueTable.status, params.data.status));
  }

  const entries =
    conditions.length > 0
      ? await db
          .select()
          .from(queueTable)
          .where(conditions.length === 1 ? conditions[0] : and(...conditions))
          .orderBy(queueTable.createdAt)
      : await db.select().from(queueTable).orderBy(queueTable.createdAt);

  // Get all counters for name lookup
  const counters = await db.select().from(countersTable);
  const counterMap = new Map(counters.map((c) => [c.id, c.name]));

  const result = entries.map((e) =>
    serializeEntry(e, e.assignedCounterId ? counterMap.get(e.assignedCounterId) ?? null : null, e.taggerCounterId ? counterMap.get(e.taggerCounterId) ?? null : null),
  );
  res.json(result);
});

// Call student
router.post("/queue/:id/call", async (req, res): Promise<void> => {
  const params = CallStudentParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const reannounceOnly = req.query?.reannounce === "1" || req.body?.reannounce === true;
  if (reannounceOnly) {
    const [entry] = await db.select().from(queueTable).where(eq(queueTable.id, params.data.id));
    if (!entry) {
      res.status(404).json({ error: "Queue entry not found" });
      return;
    }
    const [counter] = entry.assignedCounterId
      ? await db.select().from(countersTable).where(eq(countersTable.id, entry.assignedCounterId))
      : [];
    const counterLabel = counter?.name ?? "the assigned counter";
    const text = `Queue Number ${entry.queueNumber}. ${entry.fullName}. Please proceed to ${counterLabel}.`;
    const { randomUUID } = await import("crypto");
    const eventId = `call-again-${entry.id}-${Date.now()}-${randomUUID()}`;
    console.log("[SERVER] Voice event received", {
      eventId,
      type: "queue_call_again",
      queueId: entry.id,
      queueNumber: entry.queueNumber,
    });
    await appendTvManualVoiceCommand({
      id: eventId,
      type: "queue_call_again",
      queueId: entry.id,
      title: `Queue Number ${entry.queueNumber}`,
      message: `${entry.fullName}. Please proceed to ${counterLabel}.`,
      text,
    });
    res.json(serializeEntry(entry, counter?.name ?? null));
    return;
  }

  const [entry] = await db
    .update(queueTable)
    .set({ status: "called", calledAt: new Date() })
    .where(eq(queueTable.id, params.data.id))
    .returning();
  if (!entry) {
    res.status(404).json({ error: "Queue entry not found" });
    return;
  }
  emitQueueUpdate();
  const [counter] = entry.assignedCounterId
    ? await db.select().from(countersTable).where(eq(countersTable.id, entry.assignedCounterId))
    : [];
  res.json(serializeEntry(entry, counter?.name ?? null));
});

// Start processing
router.post("/queue/:id/start", async (req, res): Promise<void> => {
  const params = StartProcessingParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [existing] = await db.select().from(queueTable).where(eq(queueTable.id, params.data.id));
  if (!existing) {
    res.status(404).json({ error: "Queue entry not found" });
    return;
  }

  const [entry] = await db
    .update(queueTable)
    .set({ status: "in_progress", startedAt: new Date() })
    .where(eq(queueTable.id, params.data.id))
    .returning();

  // Update counter to busy
  if (entry.assignedCounterId) {
    await db
      .update(countersTable)
      .set({ status: "busy", currentStudentId: entry.id, currentStudentName: entry.fullName })
      .where(eq(countersTable.id, entry.assignedCounterId));
  }

  emitQueueUpdate();
  const [counter] = entry.assignedCounterId
    ? await db.select().from(countersTable).where(eq(countersTable.id, entry.assignedCounterId))
    : [];
  res.json(serializeEntry(entry, counter?.name ?? null));
});

// Complete processing
router.post("/queue/:id/complete", async (req, res): Promise<void> => {
  const params = CompleteProcessingParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [existing] = await db.select().from(queueTable).where(eq(queueTable.id, params.data.id));
  if (!existing) {
    res.status(404).json({ error: "Queue entry not found" });
    return;
  }

  const [entry] = await db
    .update(queueTable)
    .set({
      status: "completed",
      completedAt: new Date(),
      taggedBy: existing.assignedCounterId,
      taggedAt: new Date(),
    })
    .where(eq(queueTable.id, params.data.id))
    .returning();

  // Reset counter
  if (entry.assignedCounterId) {
    await db
      .update(countersTable)
      .set({
        status: "available",
        currentStudentId: null,
        currentStudentName: null,
        currentQueueCount: sql`GREATEST(${countersTable.currentQueueCount} - 1, 0)`,
      })
      .where(eq(countersTable.id, entry.assignedCounterId));
  }

  emitQueueUpdate();
  const [counter] = entry.assignedCounterId
    ? await db.select().from(countersTable).where(eq(countersTable.id, entry.assignedCounterId))
    : [];
  res.json(serializeEntry(entry, counter?.name ?? null));
});

// Complete evaluation without enrollment
router.post("/queue/:id/complete-evaluation", async (req, res): Promise<void> => {
  const params = CompleteProcessingParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [existing] = await db.select().from(queueTable).where(eq(queueTable.id, params.data.id));
  if (!existing) {
    res.status(404).json({ error: "Queue entry not found" });
    return;
  }

  const completedAt = new Date();
  const [entry] = await db
    .update(queueTable)
    .set({
      status: "evaluation_completed",
      completedAt,
      evaluatedBy: existing.assignedCounterId,
      evaluatedAt: completedAt,
    })
    .where(eq(queueTable.id, params.data.id))
    .returning();

  if (entry.assignedCounterId) {
    await db
      .update(countersTable)
      .set({
        status: "available",
        currentStudentId: null,
        currentStudentName: null,
        currentQueueCount: sql`GREATEST(${countersTable.currentQueueCount} - 1, 0)`,
      })
      .where(eq(countersTable.id, entry.assignedCounterId));
  }

  emitQueueUpdate();
  const [counter] = entry.assignedCounterId
    ? await db.select().from(countersTable).where(eq(countersTable.id, entry.assignedCounterId))
    : [];
  res.json(serializeEntry(entry, counter?.name ?? null));
});

// Transfer to tagger (evaluator assigns student to tagger)
router.post("/queue/:id/transfer", async (req, res): Promise<void> => {
  const params = TransferToTaggerParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = TransferToTaggerBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [existing] = await db.select().from(queueTable).where(eq(queueTable.id, params.data.id));
  if (!existing) {
    res.status(404).json({ error: "Queue entry not found" });
    return;
  }

  // Mark previous evaluator counter as done with this student
  if (existing.assignedCounterId) {
    await db
      .update(countersTable)
      .set({
        status: "available",
        currentStudentId: null,
        currentStudentName: null,
        currentQueueCount: sql`GREATEST(${countersTable.currentQueueCount} - 1, 0)`,
      })
      .where(eq(countersTable.id, existing.assignedCounterId));
  }

  // Transfer to tagger
  const [entry] = await db
    .update(queueTable)
    .set({
      evaluatedBy: existing.assignedCounterId,
      evaluatedAt: new Date(),
      taggerCounterId: parsed.data.taggerCounterId,
      assignedCounterId: parsed.data.taggerCounterId,
      status: "waiting",
      startedAt: null,
      calledAt: null,
    })
    .where(eq(queueTable.id, params.data.id))
    .returning();

  // Increment tagger counter queue count
  await db
    .update(countersTable)
    .set({ currentQueueCount: sql`${countersTable.currentQueueCount} + 1` })
    .where(eq(countersTable.id, parsed.data.taggerCounterId));

  emitQueueUpdate();
  const [tagger] = await db.select().from(countersTable).where(eq(countersTable.id, parsed.data.taggerCounterId));
  res.json(serializeEntry(entry, tagger?.name ?? null, tagger?.name ?? null));
});

// Cancel queue entry
router.post("/queue/:id/cancel", async (req, res): Promise<void> => {
  const params = CancelQueueEntryParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [existing] = await db.select().from(queueTable).where(eq(queueTable.id, params.data.id));
  if (!existing) {
    res.status(404).json({ error: "Queue entry not found" });
    return;
  }

  const [entry] = await db
    .update(queueTable)
    .set({ status: "cancelled" })
    .where(eq(queueTable.id, params.data.id))
    .returning();

  if (existing.assignedCounterId && ["waiting", "called", "in_progress"].includes(existing.status)) {
    await db
      .update(countersTable)
      .set({ currentQueueCount: sql`GREATEST(${countersTable.currentQueueCount} - 1, 0)` })
      .where(eq(countersTable.id, existing.assignedCounterId));
  }

  emitQueueUpdate();
  const [counter] = entry.assignedCounterId
    ? await db.select().from(countersTable).where(eq(countersTable.id, entry.assignedCounterId))
    : [];
  res.json(serializeEntry(entry, counter?.name ?? null));
});

// Delete queue entry
router.delete("/queue/:id", async (req, res): Promise<void> => {
  const params = CancelQueueEntryParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [existing] = await db.select().from(queueTable).where(eq(queueTable.id, params.data.id));
  if (!existing) {
    res.status(404).json({ error: "Queue entry not found" });
    return;
  }

  await db.delete(queueTable).where(eq(queueTable.id, params.data.id));

  if (existing.assignedCounterId && ["waiting", "called", "in_progress"].includes(existing.status)) {
    await db
      .update(countersTable)
      .set({
        currentQueueCount: sql`GREATEST(${countersTable.currentQueueCount} - 1, 0)`,
        currentStudentId: sql`CASE WHEN ${countersTable.currentStudentId} = ${existing.id} THEN NULL ELSE ${countersTable.currentStudentId} END`,
        currentStudentName: sql`CASE WHEN ${countersTable.currentStudentId} = ${existing.id} THEN NULL ELSE ${countersTable.currentStudentName} END`,
        status: sql`CASE WHEN ${countersTable.currentStudentId} = ${existing.id} THEN 'available' ELSE ${countersTable.status} END`,
      })
      .where(eq(countersTable.id, existing.assignedCounterId));
  }

  emitQueueUpdate();
  res.sendStatus(204);
});

// Reassign to different counter
router.post("/queue/:id/reassign", async (req, res): Promise<void> => {
  const params = ReassignQueueParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = ReassignQueueBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [existing] = await db.select().from(queueTable).where(eq(queueTable.id, params.data.id));
  if (!existing) {
    res.status(404).json({ error: "Queue entry not found" });
    return;
  }

  // Decrement old counter
  if (existing.assignedCounterId) {
    await db
      .update(countersTable)
      .set({ currentQueueCount: sql`GREATEST(${countersTable.currentQueueCount} - 1, 0)` })
      .where(eq(countersTable.id, existing.assignedCounterId));
  }

  const [entry] = await db
    .update(queueTable)
    .set({ assignedCounterId: parsed.data.counterId, status: "waiting" })
    .where(eq(queueTable.id, params.data.id))
    .returning();

  // Increment new counter
  await db
    .update(countersTable)
    .set({ currentQueueCount: sql`${countersTable.currentQueueCount} + 1` })
    .where(eq(countersTable.id, parsed.data.counterId));

  emitQueueUpdate();
  const [counter] = await db.select().from(countersTable).where(eq(countersTable.id, parsed.data.counterId));
  res.json(serializeEntry(entry, counter?.name ?? null));
});

export default router;
