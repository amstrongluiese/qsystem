import { Server as SocketIOServer } from "socket.io";
import type { Server as HttpServer } from "http";

import { db, countersTable } from "@workspace/db";
import { eq } from "drizzle-orm";

import { autoAssignWaitingStudents } from "../routes/queue.js";

let io: SocketIOServer | null = null;
const socketToCounter = new Map<string, number>();
const counterSockets = new Map<number, Set<string>>();
const offlineTimers = new Map<number, NodeJS.Timeout>();

const OFFLINE_TIMEOUT_MS = 90_000;

function clearOfflineTimer(counterId: number) {
  const timer = offlineTimers.get(counterId);
  if (!timer) return;
  clearTimeout(timer);
  offlineTimers.delete(counterId);
}

async function markCounterOnline(counterId: number) {
  clearOfflineTimer(counterId);

  const [counter] = await db.select().from(countersTable).where(eq(countersTable.id, counterId));
  if (!counter || !counter.isActive) return;

  const updateData: { isOnline: boolean; status?: string } = { isOnline: true };
  if (counter.status === "offline") {
    updateData.status = "available";
  }

  await db.update(countersTable).set(updateData).where(eq(countersTable.id, counterId));
  await autoAssignWaitingStudents(counterId);
  emitQueueUpdate();
}

function scheduleOfflineCheck(counterId: number) {
  clearOfflineTimer(counterId);
  offlineTimers.set(
    counterId,
    setTimeout(async () => {
      offlineTimers.delete(counterId);
      const activeSockets = counterSockets.get(counterId);
      if (activeSockets && activeSockets.size > 0) return;

      const [counter] = await db.select().from(countersTable).where(eq(countersTable.id, counterId));
      if (!counter) return;

      const lastSeenAt = counter.updatedAt?.getTime() ?? 0;
      if (Date.now() - lastSeenAt < OFFLINE_TIMEOUT_MS) {
        scheduleOfflineCheck(counterId);
        return;
      }

      await db.update(countersTable).set({ isOnline: false }).where(eq(countersTable.id, counterId));
      emitQueueUpdate();
    }, OFFLINE_TIMEOUT_MS),
  );
}

export function initSocket(server: HttpServer): void {
  io = new SocketIOServer(server, {
    cors: { origin: "*", methods: ["GET", "POST"] },
    path: "/api/socket.io",
  });

  io.on("connection", (socket) => {
    socket.on("tv_display_join", () => {
      void socket.join("tv_display");
    });

    socket.on("staff_join", async (counterId: number) => {
      socketToCounter.set(socket.id, counterId);
      const sockets = counterSockets.get(counterId) ?? new Set<string>();
      sockets.add(socket.id);
      counterSockets.set(counterId, sockets);
      await markCounterOnline(counterId);
    });

    socket.on("staff_heartbeat", async (counterId: number) => {
      await markCounterOnline(counterId);
    });

    socket.on("disconnect", async () => {
      const counterId = socketToCounter.get(socket.id);
      if (counterId) {
        socketToCounter.delete(socket.id);
        const sockets = counterSockets.get(counterId);
        sockets?.delete(socket.id);
        if (sockets && sockets.size === 0) {
          counterSockets.delete(counterId);
          scheduleOfflineCheck(counterId);
        }
      }
    });
  });
}

export function emitQueueUpdate(): void {
  if (io) {
    io.emit("queue_update");
  }
}

export function emitTvVoiceEvent(event: unknown): void {
  if (io) {
    console.log("[SERVER] Speak event broadcasted to TV clients", event);
    io.to("tv_display").emit("tv_voice_event", event);
  }
}

export function getConnectedSocketCount(): number {
  return io?.engine.clientsCount ?? 0;
}
