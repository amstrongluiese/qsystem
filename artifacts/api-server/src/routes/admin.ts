import { Router, type IRouter } from "express";
import { eq, avg, count, sql } from "drizzle-orm";
import fs from "fs/promises";
import path from "path";
import { db, queueTable, countersTable, announcementsTable } from "@workspace/db";
import {
  AdminLoginBody,
  PauseCounterParams,
  ResumeCounterParams,
  CreateAnnouncementBody,
  DeleteAnnouncementParams,
} from "@workspace/api-zod";
import { emitQueueUpdate, getConnectedSocketCount } from "../lib/socket.js";
import {
  appendTvManualVoiceCommand,
  tvMediaDir,
  tvSettingsPath,
  type TvManualVoiceCommand,
} from "../lib/tv-voice-events.js";

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "admin123";
const tvMediaManifest = path.join(tvMediaDir, "playlist.json");

type TvMediaItem = {
  id: string;
  name: string;
  type: "video" | "image";
  url: string;
  uploadedAt: string;
  fitMode: "contain" | "cover" | "fill" | "center";
  horizontalPosition: "left" | "center" | "right";
  verticalPosition: "top" | "center" | "bottom";
  scale: number;
  trimStart: number;
  trimEnd: number | null;
  volumeLevel: number;
  muted: boolean;
  updatedAt: string;
  itemVolume: number;
  itemMuted: boolean;
  playbackSpeed: 0.5 | 1 | 1.25 | 1.5;
  loop: boolean;
  enabled: boolean;
  order: number;
};

type TvAvailableVoice = {
  voiceId: string;
  name: string;
  lang: string;
  localService?: boolean;
  default?: boolean;
};

type TvSettings = {
  muted: boolean;
  audioEnabled: boolean;
  volume: number;
  fullscreenEnabled: boolean;
  fullscreenRequestId: number;
  voiceAnnouncementEnabled: boolean;
  notificationSoundEnabled: boolean;
  announcementVolume: number;
  announcementChimeVolume: number;
  voicePriorityBoost: boolean;
  announcementLanguage: "english";
  announcementAccent: "en-US";
  announcementGender: "female" | "male";
  announcementVoiceName: string;
  announcementVoiceId: string;
  announcementVoiceGender: "female" | "male";
  announcementRate: number;
  announcementPitch: number;
  announcementTwice: boolean;
  manualAnnouncementVoiceCommand?: {
    id: string;
    type?: "announcement" | "queue_call_again";
    announcementId?: number;
    queueId?: number;
    title?: string;
    message?: string;
    text: string;
    createdAt: string;
  } | null;
  manualVoiceEvents?: TvManualVoiceCommand[];
  autoPlay: boolean;
  mediaTransitionType: "fade" | "slide" | "none";
  mediaTransitionDuration: number;
  lunchBreakEnabled: boolean;
  cutOffEnabled: boolean;
  tvBrowserName?: string;
  tvBrowserVersion?: string;
  tvBrowserIsFirefox?: boolean;
  tvLastVoiceSync?: string;
  tvConnectedClients?: number;
  lastTvVoiceEventId?: string;
  lastTvVoiceEventType?: string;
  lastTvVoiceEventAt?: string;
  tvAvailableVoices: TvAvailableVoice[];
};

const router: IRouter = Router();
const TV_MEDIA_EXTENSIONS = new Set([".mp4", ".webm", ".mov", ".m4v", ".jpg", ".jpeg", ".png", ".gif", ".webp"]);
const TV_VIDEO_EXTENSIONS = new Set([".mp4", ".webm", ".mov", ".m4v"]);

async function ensureTvMediaDir() {
  await fs.mkdir(tvMediaDir, { recursive: true });
}

function getMediaItemFromFile(filename: string, index: number): TvMediaItem | null {
  const extension = path.extname(filename).toLowerCase();
  if (!TV_MEDIA_EXTENSIONS.has(extension)) return null;

  const basename = path.basename(filename, extension);
  const idMatch = basename.match(/^(\d+-[a-z0-9]+)(?:-|$)/i);
  const id = idMatch?.[1] ?? basename;
  const name = basename
    .replace(/^(\d+-[a-z0-9]+)-?/i, "")
    .replace(/-/g, " ")
    .trim() || filename;

  return normalizeTvMediaItem({
    id,
    name: `${name}${extension}`,
    type: TV_VIDEO_EXTENSIONS.has(extension) ? "video" : "image",
    url: `/tv-media/${filename}`,
    uploadedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    order: index,
  }, index);
}

async function readTvMediaFiles(): Promise<TvMediaItem[]> {
  try {
    await ensureTvMediaDir();
    const entries = await fs.readdir(tvMediaDir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile())
      .map((entry, index) => getMediaItemFromFile(entry.name, index))
      .filter((item): item is TvMediaItem => Boolean(item));
  } catch (error) {
    console.warn("TV media file scan failed", {
      mediaDir: tvMediaDir,
      message: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

function mergePlaylistWithFiles(playlistItems: TvMediaItem[], fileItems: TvMediaItem[]) {
  const byUrl = new Map(playlistItems.map((item) => [item.url, item]));
  const byId = new Map(playlistItems.map((item) => [item.id, item]));
  const recovered = fileItems.filter((item) => !byUrl.has(item.url) && !byId.has(item.id));
  if (recovered.length > 0) {
    console.warn("TV media playlist recovered missing files", {
      recoveredCount: recovered.length,
      files: recovered.map((item) => item.url),
    });
  }
  return [...playlistItems, ...recovered.map((item, index) => ({ ...item, order: playlistItems.length + index }))].sort((a, b) => a.order - b.order);
}

async function readTvMediaPlaylist(): Promise<TvMediaItem[]> {
  const fileItems = await readTvMediaFiles();
  try {
    const raw = await fs.readFile(tvMediaManifest, "utf8");
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      console.warn("TV media playlist ignored non-array manifest", {
        manifest: tvMediaManifest,
        payloadType: typeof parsed,
      });
      return fileItems;
    }
    const normalized = mergePlaylistWithFiles(parsed.map(normalizeTvMediaItem), fileItems);
    console.info("TV media playlist loaded", {
      manifest: tvMediaManifest,
      returnedCount: normalized.length,
      enabledCount: normalized.filter((item) => item.enabled !== false).length,
      videoCount: normalized.filter((item) => item.type === "video").length,
      imageCount: normalized.filter((item) => item.type === "image").length,
    });
    return normalized;
  } catch (error) {
    console.error("TV media playlist failed to load", {
      manifest: tvMediaManifest,
      message: error instanceof Error ? error.message : String(error),
    });
    return fileItems;
  }
}

async function writeTvMediaPlaylist(items: TvMediaItem[]) {
  await ensureTvMediaDir();
  await fs.writeFile(tvMediaManifest, JSON.stringify(items.map(normalizeTvMediaItem), null, 2), "utf8");
}

function normalizeTvMediaItem(item: Partial<TvMediaItem>, index = 0): TvMediaItem {
  const fitMode = item.fitMode === "contain" || item.fitMode === "fill" || item.fitMode === "center" ? item.fitMode : "cover";
  const horizontalPosition =
    item.horizontalPosition === "left" || item.horizontalPosition === "right" ? item.horizontalPosition : "center";
  const verticalPosition = item.verticalPosition === "top" || item.verticalPosition === "bottom" ? item.verticalPosition : "center";
  const playbackSpeed =
    item.playbackSpeed === 0.5 || item.playbackSpeed === 1.25 || item.playbackSpeed === 1.5 ? item.playbackSpeed : 1;

  return {
    id: String(item.id ?? `${Date.now()}-${index}`),
    name: String(item.name ?? "Media"),
    type: item.type === "image" ? "image" : "video",
    url: String(item.url ?? ""),
    uploadedAt: String(item.uploadedAt ?? new Date().toISOString()),
    fitMode,
    horizontalPosition,
    verticalPosition,
    scale: typeof item.scale === "number" ? Math.min(1.5, Math.max(0.5, item.scale)) : 1,
    trimStart: typeof item.trimStart === "number" ? Math.max(0, item.trimStart) : 0,
    trimEnd: typeof item.trimEnd === "number" && item.trimEnd > 0 ? item.trimEnd : null,
    volumeLevel:
      typeof item.volumeLevel === "number"
        ? Math.min(2, Math.max(0, item.volumeLevel))
        : typeof item.itemVolume === "number"
          ? Math.min(2, Math.max(0, item.itemVolume))
          : 1,
    muted: typeof item.muted === "boolean" ? item.muted : item.itemMuted === true,
    updatedAt: String(item.updatedAt ?? item.uploadedAt ?? new Date().toISOString()),
    itemVolume:
      typeof item.volumeLevel === "number"
        ? Math.min(2, Math.max(0, item.volumeLevel))
        : typeof item.itemVolume === "number"
          ? Math.min(2, Math.max(0, item.itemVolume))
          : 1,
    itemMuted: typeof item.muted === "boolean" ? item.muted : item.itemMuted === true,
    playbackSpeed,
    loop: typeof item.loop === "boolean" ? item.loop : false,
    enabled: typeof item.enabled === "boolean" ? item.enabled : true,
    order: typeof item.order === "number" ? item.order : index,
  };
}

function normalizeAnnouncementRate(value: unknown) {
  if (value === 0.75 || value === 1 || value === 1.25) return value;
  return 1;
}

function normalizeAnnouncementPitch(value: unknown) {
  if (value === 0.8 || value === 1 || value === 1.2) return value;
  return 1;
}

async function readTvSettings(): Promise<TvSettings> {
  try {
    const raw = await fs.readFile(tvSettingsPath, "utf8");
    const settings = JSON.parse(raw) as Partial<TvSettings>;
    return {
      muted: typeof settings.muted === "boolean" ? settings.muted : false,
      audioEnabled: typeof settings.audioEnabled === "boolean" ? settings.audioEnabled : true,
      volume: typeof settings.volume === "number" ? settings.volume : 1,
      fullscreenEnabled: typeof settings.fullscreenEnabled === "boolean" ? settings.fullscreenEnabled : false,
      fullscreenRequestId: typeof settings.fullscreenRequestId === "number" ? settings.fullscreenRequestId : 0,
      voiceAnnouncementEnabled: typeof settings.voiceAnnouncementEnabled === "boolean" ? settings.voiceAnnouncementEnabled : true,
      notificationSoundEnabled: typeof settings.notificationSoundEnabled === "boolean" ? settings.notificationSoundEnabled : true,
      announcementVolume: typeof settings.announcementVolume === "number" ? Math.min(1, Math.max(0, settings.announcementVolume)) : 1,
      announcementChimeVolume: typeof settings.announcementChimeVolume === "number" ? Math.min(1, Math.max(0, settings.announcementChimeVolume)) : 1,
      voicePriorityBoost: typeof settings.voicePriorityBoost === "boolean" ? settings.voicePriorityBoost : true,
      announcementLanguage: "english",
      announcementAccent: "en-US",
      announcementGender: settings.announcementGender === "male" ? "male" : "female",
      announcementVoiceName: typeof settings.announcementVoiceName === "string" ? settings.announcementVoiceName : "",
      announcementTwice: typeof settings.announcementTwice === "boolean" ? settings.announcementTwice : false,
      announcementVoiceId: typeof settings.announcementVoiceId === "string" ? settings.announcementVoiceId : "",
      announcementVoiceGender:
        settings.announcementVoiceGender === "male" || settings.announcementGender === "male" ? "male" : "female",
      announcementRate: normalizeAnnouncementRate(settings.announcementRate),
      announcementPitch: normalizeAnnouncementPitch(settings.announcementPitch),
      autoPlay: typeof settings.autoPlay === "boolean" ? settings.autoPlay : true,
      manualAnnouncementVoiceCommand:
        settings.manualAnnouncementVoiceCommand &&
        typeof settings.manualAnnouncementVoiceCommand.id === "string" &&
        typeof settings.manualAnnouncementVoiceCommand.text === "string"
          ? {
              id: settings.manualAnnouncementVoiceCommand.id,
              type:
                settings.manualAnnouncementVoiceCommand.type === "queue_call_again"
                  ? "queue_call_again"
                  : "announcement",
              announcementId:
                typeof settings.manualAnnouncementVoiceCommand.announcementId === "number"
                  ? settings.manualAnnouncementVoiceCommand.announcementId
                  : undefined,
              queueId:
                typeof settings.manualAnnouncementVoiceCommand.queueId === "number"
                  ? settings.manualAnnouncementVoiceCommand.queueId
                  : undefined,
              title:
                typeof settings.manualAnnouncementVoiceCommand.title === "string"
                  ? settings.manualAnnouncementVoiceCommand.title
                  : undefined,
              message:
                typeof settings.manualAnnouncementVoiceCommand.message === "string"
                  ? settings.manualAnnouncementVoiceCommand.message
                  : settings.manualAnnouncementVoiceCommand.text,
              text: settings.manualAnnouncementVoiceCommand.text,
              createdAt:
                typeof settings.manualAnnouncementVoiceCommand.createdAt === "string"
                  ? settings.manualAnnouncementVoiceCommand.createdAt
                  : new Date().toISOString(),
            }
          : null,
      manualVoiceEvents: Array.isArray(settings.manualVoiceEvents)
        ? settings.manualVoiceEvents
            .filter((event) => event && typeof event.id === "string" && typeof event.text === "string")
            .slice(-25)
        : [],
      mediaTransitionType:
        settings.mediaTransitionType === "slide" || settings.mediaTransitionType === "none"
          ? settings.mediaTransitionType
          : "fade",
      mediaTransitionDuration:
        typeof settings.mediaTransitionDuration === "number" ? Math.min(5, Math.max(0, settings.mediaTransitionDuration)) : 0.8,
      lunchBreakEnabled: typeof settings.lunchBreakEnabled === "boolean" ? settings.lunchBreakEnabled : false,
      cutOffEnabled: typeof settings.cutOffEnabled === "boolean" ? settings.cutOffEnabled : false,
      tvBrowserName: typeof settings.tvBrowserName === "string" ? settings.tvBrowserName : undefined,
      tvBrowserVersion: typeof settings.tvBrowserVersion === "string" ? settings.tvBrowserVersion : undefined,
      tvBrowserIsFirefox: typeof settings.tvBrowserIsFirefox === "boolean" ? settings.tvBrowserIsFirefox : undefined,
      tvLastVoiceSync: typeof settings.tvLastVoiceSync === "string" ? settings.tvLastVoiceSync : undefined,
      tvConnectedClients: getConnectedSocketCount(),
      lastTvVoiceEventId: typeof settings.lastTvVoiceEventId === "string" ? settings.lastTvVoiceEventId : undefined,
      lastTvVoiceEventType: typeof settings.lastTvVoiceEventType === "string" ? settings.lastTvVoiceEventType : undefined,
      lastTvVoiceEventAt: typeof settings.lastTvVoiceEventAt === "string" ? settings.lastTvVoiceEventAt : undefined,
      tvAvailableVoices: Array.isArray(settings.tvAvailableVoices) ? settings.tvAvailableVoices.filter((voice) => typeof voice === "object" && typeof (voice as any).voiceId === "string").map((voice) => ({
        voiceId: String((voice as any).voiceId),
        name: String((voice as any).name ?? ""),
        lang: String((voice as any).lang ?? ""),
        localService: typeof (voice as any).localService === "boolean" ? (voice as any).localService : undefined,
        default: typeof (voice as any).default === "boolean" ? (voice as any).default : undefined,
      })) : [],
    };
  } catch {
    return {
      muted: false,
      audioEnabled: true,
      volume: 1,
      fullscreenEnabled: false,
      fullscreenRequestId: 0,
      voiceAnnouncementEnabled: true,
      notificationSoundEnabled: true,
      announcementVolume: 1,
      announcementLanguage: "english",
      announcementAccent: "en-US",
      announcementGender: "female",
      announcementVoiceName: "",
      announcementVoiceId: "",
      announcementVoiceGender: "female",
      announcementRate: 1,
      announcementPitch: 1,
      announcementChimeVolume: 1,
      announcementTwice: false,
      manualAnnouncementVoiceCommand: null,
      manualVoiceEvents: [],
      voicePriorityBoost: true,
      autoPlay: true,
      mediaTransitionType: "fade",
      mediaTransitionDuration: 0.8,
      lunchBreakEnabled: false,
      cutOffEnabled: false,
      tvAvailableVoices: [],
    };
  }
}

async function writeTvSettings(settings: any) {
  await ensureTvMediaDir();
  await fs.writeFile(tvSettingsPath, JSON.stringify(settings, null, 2), "utf8");
}

// Admin login
router.post("/admin/login", async (req, res): Promise<void> => {
  const parsed = AdminLoginBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  if (parsed.data.password !== ADMIN_PASSWORD) {
    res.status(401).json({ error: "Invalid credentials" });
    return;
  }
  res.json({ success: true, token: Buffer.from(`admin:${Date.now()}`).toString("base64") });
});

// Reset queue
router.post("/admin/queue/reset", async (_req, res): Promise<void> => {
  await db.update(queueTable).set({ status: "cancelled" }).where(
    sql`${queueTable.status} IN ('waiting', 'called', 'in_progress')`,
  );
  await db.update(countersTable).set({
    currentQueueCount: 0,
    currentStudentId: null,
    currentStudentName: null,
    status: "available",
  });
  emitQueueUpdate();
  res.json({ success: true, message: "Queue has been reset" });
});

// Pause counter
router.post("/admin/counters/:id/pause", async (req, res): Promise<void> => {
  const params = PauseCounterParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [counter] = await db
    .update(countersTable)
    .set({ status: "break" })
    .where(eq(countersTable.id, params.data.id))
    .returning();
  if (!counter) {
    res.status(404).json({ error: "Counter not found" });
    return;
  }
  emitQueueUpdate();
  res.json({ ...counter, specialization: counter.specialization ?? null, staffName: counter.staffName ?? null, currentStudentId: counter.currentStudentId ?? null, currentStudentName: counter.currentStudentName ?? null });
});

// Resume counter
router.post("/admin/counters/:id/resume", async (req, res): Promise<void> => {
  const params = ResumeCounterParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [counter] = await db
    .update(countersTable)
    .set({ status: "available" })
    .where(eq(countersTable.id, params.data.id))
    .returning();
  if (!counter) {
    res.status(404).json({ error: "Counter not found" });
    return;
  }
  emitQueueUpdate();
  res.json({ ...counter, specialization: counter.specialization ?? null, staffName: counter.staffName ?? null, currentStudentId: counter.currentStudentId ?? null, currentStudentName: counter.currentStudentName ?? null });
});

// Announcements
router.get("/announcements", async (_req, res): Promise<void> => {
  const items = await db
    .select()
    .from(announcementsTable)
    .where(eq(announcementsTable.isActive, true))
    .orderBy(announcementsTable.createdAt);
  res.json(items);
});

router.post("/announcements", async (req, res): Promise<void> => {
  const parsed = CreateAnnouncementBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [item] = await db.insert(announcementsTable).values(parsed.data).returning();
  res.status(201).json(item);
});

router.delete("/announcements/:id", async (req, res): Promise<void> => {
  const params = DeleteAnnouncementParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  await db.delete(announcementsTable).where(eq(announcementsTable.id, params.data.id));
  res.sendStatus(204);
});

// TV settings
router.get("/tv/settings", async (_req, res): Promise<void> => {
  const settings = await readTvSettings();
  res.json(settings);
});

router.post("/tv/settings", async (req, res): Promise<void> => {
  const settings = await readTvSettings();
  let updated = false;

  if (typeof req.body?.muted === "boolean") {
    settings.muted = req.body.muted;
    updated = true;
  }
  if (typeof req.body?.audioEnabled === "boolean") {
    settings.audioEnabled = req.body.audioEnabled;
    updated = true;
  }
  if (typeof req.body?.volume === "number") {
    settings.volume = Math.min(1, Math.max(0, req.body.volume));
    updated = true;
  }
  if (typeof req.body?.fullscreenEnabled === "boolean") {
    settings.fullscreenEnabled = req.body.fullscreenEnabled;
    settings.fullscreenRequestId = Date.now();
    updated = true;
  }
  if (typeof req.body?.voiceAnnouncementEnabled === "boolean") {
    settings.voiceAnnouncementEnabled = req.body.voiceAnnouncementEnabled;
    updated = true;
  }
  if (typeof req.body?.notificationSoundEnabled === "boolean") {
    settings.notificationSoundEnabled = req.body.notificationSoundEnabled;
    updated = true;
  }
  if (typeof req.body?.announcementVolume === "number") {
    settings.announcementVolume = Math.min(1, Math.max(0, req.body.announcementVolume));
    updated = true;
  }
  if (typeof req.body?.announcementChimeVolume === "number") {
    settings.announcementChimeVolume = Math.min(1, Math.max(0, req.body.announcementChimeVolume));
    updated = true;
  }
  if (typeof req.body?.voicePriorityBoost === "boolean") {
    settings.voicePriorityBoost = req.body.voicePriorityBoost;
    updated = true;
  }
  if (req.body?.announcementLanguage === "english") {
    settings.announcementLanguage = "english";
    updated = true;
  }
  if (req.body?.announcementAccent === "en-US") {
    settings.announcementAccent = "en-US";
    updated = true;
  }
  if (req.body?.announcementGender === "female" || req.body?.announcementGender === "male") {
    settings.announcementGender = req.body.announcementGender;
    updated = true;
  }
  if (typeof req.body?.announcementVoiceName === "string") {
    settings.announcementVoiceName = req.body.announcementVoiceName;
    updated = true;
  }
  if (typeof req.body?.announcementVoiceId === "string") {
    settings.announcementVoiceId = req.body.announcementVoiceId;
    updated = true;
  }
  if (req.body?.announcementVoiceGender === "female" || req.body?.announcementVoiceGender === "male") {
    settings.announcementVoiceGender = req.body.announcementVoiceGender;
    settings.announcementGender = req.body.announcementVoiceGender;
    updated = true;
  }
  if (typeof req.body?.announcementRate === "number") {
    settings.announcementRate = normalizeAnnouncementRate(req.body.announcementRate);
    updated = true;
  }
  if (typeof req.body?.announcementPitch === "number") {
    settings.announcementPitch = normalizeAnnouncementPitch(req.body.announcementPitch);
    updated = true;
  }
  if (typeof req.body?.announcementTwice === "boolean") {
    settings.announcementTwice = req.body.announcementTwice;
    updated = true;
  }
  if (
    req.body?.manualAnnouncementVoiceCommand &&
    typeof req.body.manualAnnouncementVoiceCommand.id === "string" &&
    typeof req.body.manualAnnouncementVoiceCommand.text === "string"
  ) {
    const command = await appendTvManualVoiceCommand({
      id: req.body.manualAnnouncementVoiceCommand.id,
      type:
        req.body.manualAnnouncementVoiceCommand.type === "queue_call_again"
          ? "queue_call_again"
          : "announcement",
      announcementId:
        typeof req.body.manualAnnouncementVoiceCommand.announcementId === "number"
          ? req.body.manualAnnouncementVoiceCommand.announcementId
          : undefined,
      queueId:
        typeof req.body.manualAnnouncementVoiceCommand.queueId === "number"
          ? req.body.manualAnnouncementVoiceCommand.queueId
          : undefined,
      title:
        typeof req.body.manualAnnouncementVoiceCommand.title === "string"
          ? req.body.manualAnnouncementVoiceCommand.title
          : undefined,
      message:
        typeof req.body.manualAnnouncementVoiceCommand.message === "string"
          ? req.body.manualAnnouncementVoiceCommand.message
          : req.body.manualAnnouncementVoiceCommand.text,
      text: req.body.manualAnnouncementVoiceCommand.text,
      createdAt:
        typeof req.body.manualAnnouncementVoiceCommand.createdAt === "string"
          ? req.body.manualAnnouncementVoiceCommand.createdAt
          : new Date().toISOString(),
    });
    res.json({ ...(await readTvSettings()), manualAnnouncementVoiceCommand: command });
    return;
  }
  if (typeof req.body?.autoPlay === "boolean") {
    settings.autoPlay = req.body.autoPlay;
    updated = true;
  }
  if (req.body?.mediaTransitionType === "fade" || req.body?.mediaTransitionType === "slide" || req.body?.mediaTransitionType === "none") {
    settings.mediaTransitionType = req.body.mediaTransitionType;
    updated = true;
  }
  if (typeof req.body?.mediaTransitionDuration === "number") {
    settings.mediaTransitionDuration = Math.min(5, Math.max(0, req.body.mediaTransitionDuration));
    updated = true;
  }
  if (typeof req.body?.lunchBreakEnabled === "boolean") {
    settings.lunchBreakEnabled = req.body.lunchBreakEnabled;
    updated = true;
  }
  if (typeof req.body?.cutOffEnabled === "boolean") {
    settings.cutOffEnabled = req.body.cutOffEnabled;
    updated = true;
  }

  if (updated) {
    await writeTvSettings(settings);
    emitQueueUpdate(); // Trigger refresh on displays
  }

  res.json(settings);
});

router.post("/tv/voices", async (req, res): Promise<void> => {
  const settings = await readTvSettings();
  const voices: Partial<TvAvailableVoice>[] = Array.isArray(req.body?.availableVoices)
    ? req.body.availableVoices.filter((voice: Partial<TvAvailableVoice>) => typeof voice?.voiceId === "string")
    : [];
  const browserName = typeof req.body?.browserName === "string" ? req.body.browserName : undefined;
  const browserVersion = typeof req.body?.browserVersion === "string" ? req.body.browserVersion : undefined;
  const browserIsFirefox = typeof req.body?.isFirefox === "boolean" ? req.body.isFirefox : undefined;

  const nextAvailableVoices = voices.map((voice) => ({
    voiceId: String(voice.voiceId),
    name: String(voice.name ?? ""),
    lang: String(voice.lang ?? ""),
    localService: typeof voice.localService === "boolean" ? voice.localService : undefined,
    default: typeof voice.default === "boolean" ? voice.default : undefined,
  }));

  const currentSignature = JSON.stringify({
    tvAvailableVoices: settings.tvAvailableVoices,
    tvBrowserName: settings.tvBrowserName,
    tvBrowserVersion: settings.tvBrowserVersion,
    tvBrowserIsFirefox: settings.tvBrowserIsFirefox,
  });
  const nextSignature = JSON.stringify({
    tvAvailableVoices: nextAvailableVoices,
    tvBrowserName: browserName,
    tvBrowserVersion: browserVersion,
    tvBrowserIsFirefox: browserIsFirefox,
  });

  if (currentSignature !== nextSignature) {
    settings.tvAvailableVoices = nextAvailableVoices;
    settings.tvBrowserName = browserName;
    settings.tvBrowserVersion = browserVersion;
    settings.tvBrowserIsFirefox = browserIsFirefox;
    settings.tvLastVoiceSync = new Date().toISOString();
    await writeTvSettings(settings);
  }

  res.json(settings);
});

// TV media playlist
router.get("/tv/media", async (_req, res): Promise<void> => {
  const items = await readTvMediaPlaylist();
  console.info("TV media API response", {
    playlistCount: items.length,
    enabledCount: items.filter((item) => item.enabled !== false).length,
    filteredCount: items.length,
  });
  res.json(items);
});

router.post("/tv/media", async (req, res): Promise<void> => {
  const { filename, mimeType, data } = req.body ?? {};
  if (!filename || !mimeType || !data) {
    res.status(400).json({ error: "filename, mimeType, and data are required" });
    return;
  }

  const isVideo = String(mimeType).startsWith("video/");
  const isImage = String(mimeType).startsWith("image/");
  if (!isVideo && !isImage) {
    res.status(400).json({ error: "Only video and image files are supported" });
    return;
  }

  const extension = path.extname(String(filename)).toLowerCase() || (isVideo ? ".mp4" : ".jpg");
  const safeName = path
    .basename(String(filename), extension)
    .replace(/[^a-z0-9-_]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase() || "media";
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const storedName = `${id}-${safeName}${extension}`;
  const buffer = Buffer.from(String(data).replace(/^data:[^;]+;base64,/, ""), "base64");

  await ensureTvMediaDir();
  await fs.writeFile(path.join(tvMediaDir, storedName), buffer);

  const item: TvMediaItem = {
    id,
    name: String(filename),
    type: isVideo ? "video" : "image",
    url: `/tv-media/${storedName}`,
    uploadedAt: new Date().toISOString(),
    fitMode: "cover",
    horizontalPosition: "center",
    verticalPosition: "center",
    scale: 1,
    trimStart: 0,
    trimEnd: null,
    volumeLevel: 1,
    muted: false,
    updatedAt: new Date().toISOString(),
    itemVolume: 1,
    itemMuted: false,
    playbackSpeed: 1,
    loop: false,
    enabled: true,
    order: 0,
  };
  const items = await readTvMediaPlaylist();
  await writeTvMediaPlaylist([item, ...items.map((media, index) => ({ ...media, order: index + 1 }))]);

  res.status(201).json(item);
});

router.patch("/tv/media/:id", async (req, res): Promise<void> => {
  const id = String(req.params.id);
  const items = await readTvMediaPlaylist();
  const index = items.findIndex((media) => media.id === id);
  if (index === -1) {
    res.status(404).json({ error: "Media item not found" });
    return;
  }

  const current = items[index];
  const updates: Partial<TvMediaItem> = {};
  if (req.body?.fitMode === "contain" || req.body?.fitMode === "cover" || req.body?.fitMode === "fill" || req.body?.fitMode === "center") {
    updates.fitMode = req.body.fitMode;
  }
  if (req.body?.horizontalPosition === "left" || req.body?.horizontalPosition === "center" || req.body?.horizontalPosition === "right") {
    updates.horizontalPosition = req.body.horizontalPosition;
  }
  if (req.body?.verticalPosition === "top" || req.body?.verticalPosition === "center" || req.body?.verticalPosition === "bottom") {
    updates.verticalPosition = req.body.verticalPosition;
  }
  if (typeof req.body?.scale === "number") updates.scale = Math.min(1.5, Math.max(0.5, req.body.scale));
  if (typeof req.body?.trimStart === "number") updates.trimStart = Math.max(0, req.body.trimStart);
  if (typeof req.body?.trimEnd === "number") updates.trimEnd = req.body.trimEnd > 0 ? req.body.trimEnd : null;
  if (req.body?.trimEnd === null) updates.trimEnd = null;
  if (typeof req.body?.volumeLevel === "number") {
    updates.volumeLevel = Math.min(2, Math.max(0, req.body.volumeLevel));
    updates.itemVolume = updates.volumeLevel;
  }
  if (typeof req.body?.itemVolume === "number" && typeof req.body?.volumeLevel !== "number") {
    updates.volumeLevel = Math.min(2, Math.max(0, req.body.itemVolume));
    updates.itemVolume = updates.volumeLevel;
  }
  if (typeof req.body?.muted === "boolean") {
    updates.muted = req.body.muted;
    updates.itemMuted = req.body.muted;
  }
  if (typeof req.body?.itemMuted === "boolean" && typeof req.body?.muted !== "boolean") {
    updates.muted = req.body.itemMuted;
    updates.itemMuted = req.body.itemMuted;
  }
  if (req.body?.playbackSpeed === 0.5 || req.body?.playbackSpeed === 1 || req.body?.playbackSpeed === 1.25 || req.body?.playbackSpeed === 1.5) {
    updates.playbackSpeed = req.body.playbackSpeed;
  }
  if (typeof req.body?.loop === "boolean") updates.loop = req.body.loop;
  if (typeof req.body?.enabled === "boolean") updates.enabled = req.body.enabled;
  if (typeof req.body?.order === "number") updates.order = req.body.order;
  updates.updatedAt = new Date().toISOString();

  const updatedItem = normalizeTvMediaItem({ ...current, ...updates }, index);
  const updatedItems = [...items];
  updatedItems[index] = updatedItem;
  const orderedItems = updatedItems
    .sort((a, b) => a.order - b.order)
    .map((media, mediaIndex) => ({ ...media, order: mediaIndex }));

  await writeTvMediaPlaylist(orderedItems);
  emitQueueUpdate();
  res.json(orderedItems.find((media) => media.id === id) ?? updatedItem);
});

router.delete("/tv/media/:id", async (req, res): Promise<void> => {
  const id = String(req.params.id);
  const items = await readTvMediaPlaylist();
  const item = items.find((media) => media.id === id);
  if (!item) {
    res.status(404).json({ error: "Media item not found" });
    return;
  }

  const filename = path.basename(item.url);
  await fs.rm(path.join(tvMediaDir, filename), { force: true });
  await writeTvMediaPlaylist(items.filter((media) => media.id !== id));
  res.sendStatus(204);
});

// Analytics summary
router.get("/analytics/summary", async (_req, res): Promise<void> => {
  const [totals] = await db
    .select({
      totalRegistered: count(),
      totalCompleted: sql<number>`COUNT(*) FILTER (WHERE status = 'completed')`,
      totalInProgress: sql<number>`COUNT(*) FILTER (WHERE status = 'in_progress')`,
      totalWaiting: sql<number>`COUNT(*) FILTER (WHERE status = 'waiting')`,
      totalCancelled: sql<number>`COUNT(*) FILTER (WHERE status = 'cancelled')`,
      avgWaitSecs: sql<number>`avg(EXTRACT(EPOCH FROM (started_at - created_at))) FILTER (WHERE started_at IS NOT NULL)`,
      avgProcessSecs: sql<number>`avg(EXTRACT(EPOCH FROM (completed_at - started_at))) FILTER (WHERE completed_at IS NOT NULL AND started_at IS NOT NULL)`,
    })
    .from(queueTable);

  const categoryRows = await db
    .select({ category: queueTable.category, count: count() })
    .from(queueTable)
    .groupBy(queueTable.category);

  const evaluatorCount = await db
    .select({ count: count() })
    .from(countersTable)
    .where(eq(countersTable.type, "evaluator"));
  const taggerCount = await db
    .select({ count: count() })
    .from(countersTable)
    .where(eq(countersTable.type, "tagger"));

  res.json({
    totalRegistered: Number(totals.totalRegistered ?? 0),
    totalCompleted: Number(totals.totalCompleted ?? 0),
    totalInProgress: Number(totals.totalInProgress ?? 0),
    totalWaiting: Number(totals.totalWaiting ?? 0),
    totalCancelled: Number(totals.totalCancelled ?? 0),
    averageWaitMinutes: totals.avgWaitSecs ? Math.round(Number(totals.avgWaitSecs) / 60) : null,
    averageProcessMinutes: totals.avgProcessSecs ? Math.round(Number(totals.avgProcessSecs) / 60) : null,
    evaluatorCount: Number(evaluatorCount[0]?.count ?? 0),
    taggerCount: Number(taggerCount[0]?.count ?? 0),
    categoryBreakdown: categoryRows.map((r) => ({ category: r.category, count: Number(r.count) })),
  });
});

// Counter analytics
router.get("/analytics/counters", async (_req, res): Promise<void> => {
  const counters = await db.select().from(countersTable);
  const results = await Promise.all(
    counters.map(async (counter) => {
      const [stats] = await db
        .select({
          totalServed: sql<number>`COUNT(*) FILTER (WHERE status = 'completed')`,
          avgProcessSecs: sql<number>`avg(EXTRACT(EPOCH FROM (completed_at - started_at))) FILTER (WHERE completed_at IS NOT NULL AND started_at IS NOT NULL)`,
        })
        .from(queueTable)
        .where(eq(queueTable.assignedCounterId, counter.id));
      return {
        counterId: counter.id,
        counterName: counter.name,
        counterType: counter.type,
        totalServed: Number(stats?.totalServed ?? 0),
        averageProcessMinutes: stats?.avgProcessSecs ? Math.round(Number(stats.avgProcessSecs) / 60) : null,
        currentQueueCount: counter.currentQueueCount,
      };
    }),
  );
  res.json(results);
});

// Reports & Analytics
router.get("/analytics/reports", async (_req, res): Promise<void> => {
  const rows = await db.execute(sql`
    WITH reporting AS (
      SELECT
        c.id AS "counterId",
        c.name AS "counterName",
        c.staff_name AS "staffName",
        c.type AS "counterType",
        CASE
          WHEN c.type IN ('tagger', 'hybrid') THEN 'enrolled'
          ELSE 'evaluated'
        END AS "metricType",
        CASE
          WHEN c.type IN ('tagger', 'hybrid') THEN COALESCE(q.tagged_at, q.completed_at)
          ELSE COALESCE(q.evaluated_at, q.completed_at)
        END AS "activityAt"
      FROM queue q
      JOIN counters c ON c.id = CASE
        WHEN c.type IN ('tagger', 'hybrid') THEN COALESCE(
          q.tagged_by,
          q.tagger_counter_id,
          CASE
            WHEN q.status = 'completed' AND q.assigned_counter_id IS NOT NULL THEN q.assigned_counter_id
            ELSE NULL
          END
        )
        ELSE q.evaluated_by
      END
      WHERE
        (
          c.type IN ('tagger', 'hybrid')
          AND q.status = 'completed'
          AND COALESCE(q.tagged_by, q.tagger_counter_id, q.assigned_counter_id) IS NOT NULL
        )
        OR
        (
          c.type = 'evaluator'
          AND q.evaluated_by IS NOT NULL
        )
    )
    SELECT
      "counterId",
      "counterName",
      "staffName",
      "counterType",
      "metricType",
      COUNT(*)::int AS "allTime",
      COUNT(*) FILTER (WHERE "activityAt" >= CURRENT_DATE)::int AS "today",
      COUNT(*) FILTER (WHERE "activityAt" >= date_trunc('week', CURRENT_DATE))::int AS "thisWeek",
      COUNT(*) FILTER (WHERE "activityAt" >= date_trunc('month', CURRENT_DATE))::int AS "thisMonth"
    FROM reporting
    WHERE "activityAt" IS NOT NULL
    GROUP BY "counterId", "counterName", "staffName", "counterType", "metricType"
    ORDER BY "counterType", "counterName"
  `);

  const resultRows = Array.isArray(rows) ? rows : ((rows as any).rows ?? []);
  res.json(
    resultRows.map((row: any) => ({
      counterId: Number(row.counterId),
      counterName: row.counterName,
      staffName: row.staffName ?? null,
      counterType: row.counterType,
      metricType: row.metricType,
      today: Number(row.today ?? 0),
      thisWeek: Number(row.thisWeek ?? 0),
      thisMonth: Number(row.thisMonth ?? 0),
      allTime: Number(row.allTime ?? 0),
    })),
  );
});

router.get("/admin/queue-assistants/monitoring", async (_req, res): Promise<void> => {
  const assistants = await db
    .select()
    .from(countersTable)
    .where(eq(countersTable.type, "queue_assistant"))
    .orderBy(countersTable.createdAt);

  const rows = await Promise.all(
    assistants.map(async (assistant) => {
      const [counts] = await db
        .select({
          today: sql<number>`COUNT(*) FILTER (WHERE ${queueTable.createdAt} >= CURRENT_DATE)`,
          thisWeek: sql<number>`COUNT(*) FILTER (WHERE ${queueTable.createdAt} >= date_trunc('week', CURRENT_DATE))`,
          thisMonth: sql<number>`COUNT(*) FILTER (WHERE ${queueTable.createdAt} >= date_trunc('month', CURRENT_DATE))`,
        })
        .from(queueTable)
        .where(eq(queueTable.createdByAssistantId, assistant.id));

      const recent = await db
        .select()
        .from(queueTable)
        .where(eq(queueTable.createdByAssistantId, assistant.id))
        .orderBy(sql`${queueTable.createdAt} DESC`)
        .limit(10);

      return {
        assistantId: assistant.id,
        assistantName: assistant.staffName || assistant.name,
        counterName: assistant.name,
        generatedQueuesToday: Number(counts?.today ?? 0),
        generatedQueuesThisWeek: Number(counts?.thisWeek ?? 0),
        generatedQueuesThisMonth: Number(counts?.thisMonth ?? 0),
        lastLogin: assistant.lastLoginAt?.toISOString() ?? null,
        currentStatus: assistant.isOnline ? "online" : "offline",
        recentQueues: recent.map((entry) => ({
          queueNumber: entry.queueNumber,
          studentName: entry.fullName,
          createdAt: entry.createdAt.toISOString(),
          status: entry.status,
        })),
      };
    }),
  );

  res.json(rows);
});

// TV display
router.get("/tv/display", async (_req, res): Promise<void> => {
  const activeEntries = await db
    .select()
    .from(queueTable)
    .where(sql`${queueTable.status} IN ('called', 'in_progress')`);

  const waitingEntries = await db
    .select()
    .from(queueTable)
    .where(eq(queueTable.status, "waiting"))
    .orderBy(queueTable.createdAt);

  const completedEntries = await db
    .select()
    .from(queueTable)
    .where(eq(queueTable.status, "completed"))
    .orderBy(sql`${queueTable.completedAt} DESC`)
    .limit(10);

  const counters = await db.select().from(countersTable);
  const counterMap = new Map(counters.map((c) => [c.id, c]));

  const mapToTvItem = (entry: any) => {
    const counter = entry.assignedCounterId ? counterMap.get(entry.assignedCounterId) : null;
    const tagger = entry.taggerCounterId ? counterMap.get(entry.taggerCounterId) : null;
    const displayStatus = counter?.status === "break" || counter?.status === "paused" ? counter.status : entry.status;
    return {
      queueNumber: entry.queueNumber,
      studentName: entry.fullName,
      counterName: counter?.name ?? "Unknown",
      counterType: (counter?.type ?? "evaluator") as "evaluator" | "tagger" | "hybrid",
      status: displayStatus,
      assignedTaggerName: tagger?.name ?? null,
      calledAt: entry.calledAt?.toISOString?.() ?? null,
    };
  };

  const activeAssignedCounterIds = new Set(activeEntries.map((entry) => entry.assignedCounterId).filter(Boolean));
  const breakCounterItems = counters
    .filter((counter) => counter.isOnline && (counter.status === "break" || counter.status === "paused") && !activeAssignedCounterIds.has(counter.id))
    .map((counter) => ({
      queueNumber: "BREAK",
      studentName: null,
      counterName: counter.name,
      counterType: (counter.type ?? "evaluator") as "evaluator" | "tagger" | "hybrid",
      status: counter.status,
      assignedTaggerName: null,
    }));

  const nowServing = [...breakCounterItems, ...activeEntries.map(mapToTvItem)];
  const waitingForEvaluation = waitingEntries.filter(e => e.workflow === "evaluation" && !e.taggerCounterId).map(mapToTvItem);
  const waitingForTagging = waitingEntries.filter(e => e.workflow === "direct_tagging" || e.taggerCounterId).map(mapToTvItem);
  const completed = completedEntries.map(mapToTvItem);

  const announcements = await db
    .select()
    .from(announcementsTable)
    .where(eq(announcementsTable.isActive, true));
  const settings = await readTvSettings();

  res.json({
    nowServing,
    waitingForEvaluation,
    waitingForTagging,
    completed,
    announcements: announcements.map((a) => a.message),
    totalWaiting: waitingEntries.length,
    lunchBreakEnabled: settings.lunchBreakEnabled,
    cutOffEnabled: settings.cutOffEnabled,
    settings,
  });
});

export default router;
