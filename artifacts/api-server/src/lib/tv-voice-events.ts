import fs from "fs/promises";
import fsSync from "fs";
import path from "path";
import { emitTvVoiceEvent } from "./socket.js";

function resolveTvMediaDir() {
  const candidates = [
    process.env.TV_MEDIA_DIR,
    path.resolve(process.cwd(), "artifacts/enrollment-system/public/tv-media"),
    path.resolve(process.cwd(), "../enrollment-system/public/tv-media"),
    path.resolve(__dirname, "../../../enrollment-system/public/tv-media"),
    path.resolve(__dirname, "../../enrollment-system/public/tv-media"),
  ].filter((candidate): candidate is string => Boolean(candidate));

  const withPlaylist = candidates.find((candidate) => fsSync.existsSync(path.join(candidate, "playlist.json")));
  if (withPlaylist) return withPlaylist;

  return candidates.find((candidate) => fsSync.existsSync(candidate)) ?? candidates[0];
}

export const tvMediaDir = resolveTvMediaDir();
export const tvSettingsPath = path.join(tvMediaDir, "settings.json");

export type TvManualVoiceCommand = {
  id: string;
  type: "announcement" | "queue_call_again";
  announcementId?: number;
  queueId?: number;
  title?: string;
  message: string;
  text: string;
  createdAt: string;
};

async function ensureTvMediaDir() {
  await fs.mkdir(tvMediaDir, { recursive: true });
}

async function readSettingsRecord(): Promise<Record<string, unknown>> {
  try {
    const raw = await fs.readFile(tvSettingsPath, "utf8");
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export async function appendTvManualVoiceCommand(command: Omit<TvManualVoiceCommand, "createdAt"> & { createdAt?: string }) {
  await ensureTvMediaDir();
  const settings = await readSettingsRecord();
  const manualVoiceEvents = Array.isArray(settings.manualVoiceEvents)
    ? settings.manualVoiceEvents.filter((event): event is TvManualVoiceCommand => {
        return Boolean(event) && typeof event === "object" && typeof (event as TvManualVoiceCommand).id === "string";
      })
    : [];

  const nextCommand: TvManualVoiceCommand = {
    ...command,
    createdAt: command.createdAt ?? new Date().toISOString(),
  };

  const nextEvents = [...manualVoiceEvents.filter((event) => event.id !== nextCommand.id), nextCommand].slice(-25);
  const nextSettings = {
    ...settings,
    manualAnnouncementVoiceCommand: nextCommand,
    manualVoiceEvents: nextEvents,
    lastTvVoiceEventId: nextCommand.id,
    lastTvVoiceEventType: nextCommand.type,
    lastTvVoiceEventAt: nextCommand.createdAt,
  };

  await fs.writeFile(tvSettingsPath, JSON.stringify(nextSettings, null, 2));
  console.log("[SERVER] Speak event received", {
    eventId: nextCommand.id,
    announcementId: nextCommand.announcementId,
    queueId: nextCommand.queueId,
    type: nextCommand.type,
  });
  emitTvVoiceEvent(nextCommand);
  return nextCommand;
}
