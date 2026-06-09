/* eslint-disable react/jsx-no-literals */
/* eslint-disable i18next/no-literal-string */
// noinspection ALL
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getGetTvDisplayQueryKey } from "@workspace/api-client-react";
import { motion, AnimatePresence } from "framer-motion";
import { Card, CardContent } from "@/components/ui/card";
import { CcsLogo } from "@/components/ccs-logo";
import { useQueueSocket } from "@/hooks/use-socket";
import React from "react";
import {
  getEnglishUsVoices,
  getQueueAnnouncementText,
  resolveAnnouncementVoice,
} from "@/lib/voice-announcement";

const TV_AUDIO_ACTIVATED_KEY = "tv-display-audio-activated";
const TV_FULLSCREEN_ACTIVATED_KEY = "tv-display-fullscreen-activated";
const TV_REQUEST_TIMEOUT_MS = 8000;

function getStatusTextClass(status: string) {
  const normalized = status.toLowerCase().replace(/\s+/g, "_");
  switch (normalized) {
    case "called":
      return "text-red-600 font-bold animate-pulse";
    case "in_progress":
      return "text-emerald-600 font-bold";
    case "waiting":
    case "waiting_for_staff":
      return "text-orange-600 font-bold";
    case "break":
    case "paused":
    case "lunch_break":
      return "text-amber-600 font-bold";
    case "completed":
      return "text-blue-600 font-bold";
    case "evaluation_completed":
      return "text-violet-600 font-bold";
    case "enrolled":
      return "text-emerald-950 font-bold";
    case "skipped":
      return "text-gray-500 font-bold";
    case "cancelled":
      return "text-rose-700 font-bold";
    default:
      return "text-gray-500 font-semibold";
  }
}

function getDisplayStatusLabel(status: string) {
  const normalized = status.toLowerCase().replace(/\s+/g, "_");
  if (isLunchBreakStatus(status)) {
    return "Lunch Break";
  }
  return status.replace(/_/g, " ");
}

function isLunchBreakStatus(status?: string | null) {
  const normalized = (status ?? "").toLowerCase().replace(/\s+/g, "_");
  return normalized === "break" || normalized === "paused" || normalized === "lunch_break";
}

type TvMediaItem = {
  id: string;
  name: string;
  type: "video" | "image";
  url: string;
  uploadedAt: string;
  fitMode?: "contain" | "cover" | "fill" | "center";
  horizontalPosition?: "left" | "center" | "right";
  verticalPosition?: "top" | "center" | "bottom";
  scale?: number;
  trimStart?: number;
  trimEnd?: number | null;
  volumeLevel?: number;
  muted?: boolean;
  updatedAt?: string;
  itemVolume?: number;
  itemMuted?: boolean;
  playbackSpeed?: 0.5 | 1 | 1.25 | 1.5;
  loop?: boolean;
  enabled?: boolean;
  order?: number;
};

type TvQueueItem = {
  queueNumber: string;
  studentName?: string | null;
  counterName: string;
  counterType: "evaluator" | "tagger" | "hybrid";
  status: string;
  calledAt?: string | null;
};

type TvDisplayData = {
  nowServing: TvQueueItem[];
  waitingForEvaluation: TvQueueItem[];
  waitingForTagging: TvQueueItem[];
  completed: TvQueueItem[];
  announcements: string[];
  totalWaiting: number;
  lunchBreakEnabled?: boolean;
  cutOffEnabled?: boolean;
  settings?: { lunchBreakEnabled?: boolean; cutOffEnabled?: boolean };
};

type ManualAnnouncementVoiceCommand = {
  id: string;
  type?: "announcement" | "queue_call_again";
  announcementId?: number;
  queueId?: number;
  title?: string;
  message?: string;
  text: string;
  createdAt: string;
};

function normalizeManualVoiceCommand(value: unknown): ManualAnnouncementVoiceCommand | null {
  if (!value || typeof value !== "object") return null;
  const command = value as Partial<ManualAnnouncementVoiceCommand>;
  if (typeof command.id !== "string" || typeof command.text !== "string") return null;
  return {
    id: command.id,
    type: command.type === "queue_call_again" ? "queue_call_again" : "announcement",
    announcementId: typeof command.announcementId === "number" ? command.announcementId : undefined,
    queueId: typeof command.queueId === "number" ? command.queueId : undefined,
    title: typeof command.title === "string" ? command.title : undefined,
    message: typeof command.message === "string" ? command.message : command.text,
    text: command.text,
    createdAt: typeof command.createdAt === "string" ? command.createdAt : "",
  };
}

function normalizeManualVoiceCommands(settings: unknown): ManualAnnouncementVoiceCommand[] {
  if (!settings || typeof settings !== "object") return [];
  const source = settings as {
    manualVoiceEvents?: unknown;
    manualAnnouncementVoiceCommand?: unknown;
  };
  const events = Array.isArray(source.manualVoiceEvents)
    ? source.manualVoiceEvents.map(normalizeManualVoiceCommand).filter((event): event is ManualAnnouncementVoiceCommand => Boolean(event))
    : [];
  const single = normalizeManualVoiceCommand(source.manualAnnouncementVoiceCommand);
  const merged = single ? [...events, single] : events;
  const byId = new Map<string, ManualAnnouncementVoiceCommand>();
  for (const event of merged) byId.set(event.id, event);
  return Array.from(byId.values()).slice(-25);
}

function getManualVoiceText(command: ManualAnnouncementVoiceCommand) {
  const title = command.title?.trim();
  const message = (command.message ?? command.text).trim();
  return title ? `${title}. ${message}` : message;
}

const EMPTY_TV_DISPLAY: TvDisplayData = {
  nowServing: [],
  waitingForEvaluation: [],
  waitingForTagging: [],
  completed: [],
  announcements: [],
  totalWaiting: 0,
};

type AudioWindow = Window & typeof globalThis & {
  webkitAudioContext?: typeof AudioContext;
};

type TvDebugState = {
  app: "Loaded";
  api: "Loading" | "Connected" | "Unavailable";
  media: "Loading" | "Loaded" | "Unavailable";
  voice: "Supported" | "Unsupported";
  fullscreen: "Supported" | "Unsupported";
  browser: string;
  androidTv: boolean;
  compatibilityMode: boolean;
  renders: number;
  apiRequests: number;
  mediaRequests: number;
  settingsRequests: number;
  socketReconnects: number;
  activeIntervals: number;
  speechQueue: number;
  error?: string;
};

function readTvStorageFlag(key: string) {
  try {
    if (typeof window === "undefined" || !("localStorage" in window)) return false;
    return window.localStorage.getItem(key) === "true";
  } catch {
    return false;
  }
}

function writeTvStorageFlag(key: string, value: boolean) {
  try {
    if (typeof window === "undefined" || !("localStorage" in window)) return;
    window.localStorage.setItem(key, value ? "true" : "false");
  } catch {
    // Storage can be unavailable on locked-down TV browsers.
  }
}

function isSpeechSynthesisSupported() {
  try {
    return (
      typeof window !== "undefined" &&
      "speechSynthesis" in window &&
      typeof window.speechSynthesis?.speak === "function" &&
      typeof window.SpeechSynthesisUtterance === "function"
    );
  } catch {
    return false;
  }
}

function isFullscreenSupported() {
  try {
    return typeof document !== "undefined" && typeof document.documentElement?.requestFullscreen === "function";
  } catch {
    return false;
  }
}

function hasDocumentUserActivation() {
  try {
    if (typeof navigator === "undefined" || !("userActivation" in navigator)) return true;
    return navigator.userActivation.hasBeenActive;
  } catch {
    return true;
  }
}

function canPlayAudibleMedia() {
  return hasDocumentUserActivation();
}

function getTvBrowserLabel() {
  try {
    if (typeof window === "undefined") return "Unknown";
    return window.navigator?.userAgent || "Unknown";
  } catch {
    return "Unknown";
  }
}

function isAndroidTvBrowser() {
  const userAgent = getTvBrowserLabel();
  return /android/i.test(userAgent) && /chrome|chromium/i.test(userAgent);
}

function isTvAdminDebugMode() {
  try {
    if (typeof window === "undefined") return false;
    const params = new URLSearchParams(window.location.search);
    const enabledByUrl = params.get("tvAdminDebug") === "1";
    if (enabledByUrl) writeTvStorageFlag("tv-display-admin-debug", true);
    return enabledByUrl || readTvStorageFlag("tv-display-admin-debug");
  } catch {
    return false;
  }
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

async function fetchJsonWithTimeout<T>(url: string, timeoutMs = TV_REQUEST_TIMEOUT_MS, signal?: AbortSignal): Promise<T> {
  const controller = new AbortController();
  let timeoutId: number | undefined;

  const abortFromParent = () => controller.abort(signal?.reason);
  if (signal?.aborted) abortFromParent();
  signal?.addEventListener("abort", abortFromParent, { once: true });

  try {
    timeoutId = window.setTimeout(() => controller.abort(new DOMException("TV request timed out", "TimeoutError")), timeoutMs);
    const response = await fetch(url, { cache: "no-store", signal: controller.signal });
    if (!response.ok) throw new Error(`Failed to load ${url}`);
    return response.json() as Promise<T>;
  } finally {
    if (timeoutId !== undefined) window.clearTimeout(timeoutId);
    signal?.removeEventListener("abort", abortFromParent);
  }
}

class TvDisplayErrorBoundary extends React.Component<{ children: React.ReactNode; fallback?: React.ReactNode }, { error?: string }> {
  state: { error?: string } = {};

  static getDerivedStateFromError(error: unknown) {
    return { error: getErrorMessage(error) };
  }

  componentDidCatch(error: unknown) {
    console.error("TV Display render error", error);
  }

  render() {
    if (this.state.error) {
      if (this.props.fallback) return this.props.fallback;
      return (
        <div className="flex min-h-screen flex-col items-center justify-center bg-white p-8 text-center text-primary">
          <div className="text-4xl font-black uppercase tracking-widest">TV Display Safe Mode</div>
          <div className="mt-4 max-w-2xl text-lg text-gray-600">
            The display is running, but one TV feature failed to load. Refresh the page or check Admin TV diagnostics.
          </div>
          <div className="mt-6 max-w-3xl rounded border border-primary/20 bg-primary/5 p-4 text-left text-sm text-gray-700">
            {this.state.error}
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

function getAnnouncementId(item: TvQueueItem) {
  const calledAtTimestamp = item.calledAt ? String(new Date(item.calledAt).getTime()) : "0";
  return `${item.queueNumber}-${item.counterName}-${calledAtTimestamp}`;
}

function getSpeechLang() {
  return "en-US";
}

function getAnnouncementText(item: TvQueueItem) {
  return getQueueAnnouncementText(item);
}

function getMediaDisplayStyle(item: TvMediaItem): React.CSSProperties {
  const fitMode = item.fitMode ?? "cover";
  const horizontal = item.horizontalPosition ?? "center";
  const vertical = item.verticalPosition ?? "center";
  return {
    objectFit: fitMode === "fill" ? "fill" : fitMode === "center" ? "contain" : fitMode,
    objectPosition: `${horizontal} ${vertical}`,
    transform: `scale(${item.scale ?? 1})`,
    transformOrigin: `${horizontal} ${vertical}`,
  };
}

function getVideoVolumeLevel(item: TvMediaItem) {
  const volumeLevel = typeof item.volumeLevel === "number" ? item.volumeLevel : item.itemVolume;
  return Math.min(2, Math.max(0, typeof volumeLevel === "number" ? volumeLevel : 1));
}

function getVideoMuted(item: TvMediaItem) {
  return typeof item.muted === "boolean" ? item.muted : item.itemMuted === true;
}

export default function TvDisplay() {
  return (
    <TvDisplayErrorBoundary>
      <TvDisplayContent />
    </TvDisplayErrorBoundary>
  );
}

function TvDisplayContent() {
  const tvCompatibilityMode = React.useMemo(() => isAndroidTvBrowser(), []);
  const showDebugOverlay = React.useMemo(() => isTvAdminDebugMode(), []);
  const browserLabel = React.useMemo(() => getTvBrowserLabel(), []);
  const [mediaItems, setMediaItems] = useState<TvMediaItem[]>([]);
  const [activeMediaIndex, setActiveMediaIndex] = useState(0);
  const [audioActivated, setAudioActivated] = useState(() => readTvStorageFlag(TV_AUDIO_ACTIVATED_KEY));
  const [documentAudioUnlocked, setDocumentAudioUnlocked] = useState(() => canPlayAudibleMedia());
  const [audioUnlockVisible, setAudioUnlockVisible] = useState(false);
  const [fullscreenUnlockVisible, setFullscreenUnlockVisible] = useState(false);
  const [debugState, setDebugState] = useState<TvDebugState>(() => ({
    app: "Loaded",
    api: "Loading",
    media: "Loading",
    voice: isSpeechSynthesisSupported() ? "Supported" : "Unsupported",
    fullscreen: isFullscreenSupported() ? "Supported" : "Unsupported",
    browser: browserLabel,
    androidTv: tvCompatibilityMode,
    compatibilityMode: tvCompatibilityMode,
    renders: 0,
    apiRequests: 0,
    mediaRequests: 0,
    settingsRequests: 0,
    socketReconnects: 0,
    activeIntervals: 3,
    speechQueue: 0,
  }));
  const renderCountRef = React.useRef(0);
  const apiRequestCountRef = React.useRef(0);
  const mediaRequestCountRef = React.useRef(0);
  const settingsRequestCountRef = React.useRef(0);
  renderCountRef.current += 1;

  const { data: tvSettings } = useQuery({
    queryKey: ["tvSettings"],
    queryFn: async ({ signal }) => {
      settingsRequestCountRef.current += 1;
      setDebugState((current) => ({ ...current, settingsRequests: settingsRequestCountRef.current }));
      return fetchJsonWithTimeout<Record<string, any>>("/api/tv/settings", TV_REQUEST_TIMEOUT_MS, signal);
    },
    refetchOnWindowFocus: false,
    refetchInterval: tvCompatibilityMode ? 15000 : 5000,
    retry: 0,
    placeholderData: (previousData) => previousData,
  });

  const { data: tvMediaData, isError: tvMediaError } = useQuery<TvMediaItem[]>({
    queryKey: ["tvMedia"],
    queryFn: async ({ signal }) => {
      mediaRequestCountRef.current += 1;
      setDebugState((current) => ({ ...current, mediaRequests: mediaRequestCountRef.current }));
      return fetchJsonWithTimeout<TvMediaItem[]>("/api/tv/media", TV_REQUEST_TIMEOUT_MS, signal);
    },
    refetchOnWindowFocus: false,
    refetchInterval: tvCompatibilityMode ? 20000 : 5000,
    retry: 1,
    placeholderData: (previousData) => previousData,
  });

  const audioEnabled = tvSettings?.audioEnabled ?? true;
  const volume = typeof tvSettings?.volume === "number" ? tvSettings.volume : 1;
  const muted = tvSettings?.muted ?? true;
  const fullscreenEnabled = tvSettings?.fullscreenEnabled ?? false;
  const fullscreenRequestId = tvSettings?.fullscreenRequestId ?? 0;
  const voiceAnnouncementEnabled = tvSettings?.voiceAnnouncementEnabled ?? true;
  const notificationSoundEnabled = tvSettings?.notificationSoundEnabled ?? true;
  const announcementVolume = typeof tvSettings?.announcementVolume === "number" ? tvSettings.announcementVolume : 1;
  const announcementVoiceName = typeof tvSettings?.announcementVoiceName === "string" ? tvSettings.announcementVoiceName : "";
  const announcementVoiceId = typeof tvSettings?.announcementVoiceId === "string" ? tvSettings.announcementVoiceId : "";
  const announcementRate = typeof tvSettings?.announcementRate === "number" ? tvSettings.announcementRate : 1;
  const announcementPitch = typeof tvSettings?.announcementPitch === "number" ? tvSettings.announcementPitch : 1;
  const announcementChimeVolume = typeof tvSettings?.announcementChimeVolume === "number" ? tvSettings.announcementChimeVolume : 1;
  const announcementTwice = tvSettings?.announcementTwice ?? false;
  const voicePriorityBoost = tvSettings?.voicePriorityBoost ?? true;
  const effectiveVoicePriorityBoost = tvCompatibilityMode ? false : voicePriorityBoost;
  const autoPlay = tvSettings?.autoPlay ?? true;
  const mediaTransitionType = tvSettings?.mediaTransitionType === "slide" || tvSettings?.mediaTransitionType === "none" ? tvSettings.mediaTransitionType : "fade";
  const mediaTransitionDuration = typeof tvSettings?.mediaTransitionDuration === "number" ? tvSettings.mediaTransitionDuration : 0.8;
  const effectiveTransitionType = tvCompatibilityMode ? "none" : mediaTransitionType;
  const effectiveTransitionDuration = tvCompatibilityMode ? 0 : mediaTransitionDuration;
  const videoMuted = !audioActivated || !audioEnabled || muted || !documentAudioUnlocked;
  const enabledMediaItems = React.useMemo(
    () => mediaItems.filter((item) => item.enabled !== false).sort((a, b) => (a.order ?? 0) - (b.order ?? 0)),
    [mediaItems],
  );
  const canUnlockVideoAudio =
    !documentAudioUnlocked &&
    (
      (audioEnabled && !muted && enabledMediaItems.some((item) => item.type === "video" && !getVideoMuted(item))) ||
      voiceAnnouncementEnabled ||
      notificationSoundEnabled ||
      audioUnlockVisible
    );
  const canUnlockFullscreen = fullscreenUnlockVisible && fullscreenEnabled;
  const handlePlaybackBlocked = React.useCallback(() => {
    setAudioUnlockVisible(true);
  }, []);

  const { data: display, isLoading, isError: displayError } = useQuery({
    queryKey: getGetTvDisplayQueryKey(),
    queryFn: async ({ signal }) => {
      apiRequestCountRef.current += 1;
      setDebugState((current) => ({ ...current, apiRequests: apiRequestCountRef.current }));
      return fetchJsonWithTimeout<TvDisplayData>("/api/tv/display", TV_REQUEST_TIMEOUT_MS, signal);
    },
    refetchOnWindowFocus: false,
    refetchInterval: tvCompatibilityMode ? 5000 : 3000,
    retry: 0,
    placeholderData: (previous) => previous,
  });
  const displayData = display ?? EMPTY_TV_DISPLAY;
  const displayLunchBreakEnabled = (display as { lunchBreakEnabled?: boolean } | undefined)?.lunchBreakEnabled;
  const displayCutOffEnabled = (display as { cutOffEnabled?: boolean } | undefined)?.cutOffEnabled;
  const displaySettings = (display as { settings?: { lunchBreakEnabled?: boolean; cutOffEnabled?: boolean } } | undefined)?.settings;
  const manualVoiceEvents = React.useMemo(() => {
    const byId = new Map<string, ManualAnnouncementVoiceCommand>();
    for (const event of normalizeManualVoiceCommands(tvSettings)) byId.set(event.id, event);
    for (const event of normalizeManualVoiceCommands(displaySettings)) byId.set(event.id, event);
    return Array.from(byId.values()).slice(-25);
  }, [displaySettings, tvSettings]);
  const manualVoiceEventSignature = React.useMemo(() => manualVoiceEvents.map((event) => event.id).join("|"), [manualVoiceEvents]);
  const nowServingItems = React.useMemo(() => displayData.nowServing, [displayData.nowServing]);
  const waitingForEvaluationItems = React.useMemo(() => displayData.waitingForEvaluation, [displayData.waitingForEvaluation]);
  const waitingForTaggingItems = React.useMemo(() => displayData.waitingForTagging, [displayData.waitingForTagging]);
  const visibleAnnouncements = React.useMemo(() => displayData.announcements.slice(0, 3), [displayData.announcements]);
  const nowServingHasLunchBreak = React.useMemo(() => nowServingItems.some((item) => isLunchBreakStatus(item.status)), [nowServingItems]);
  const lunchBreakEnabled = Boolean(
    tvSettings?.lunchBreakEnabled ||
    displayLunchBreakEnabled ||
    displaySettings?.lunchBreakEnabled ||
    nowServingHasLunchBreak
  );
  const cutOffEnabled = Boolean(
    tvSettings?.cutOffEnabled ||
    displayCutOffEnabled ||
    displaySettings?.cutOffEnabled
  );

  const previousStatusesRef = React.useRef<Map<string, string>>(new Map());
  const announcedCallsRef = React.useRef<Set<string>>(new Set());
  const hasLoadedServingRef = React.useRef(false);
  const manualAnnouncementInitializedRef = React.useRef(false);
  const processedManualVoiceEventsRef = React.useRef<Set<string>>(new Set());
  const ignoredManualVoiceEventsLoggedRef = React.useRef<Set<string>>(new Set());
  const manualVoiceEventQueueRef = React.useRef<ManualAnnouncementVoiceCommand[]>([]);
  const announcementQueueRef = React.useRef<TvQueueItem[]>([]);
  const isAnnouncingRef = React.useRef(false);
  const [pendingSocketVoiceEvent, setPendingSocketVoiceEvent] = useState<unknown>(null);
  const [announcementDucked, setAnnouncementDucked] = useState(false);
  const audioContextRef = React.useRef<AudioContext | null>(null);
  const [speechVoices, setSpeechVoices] = useState<SpeechSynthesisVoice[]>([]);
  const selectedTvVoice = resolveAnnouncementVoice(speechVoices, announcementVoiceId, announcementVoiceName, false);
  const mediaAudioSettingsRef = React.useRef({ audioActivated, audioEnabled, muted, volume, documentAudioUnlocked });
  const duckedMediaAudioRef = React.useRef<Array<{ element: HTMLMediaElement; volume: number; muted: boolean }> | null>(null);
  const tvRealtimePrefixes = React.useMemo(() => ["/api/tv/display", "tvSettings"], []);
  const { reconnectCount: socketReconnectCount } = useQueueSocket(undefined, {
    compatibilityMode: tvCompatibilityMode,
    realtimePrefixes: tvRealtimePrefixes,
    onTvVoiceEvent: setPendingSocketVoiceEvent,
  }); // Realtime updates

  useEffect(() => {
    return () => {
      announcementQueueRef.current = [];
      isAnnouncingRef.current = false;
      try {
        if (isSpeechSynthesisSupported()) window.speechSynthesis.cancel();
      } catch {
        // best effort during TV page teardown
      }
      try {
        void audioContextRef.current?.close();
      } catch {
        // best effort during TV page teardown
      }
      audioContextRef.current = null;
    };
  }, []);

  useEffect(() => {
    setDebugState((current) => ({
      ...current,
      api: display ? "Connected" : displayError ? "Unavailable" : "Loading",
      renders: renderCountRef.current,
      socketReconnects: socketReconnectCount,
      speechQueue: announcementQueueRef.current.length,
    }));
  }, [display, displayError, socketReconnectCount]);

  useEffect(() => {
    mediaAudioSettingsRef.current = { audioActivated, audioEnabled, muted, volume, documentAudioUnlocked };
  }, [audioActivated, audioEnabled, muted, volume, documentAudioUnlocked]);

  useEffect(() => {
    if (documentAudioUnlocked) return;

    const markUnlocked = () => {
      if (!canPlayAudibleMedia()) return;
      setDocumentAudioUnlocked(true);
      setAudioUnlockVisible(false);
    };

    window.addEventListener("pointerdown", markUnlocked, { passive: true });
    window.addEventListener("keydown", markUnlocked);
    window.addEventListener("touchstart", markUnlocked, { passive: true });
    markUnlocked();

    return () => {
      window.removeEventListener("pointerdown", markUnlocked);
      window.removeEventListener("keydown", markUnlocked);
      window.removeEventListener("touchstart", markUnlocked);
    };
  }, [documentAudioUnlocked]);

  useEffect(() => {
    if (!isSpeechSynthesisSupported()) {
      setDebugState((current) => ({ ...current, voice: "Unsupported" }));
      return;
    }

    const reportVoices = async () => {
      try {
        const voices = getEnglishUsVoices(window.speechSynthesis.getVoices());
        setSpeechVoices(voices);
        setDebugState((current) => ({ ...current, voice: "Supported" }));
      } catch (error) {
        console.warn("TV voice detection failed", error);
        setDebugState((current) => ({ ...current, voice: "Unsupported", error: getErrorMessage(error) }));
      }
    };

    reportVoices();
    const previousVoicesChangedHandler = window.speechSynthesis.onvoiceschanged;
    try {
      window.speechSynthesis.onvoiceschanged = reportVoices;
    } catch (error) {
      console.warn("TV voice change listener failed", error);
    }
    return () => {
      try {
        if (window.speechSynthesis.onvoiceschanged === reportVoices) {
          window.speechSynthesis.onvoiceschanged = previousVoicesChangedHandler;
        }
      } catch {
        // best effort
      }
    };
  }, []);

  const fadeMediaVolume = React.useCallback((element: HTMLMediaElement, targetVolume: number, duration = 260) => {
    return new Promise<void>((resolve) => {
      if (typeof window === "undefined" || typeof window.requestAnimationFrame !== "function") {
        try {
          element.volume = targetVolume;
        } catch {
          // best effort
        }
        resolve();
        return;
      }

      const startVolume = element.volume;
      const startTime = performance.now();
      let timeoutId: number;

      const finish = () => {
        try {
          element.volume = Math.min(1, Math.max(0, targetVolume));
        } catch {
          // best effort
        }
        window.clearTimeout(timeoutId);
        resolve();
      };

      // Fallback in case requestAnimationFrame is paused (e.g. background tab)
      timeoutId = window.setTimeout(finish, duration + 50);

      const step = (now: number) => {
        const elapsed = now - startTime;
        const progress = Math.min(1, Math.max(0, elapsed / duration));
        try {
          element.volume = Math.min(1, Math.max(0, startVolume + (targetVolume - startVolume) * progress));
        } catch {
          finish();
          return;
        }
        if (progress < 1) {
          window.requestAnimationFrame(step);
          return;
        }
        finish();
      };

      window.requestAnimationFrame(step);
    });
  }, []);

  const duckMediaAudio = React.useCallback(async () => {
    if (duckedMediaAudioRef.current) return;
    if (typeof document === "undefined" || typeof HTMLMediaElement === "undefined") return;
    const mediaElements = Array.from(document.querySelectorAll("video, audio")).filter((el): el is HTMLMediaElement => el instanceof HTMLMediaElement);
    if (mediaElements.length === 0) return;

    duckedMediaAudioRef.current = mediaElements.map((element) => ({
      element,
      volume: element.volume,
      muted: element.muted,
    }));

    await Promise.all(
      duckedMediaAudioRef.current.map(async ({ element }) => {
        try {
          element.muted = true;
          if (element.volume > 0) {
            await fadeMediaVolume(element, 0, 180);
          }
        } catch (error) {
          console.warn("TV media duck failed", error);
        }
      }),
    );
  }, [fadeMediaVolume]);

  const restoreMediaAudio = React.useCallback(async () => {
    const ducked = duckedMediaAudioRef.current;
    if (!ducked) return;
    duckedMediaAudioRef.current = null;

    const {
      audioActivated: latestAudioActivated,
      audioEnabled: latestAudioEnabled,
      muted: latestMuted,
      documentAudioUnlocked: latestDocumentAudioUnlocked,
    } = mediaAudioSettingsRef.current;
    const shouldRemainMuted = !latestAudioActivated || !latestAudioEnabled || latestMuted || !latestDocumentAudioUnlocked;

    await Promise.all(
      ducked.map(async ({ element, volume, muted }) => {
        try {
          element.volume = shouldRemainMuted ? volume : 0;
          element.muted = shouldRemainMuted || muted;
          if (!shouldRemainMuted && !muted) {
            await fadeMediaVolume(element, volume, 360);
          }
        } catch (error) {
          console.warn("TV media restore failed", error);
        }
      }),
    );
  }, [fadeMediaVolume]);

  const getAudioContext = React.useCallback(() => {
    try {
      if (typeof window === "undefined") return null;
      const audioWindow = window as AudioWindow;
      const AudioContextConstructor = audioWindow.AudioContext || audioWindow.webkitAudioContext;
      if (!AudioContextConstructor) return null;
      if (!audioContextRef.current) audioContextRef.current = new AudioContextConstructor();
      return audioContextRef.current;
    } catch (error) {
      console.warn("TV audio context unavailable", error);
      setDebugState((current) => ({ ...current, error: getErrorMessage(error) }));
      return null;
    }
  }, []);

  const unlockTvAudio = React.useCallback(async () => {
    setAudioActivated(true);
    setDocumentAudioUnlocked(true);
    setAudioUnlockVisible(false);
    writeTvStorageFlag(TV_AUDIO_ACTIVATED_KEY, true);

    try {
      await getAudioContext()?.resume();
    } catch (error) {
      console.warn("TV audio unlock failed", error);
      setDebugState((current) => ({ ...current, error: getErrorMessage(error) }));
    }

    const video = document.querySelector<HTMLVideoElement>('video[data-tv-media-video="true"]');
    if (!video) return;

    try {
      video.muted = false;
      video.volume = Math.min(1, Math.max(0, volume));
      await video.play();
    } catch (error) {
      setAudioUnlockVisible(true);
      setDebugState((current) => ({ ...current, error: getErrorMessage(error) }));
    }
  }, [getAudioContext, volume]);

  useEffect(() => {
    if (!(audioEnabled || voiceAnnouncementEnabled || notificationSoundEnabled)) return;
    if (audioActivated) return;
    setAudioActivated(true);
    writeTvStorageFlag(TV_AUDIO_ACTIVATED_KEY, true);
    try {
      void getAudioContext()?.resume();
    } catch (error) {
      console.warn("TV automatic audio initialization failed", error);
    }
  }, [audioActivated, audioEnabled, getAudioContext, notificationSoundEnabled, voiceAnnouncementEnabled]);

  const requestTvFullscreen = React.useCallback(async (showUnlockOnFailure = true) => {
    if (!isFullscreenSupported()) {
      setDebugState((current) => ({ ...current, fullscreen: "Unsupported" }));
      return;
    }
    if (typeof navigator !== "undefined" && navigator.userActivation && !navigator.userActivation.hasBeenActive) {
      if (showUnlockOnFailure) setFullscreenUnlockVisible(true);
      return;
    }
    try {
      await document.documentElement.requestFullscreen();
      setFullscreenUnlockVisible(false);
      setDebugState((current) => ({ ...current, fullscreen: "Supported" }));
      writeTvStorageFlag(TV_FULLSCREEN_ACTIVATED_KEY, true);
    } catch (error) {
      if (showUnlockOnFailure) setFullscreenUnlockVisible(true);
      setDebugState((current) => ({ ...current, error: getErrorMessage(error) }));
    }
  }, []);

  const exitTvFullscreen = React.useCallback(async () => {
    if (typeof document === "undefined" || !document.fullscreenElement || typeof document.exitFullscreen !== "function") return;
    try {
      await document.exitFullscreen();
    } catch (error) {
      setDebugState((current) => ({ ...current, error: getErrorMessage(error) }));
    }
  }, []);

  useEffect(() => {
    if (fullscreenEnabled) {
      // User must explicitly click Unlock Fullscreen to satisfy browser gestures
      return;
    }

    setFullscreenUnlockVisible(false);
    void exitTvFullscreen();
  }, [fullscreenEnabled, exitTvFullscreen]);

  useEffect(() => {
    if (tvMediaData) {
      setMediaItems(tvMediaData);
      setDebugState((current) => ({ ...current, media: "Loaded" }));
      return;
    }
    if (tvMediaError) {
      setDebugState((current) => ({ ...current, media: "Unavailable" }));
    }
  }, [tvMediaData, tvMediaError]);

  const playNotificationSound = React.useCallback(async () => {
    if (!audioActivated || !notificationSoundEnabled || announcementChimeVolume <= 0) return;
    const context = getAudioContext();
    if (!context) return;
    try {
      if (context.state === "suspended") {
        await Promise.race([
          context.resume(),
          new Promise((_, reject) => window.setTimeout(() => reject(new Error("resume_timeout")), 200)),
        ]);
      }
    } catch (error) {
      console.warn("TV notification audio unavailable", error);
      return;
    }

    const playTone = (frequency: number, start: number, duration: number) => {
      try {
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        oscillator.type = "sine";
        oscillator.frequency.setValueAtTime(frequency, start);
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, announcementChimeVolume * 0.8), start + 0.03);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
        oscillator.connect(gain);
        gain.connect(context.destination);
        oscillator.start(start);
        oscillator.stop(start + duration + 0.02);
      } catch (error) {
        console.warn("TV notification tone failed", error);
        setDebugState((current) => ({ ...current, error: getErrorMessage(error) }));
      }
    };

    const now = context.currentTime;
    playTone(784, now, 0.32);
    playTone(659, now + 0.38, 0.42);
    await new Promise((resolve) => window.setTimeout(resolve, 900));
  }, [announcementChimeVolume, audioActivated, getAudioContext, notificationSoundEnabled]);

  const speakAnnouncementText = React.useCallback((text: string, label = "Manual announcement") => {
    if (!audioActivated || announcementVolume <= 0 || !isSpeechSynthesisSupported()) {
      console.log("[TV] Speech Error", {
        label,
        reason: !audioActivated ? "audio_not_activated" : announcementVolume <= 0 ? "volume_zero" : "speech_synthesis_unsupported",
      });
      return Promise.resolve();
    }

    const spokenText = text.trim();
    if (!spokenText) return Promise.resolve();

    return new Promise<void>((resolve) => {
      try {
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(spokenText);
        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          window.clearTimeout(timeoutId);
          resolve();
        };
        const timeoutId = window.setTimeout(() => {
          try {
            window.speechSynthesis.cancel();
          } catch {
            // best effort on TV browsers
          }
          finish();
        }, 12000);
        utterance.lang = getSpeechLang();
        if (selectedTvVoice) utterance.voice = selectedTvVoice;
        utterance.volume = announcementVolume;
        utterance.rate = announcementRate;
        utterance.pitch = announcementPitch;
        console.log("[TV] Speech Object Created", {
          label,
          lang: utterance.lang,
          volume: utterance.volume,
          rate: utterance.rate,
          pitch: utterance.pitch,
          voice: selectedTvVoice?.name ?? null,
        });
        utterance.onstart = () => {
          console.log("[TV] Speech Started", { label });
        };
        utterance.onend = () => {
          console.log("[TV] Speech Ended", { label });
          finish();
        };
        utterance.onerror = (event) => {
          console.warn("[TV] Speech Error", { label, error: event.error });
          finish();
        };
        window.speechSynthesis.speak(utterance);
      } catch (error) {
        console.warn("TV announcement speech failed", error);
        setDebugState((current) => ({ ...current, voice: "Unsupported", error: getErrorMessage(error) }));
        resolve();
      }
    });
  }, [announcementPitch, announcementRate, announcementVolume, audioActivated, selectedTvVoice]);

  const speakAnnouncement = React.useCallback((item: TvQueueItem) => {
    if (!voiceAnnouncementEnabled) return Promise.resolve();
    return speakAnnouncementText(getAnnouncementText(item), item.queueNumber);
  }, [speakAnnouncementText, voiceAnnouncementEnabled]);

  const processAnnouncementQueue = React.useCallback(async () => {
    if (isAnnouncingRef.current) return;
    if (announcementQueueRef.current.length === 0) return;
    if (!audioActivated || !documentAudioUnlocked) {
      setAudioUnlockVisible(true);
      setDebugState((current) => ({
        ...current,
        speechQueue: announcementQueueRef.current.length + manualVoiceEventQueueRef.current.length,
        error: "TV audio must be enabled before queue voice playback can start.",
      }));
      return;
    }
    isAnnouncingRef.current = true;
    setAnnouncementDucked(effectiveVoicePriorityBoost);

    try {
      if (effectiveVoicePriorityBoost) {
        await duckMediaAudio();
      }

      while (announcementQueueRef.current.length > 0) {
        const next = announcementQueueRef.current.shift();
        if (!next) continue;
        console.log("Announcement Queue Length", announcementQueueRef.current.length);
        setDebugState((current) => ({ ...current, speechQueue: announcementQueueRef.current.length }));

        const repeatCount = announcementTwice ? 2 : 1;
        for (let pass = 0; pass < repeatCount; pass += 1) {
          if (pass > 0) {
            console.log("Announcement Repeat Triggered", { queueNumber: next.queueNumber });
            await new Promise((resolve) => window.setTimeout(resolve, 1500));
          }

          await playNotificationSound();
          await new Promise((resolve) => window.setTimeout(resolve, 200));
          await speakAnnouncement(next);
        }
      }
    } catch (error) {
      console.warn("TV announcement queue failed", error);
      setDebugState((current) => ({ ...current, error: getErrorMessage(error) }));
    } finally {
      if (effectiveVoicePriorityBoost) {
        await restoreMediaAudio();
      }
      setAnnouncementDucked(false);
      isAnnouncingRef.current = false;
      setDebugState((current) => ({ ...current, speechQueue: announcementQueueRef.current.length }));
      if (announcementQueueRef.current.length > 0) {
        window.setTimeout(() => void processAnnouncementQueue(), 0);
      }
    }
  }, [announcementTwice, audioActivated, documentAudioUnlocked, duckMediaAudio, effectiveVoicePriorityBoost, playNotificationSound, restoreMediaAudio, speakAnnouncement]);

  const processManualVoiceEventQueue = React.useCallback(async () => {
    if (isAnnouncingRef.current) {
      window.setTimeout(() => void processManualVoiceEventQueue(), 250);
      return;
    }
    if (manualVoiceEventQueueRef.current.length === 0) return;
    if (!audioActivated || !documentAudioUnlocked) {
      setAudioUnlockVisible(true);
      setDebugState((current) => ({
        ...current,
        speechQueue: announcementQueueRef.current.length + manualVoiceEventQueueRef.current.length,
        error: "TV audio must be enabled before voice playback can start.",
      }));
      return;
    }
    isAnnouncingRef.current = true;
    setAnnouncementDucked(effectiveVoicePriorityBoost);

    try {
      if (effectiveVoicePriorityBoost) {
        await duckMediaAudio();
      }

      while (manualVoiceEventQueueRef.current.length > 0) {
        const command = manualVoiceEventQueueRef.current.shift();
        if (!command) continue;
        const speechText = getManualVoiceText(command);
        if (!speechText) continue;
        console.log("[TV] Processing speak event", {
          eventId: command.id,
          announcementId: command.announcementId,
          type: command.type,
        });
        console.log("[TV] Speech started", {
          eventId: command.id,
          announcementId: command.announcementId,
          type: command.type,
        });
        await playNotificationSound();
        await new Promise((resolve) => window.setTimeout(resolve, 200));
        await speakAnnouncementText(speechText, `manual-${command.id}`);
        console.log("[TV] Speech ended", {
          eventId: command.id,
          announcementId: command.announcementId,
          type: command.type,
        });
      }
    } catch (error) {
      console.warn("TV manual announcement failed", error);
      setDebugState((current) => ({ ...current, error: getErrorMessage(error) }));
    } finally {
      if (effectiveVoicePriorityBoost) {
        await restoreMediaAudio();
      }
      setAnnouncementDucked(false);
      isAnnouncingRef.current = false;
      console.log("[TV] No reload triggered");
      if (announcementQueueRef.current.length > 0) {
        window.setTimeout(() => void processAnnouncementQueue(), 0);
      }
    }
  }, [audioActivated, documentAudioUnlocked, duckMediaAudio, effectiveVoicePriorityBoost, playNotificationSound, processAnnouncementQueue, restoreMediaAudio, speakAnnouncementText]);

  useEffect(() => {
    if (!audioActivated || !documentAudioUnlocked) return;
    if (announcementQueueRef.current.length > 0) {
      void processAnnouncementQueue();
      return;
    }
    if (manualVoiceEventQueueRef.current.length === 0) return;
    void processManualVoiceEventQueue();
  }, [audioActivated, documentAudioUnlocked, processAnnouncementQueue, processManualVoiceEventQueue]);

  const enqueueManualVoiceEvent = React.useCallback((event: ManualAnnouncementVoiceCommand, source: "socket" | "settings") => {
    const speechText = getManualVoiceText(event);
    if (!speechText) return false;

    console.log("[TV] Speak event received", { source });
    console.log("[TV] Event ID", event.id);
    console.log("[TV] Announcement ID", event.announcementId ?? null);

    if (processedManualVoiceEventsRef.current.has(event.id)) {
      if (!ignoredManualVoiceEventsLoggedRef.current.has(event.id)) {
        ignoredManualVoiceEventsLoggedRef.current.add(event.id);
        console.log("[TV] Duplicate exact event ignored", { eventId: event.id });
      }
      return false;
    }

    processedManualVoiceEventsRef.current.add(event.id);
    manualVoiceEventQueueRef.current.push(event);
    console.log("[TV] Voice event queued", {
      eventId: event.id,
      announcementId: event.announcementId,
      source,
    });
    setDebugState((current) => ({
      ...current,
      speechQueue: announcementQueueRef.current.length + manualVoiceEventQueueRef.current.length,
    }));
    void processManualVoiceEventQueue();
    return true;
  }, [processManualVoiceEventQueue]);

  useEffect(() => {
    if (!pendingSocketVoiceEvent) return;
    const event = normalizeManualVoiceCommand(pendingSocketVoiceEvent);
    if (event) enqueueManualVoiceEvent(event, "socket");
    setPendingSocketVoiceEvent(null);
  }, [enqueueManualVoiceEvent, pendingSocketVoiceEvent]);

  useEffect(() => {
    if (!tvSettings && !display?.settings) return;

    if (!manualAnnouncementInitializedRef.current) {
      manualAnnouncementInitializedRef.current = true;
      for (const event of manualVoiceEvents) {
        processedManualVoiceEventsRef.current.add(event.id);
      }
      return;
    }

    for (const event of manualVoiceEvents) {
      enqueueManualVoiceEvent(event, "settings");
    }

    // Cap the memory of processed manual voice events to prevent unbounded growth
    if (processedManualVoiceEventsRef.current.size > 100) {
      const entries = Array.from(processedManualVoiceEventsRef.current);
      processedManualVoiceEventsRef.current = new Set(entries.slice(entries.length - 100));
    }

    if (ignoredManualVoiceEventsLoggedRef.current.size > 100) {
      const entries = Array.from(ignoredManualVoiceEventsLoggedRef.current);
      ignoredManualVoiceEventsLoggedRef.current = new Set(entries.slice(entries.length - 100));
    }
  }, [display?.settings, enqueueManualVoiceEvent, manualVoiceEventSignature, manualVoiceEvents, tvSettings]);

  useEffect(() => {
    const nowServing = (display?.nowServing ?? []) as TvQueueItem[];
    const nextStatuses = new Map<string, string>();

    for (const item of nowServing) {
      const id = getAnnouncementId(item);
      nextStatuses.set(id, item.status);

      if (!hasLoadedServingRef.current) continue;
      if (item.status !== "called" && item.status !== "in_progress") continue;
      if (previousStatusesRef.current.get(id) === item.status && !item.calledAt) continue;
      if (announcedCallsRef.current.has(id)) continue;

      announcedCallsRef.current.add(id);
      if (voiceAnnouncementEnabled || notificationSoundEnabled) {
        announcementQueueRef.current.push(item);
        console.log("Announcement Queue Length", announcementQueueRef.current.length);
        setDebugState((current) => ({ ...current, speechQueue: announcementQueueRef.current.length }));
      }
    }

    if (!hasLoadedServingRef.current) {
      for (const item of nowServing) {
        if (item.status === "called" || item.status === "in_progress") announcedCallsRef.current.add(getAnnouncementId(item));
      }
      hasLoadedServingRef.current = true;
    }

    previousStatusesRef.current = nextStatuses;
    void processAnnouncementQueue();
  }, [display?.nowServing, notificationSoundEnabled, processAnnouncementQueue, voiceAnnouncementEnabled]);

  useEffect(() => {
    if (!autoPlay || enabledMediaItems.length === 0) return;
    if (activeMediaIndex >= enabledMediaItems.length) {
      setActiveMediaIndex(0);
      return;
    }

    const activeItem = enabledMediaItems.at(activeMediaIndex);
    if (activeItem?.type !== "image") return;

    const timer = window.setTimeout(() => {
      setActiveMediaIndex((index) => (index + 1) % enabledMediaItems.length);
    }, 18000);

    return () => window.clearTimeout(timer);
  }, [autoPlay, enabledMediaItems, activeMediaIndex]);

  if (isLoading && !display && !displayError) {
    return <div className="min-h-screen bg-background flex items-center justify-center text-primary animate-pulse text-2xl font-light tracking-widest">LOADING SYSTEM</div>;
  }

  return (
    <div 
      className="min-h-screen w-full text-foreground overflow-hidden flex flex-col p-8 relative"
      style={{ background: "linear-gradient(170deg, #ffffff 0%, #fdf7f8 40%, #f9eef1 100%)" }}
    >
      <div className="absolute top-0 right-0 w-200 h-200 bg-primary/5 rounded-full blur-[150px] pointer-events-none" />
      <div className="absolute bottom-0 left-0 w-150 h-150 bg-primary/5 rounded-full blur-[120px] pointer-events-none" />

      <header className="flex justify-between items-end border-b border-black/10 pb-6 mb-8 z-10">
        <div className="flex items-end gap-5">
          <CcsLogo size="large" className="object-contain" />
          <div>
            <h1 className="text-5xl font-bold tracking-tight text-foreground drop-shadow-sm">NOW SERVING</h1>
            <p className="text-xl text-primary mt-2 font-medium tracking-widest">COLLEGE OF COMPUTER STUDIES</p>
          </div>
        </div>
        <div className="flex items-center gap-8 text-right">
          <div className="flex flex-col items-end justify-center pr-8 border-r border-black/10">
            <div className="text-sm text-gray-500 uppercase tracking-widest font-semibold mb-1">Total Waiting</div>
            <div className="text-4xl font-black text-primary">{displayData.totalWaiting}</div>
          </div>
          <div className="text-right">
            <div className="text-6xl font-light text-foreground">{new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</div>
            <div className="text-gray-500 text-lg uppercase tracking-widest">{new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</div>
          </div>
        </div>
      </header>

      <main className="flex-1 flex flex-col gap-8 z-10">
        <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-[clamp(0.75rem,1vw,1.5rem)] content-start">
          <AnimatePresence>
            {cutOffEnabled ? (
              <motion.div
                key="cut-off"
                initial={{ opacity: 0, scale: 0.96 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.96 }}
                transition={{ duration: 0.35 }}
                className="col-span-full flex min-h-[clamp(11rem,12vw,15rem)] items-center justify-center rounded-2xl border border-primary/20 bg-white/55 shadow-sm backdrop-blur-xl"
              >
                <div className="text-center font-black uppercase tracking-widest text-primary" style={{ fontSize: "clamp(3.5rem, 7vw, 8rem)" }}>
                  CUT OFF
                </div>
              </motion.div>
            ) : lunchBreakEnabled ? (
              <motion.div
                key="lunch-break"
                initial={{ opacity: 0, scale: 0.96 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.96 }}
                transition={{ duration: 0.35 }}
                className="col-span-full flex min-h-[clamp(11rem,12vw,15rem)] items-center justify-center rounded-2xl border border-primary/20 bg-white/55 shadow-sm backdrop-blur-xl"
              >
                <div className="text-center font-black uppercase tracking-widest text-primary" style={{ fontSize: "clamp(3.5rem, 7vw, 8rem)" }}>
                  LUNCH BREAK
                </div>
              </motion.div>
            ) : nowServingItems.map((item, index) => (
              <motion.div
                key={`${item.queueNumber}-${item.status}`}
                initial={{ opacity: 0, scale: 0.9, x: -50 }}
                animate={{ opacity: 1, scale: 1, x: 0 }}
                exit={{ opacity: 0, scale: 0.9 }}
                transition={{ duration: 0.5, delay: index * 0.1 }}
                className="w-full"
              >
                <Card className={`glass-card border-l-4 overflow-hidden ${item.status === 'called' ? 'border-l-primary glow-maroon' : 'border-l-black/10'}`}>
                  <CardContent className="flex min-h-[clamp(8.5rem,8vw,11rem)] flex-col p-[clamp(0.85rem,0.95vw,1.25rem)]">
                    <div className="mb-2 flex justify-between items-center gap-2">
                      <span className={`uppercase tracking-widest font-semibold ${getStatusTextClass(item.status)}`} style={{ fontSize: "clamp(0.72rem, 0.5vw + 0.32rem, 0.95rem)" }}>{getDisplayStatusLabel(item.status)}</span>
                      <span className="font-semibold bg-black/5 rounded text-gray-700 uppercase" style={{ fontSize: "clamp(0.62rem, 0.35vw + 0.28rem, 0.8rem)", padding: "clamp(0.15rem,0.2vw,0.25rem) clamp(0.35rem,0.35vw,0.5rem)" }}>{item.counterType}</span>
                    </div>
                    <div className="my-[clamp(0.35rem,0.65vw,0.75rem)] font-black text-foreground leading-none text-center" style={{ fontSize: "clamp(2.35rem, 2.6vw, 3.65rem)" }}>{item.queueNumber}</div>
                    {item.studentName && (
                      <div className="font-bold text-foreground leading-tight text-center line-clamp-2 wrap-break-word" style={{ fontSize: "clamp(1rem, 0.85vw, 1.45rem)" }}>
                        {item.studentName}
                      </div>
                    )}
                    <div className="mt-auto flex justify-end border-t border-black/10 pt-[clamp(0.55rem,0.55vw,0.9rem)]">
                      <div className="max-w-full truncate text-right font-semibold text-primary" style={{ fontSize: "clamp(0.9rem, 0.75vw, 1.3rem)" }}>
                        {item.counterName}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
            {!cutOffEnabled && !lunchBreakEnabled && nowServingItems.length === 0 && (
              <div className="col-span-full text-center text-gray-500 py-12 text-2xl font-light tracking-widest">
                NO STUDENTS CURRENTLY SERVING
              </div>
            )}
          </AnimatePresence>
        </section>

        <section className="flex-1 grid grid-cols-12 gap-8 min-h-0">
          <div className="col-span-8 min-h-0">
            <TvDisplayErrorBoundary fallback={<TvMediaFallback totalWaiting={displayData.totalWaiting} />}>
              <TvMediaShowcase
                items={enabledMediaItems}
                activeIndex={activeMediaIndex}
                totalWaiting={displayData.totalWaiting}
                muted={videoMuted}
                volume={volume}
                announcementDucked={announcementDucked}
                audioActivated={audioActivated}
                autoPlay={autoPlay}
                videoEnhancementsEnabled={!tvCompatibilityMode}
                transitionType={effectiveTransitionType}
                transitionDuration={effectiveTransitionDuration}
                onPlaybackBlocked={handlePlaybackBlocked}
                onAdvance={() => setActiveMediaIndex((index) => (index + 1) % enabledMediaItems.length)}
              />
            </TvDisplayErrorBoundary>
          </div>

          <div className="col-span-4 flex flex-col space-y-[clamp(0.9rem,1.4vw,2rem)] border-l border-black/10 pl-[clamp(1rem,2vw,2.5rem)] min-h-0">
          <div className="glass-card p-[clamp(1rem,1.6vw,2.25rem)] rounded-2xl border border-black/5 shadow-sm bg-white/40">
            <h3 className="text-gray-500 uppercase tracking-widest mb-[clamp(0.75rem,1vw,1.5rem)] font-semibold flex justify-between gap-4" style={{ fontSize: "clamp(0.85rem, 0.75vw + 0.35rem, 1.45rem)" }}>
              <span>Waiting for Evaluation</span>
              <span className="text-primary" style={{ fontSize: "clamp(1rem, 0.9vw + 0.4rem, 1.75rem)" }}>{waitingForEvaluationItems.length}</span>
            </h3>
            <div className="flex flex-wrap gap-[clamp(0.4rem,0.55vw,0.9rem)] max-h-[clamp(6rem,10vh,12rem)] overflow-hidden">
              {waitingForEvaluationItems.length > 0 ? waitingForEvaluationItems.map((item) => (
                <div key={item.queueNumber} className="bg-black/5 rounded-lg text-foreground font-bold" style={{ fontSize: "clamp(1rem, 0.9vw + 0.45rem, 1.8rem)", padding: "clamp(0.35rem, 0.45vw, 0.75rem) clamp(0.65rem, 0.8vw, 1.15rem)" }}>{item.queueNumber}</div>
              )) : <span className="text-gray-400" style={{ fontSize: "clamp(0.95rem, 0.65vw + 0.45rem, 1.45rem)" }}>None</span>}
            </div>
          </div>

          {/* Waiting for Tagging */}
          <div className="glass-card p-[clamp(1rem,1.6vw,2.25rem)] rounded-2xl border border-black/5 shadow-sm bg-white/40">
            <h3 className="text-gray-500 uppercase tracking-widest mb-[clamp(0.75rem,1vw,1.5rem)] font-semibold flex justify-between gap-4" style={{ fontSize: "clamp(0.85rem, 0.75vw + 0.35rem, 1.45rem)" }}>
              <span>Waiting for Tagging</span>
              <span className="text-primary" style={{ fontSize: "clamp(1rem, 0.9vw + 0.4rem, 1.75rem)" }}>{waitingForTaggingItems.length}</span>
            </h3>
            <div className="flex flex-wrap gap-[clamp(0.4rem,0.55vw,0.9rem)] max-h-[clamp(6rem,10vh,12rem)] overflow-hidden">
              {waitingForTaggingItems.length > 0 ? waitingForTaggingItems.map((item) => (
                <div key={item.queueNumber} className="bg-black/5 rounded-lg text-foreground font-bold" style={{ fontSize: "clamp(1rem, 0.9vw + 0.45rem, 1.8rem)", padding: "clamp(0.35rem, 0.45vw, 0.75rem) clamp(0.65rem, 0.8vw, 1.15rem)" }}>{item.queueNumber}</div>
              )) : <span className="text-gray-400" style={{ fontSize: "clamp(0.95rem, 0.65vw + 0.45rem, 1.45rem)" }}>None</span>}
            </div>
          </div>

          {/* Announcements */}
          {visibleAnnouncements.length > 0 && (
            <div className="flex-1 glass-card p-[clamp(1.1rem,1.8vw,2.5rem)] rounded-2xl border border-black/5 flex flex-col shadow-sm bg-white/40 min-h-[clamp(12rem,24vh,22rem)]">
              <h3 className="text-primary uppercase tracking-widest mb-[clamp(0.9rem,1.2vw,1.75rem)] font-semibold" style={{ fontSize: "clamp(1.1rem, 1vw + 0.5rem, 2rem)" }}>
                Announcements
              </h3>
              <div className="flex-1 space-y-[clamp(0.75rem,1vw,1.5rem)] overflow-hidden">
                <AnimatePresence>
                  {visibleAnnouncements.map((announcement, i) => (
                    <motion.div
                      key={i}
                      initial={{ opacity: 0, x: 10 }}
                      animate={{ opacity: 1, x: 0 }}
                      className="font-medium leading-relaxed text-gray-700 border-b border-black/5 last:border-0"
                      style={{ fontSize: "clamp(1.15rem, 1.05vw + 0.55rem, 2.25rem)", paddingBottom: "clamp(0.9rem,1.2vw,1.8rem)" }}
                    >
                      {announcement}
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
            </div>
          )}
          </div>
        </section>
      </main>

      {(canUnlockVideoAudio || canUnlockFullscreen) && (
        <div className="fixed bottom-6 left-1/2 z-50 flex -translate-x-1/2 flex-col items-center gap-3">
          {canUnlockFullscreen && (
            <button
              type="button"
              onClick={() => void requestTvFullscreen(true)}
              className="rounded-md bg-black/85 px-6 py-3 text-lg font-semibold text-white shadow-2xl ring-1 ring-white/20 backdrop-blur transition hover:bg-black focus:outline-none focus:ring-2 focus:ring-white"
            >
              Enable Full Screen
            </button>
          )}
          {canUnlockVideoAudio && (
            <button
              type="button"
              onClick={unlockTvAudio}
              className="rounded-md bg-black/85 px-6 py-3 text-lg font-semibold text-white shadow-2xl ring-1 ring-white/20 backdrop-blur transition hover:bg-black focus:outline-none focus:ring-2 focus:ring-white"
            >
              Enable TV Audio
            </button>
          )}
        </div>
      )}

      {showDebugOverlay && (
        <TvDebugOverlay debugState={debugState} />
      )}

      {displayError && !display && (
        <div className="fixed left-4 bottom-4 z-20 rounded bg-white/80 px-3 py-2 text-sm font-semibold text-red-700 shadow-sm backdrop-blur-sm">
          TV data connection issue. Showing fallback display.
        </div>
      )}

      <div className="fixed bottom-3 right-4 z-20 rounded bg-white/55 px-2 py-1 text-[15px] font-medium tracking-wide text-gray-500/80 shadow-sm backdrop-blur-sm pointer-events-none">
        Developed by Luiese Amstrong
      </div>
    </div>
  );
}

function TvDebugOverlay({ debugState }: { debugState: TvDebugState }) {
  return (
    <div className="fixed bottom-12 left-4 z-30 max-w-88 rounded border border-black/10 bg-white/85 p-3 text-left text-xs font-medium text-gray-700 shadow-sm backdrop-blur">
      <div className="mb-1 font-bold uppercase tracking-widest text-primary">TV Debug</div>
      <div className="wrap-break-word">Browser: {debugState.browser}</div>
      <div>Android TV detected: {debugState.androidTv ? "Yes" : "No"}</div>
      <div>Compatibility mode: {debugState.compatibilityMode ? "On" : "Off"}</div>
      <div>App loaded: {debugState.app}</div>
      <div>API: {debugState.api}</div>
      <div>Media: {debugState.media}</div>
      <div>Voice: {debugState.voice}</div>
      <div>Fullscreen: {debugState.fullscreen}</div>
      <div>Render count: {debugState.renders}</div>
      <div>API requests: {debugState.apiRequests}</div>
      <div>Media requests: {debugState.mediaRequests}</div>
      <div>Settings requests: {debugState.settingsRequests}</div>
      <div>Socket reconnects: {debugState.socketReconnects}</div>
      <div>Active intervals: {debugState.activeIntervals}</div>
      <div>Speech queue: {debugState.speechQueue}</div>
      {debugState.error ? <div className="mt-1 wrap-break-word text-red-700">Error: {debugState.error}</div> : null}
    </div>
  );
}

function TvMediaFallback({ totalWaiting }: { totalWaiting: number }) {
  return (
    <div className="relative flex h-full min-h-130 items-center justify-center overflow-hidden rounded-3xl border border-white/60 bg-white/45 shadow-[0_20px_70px_rgba(128,0,32,0.12)] backdrop-blur-xl">
      <div className="absolute inset-0 bg-linear-to-br from-white/50 via-white/20 to-primary/10" />
      <div className="z-10 text-center">
        <div className="text-3xl font-black text-primary">{totalWaiting}</div>
        <div className="mt-2 text-sm font-semibold uppercase tracking-[0.3em] text-gray-500">Waiting</div>
      </div>
    </div>
  );
}

function TvMediaShowcase({
  items,
  activeIndex,
  totalWaiting,
  muted,
  volume,
  announcementDucked,
  audioActivated,
  autoPlay,
  videoEnhancementsEnabled,
  transitionType,
  transitionDuration,
  onPlaybackBlocked,
  onAdvance,
}: {
  items: TvMediaItem[];
  activeIndex: number;
  totalWaiting: number;
  muted: boolean;
  volume: number;
  announcementDucked: boolean;
  audioActivated: boolean;
  autoPlay: boolean;
  videoEnhancementsEnabled: boolean;
  transitionType: "fade" | "slide" | "none";
  transitionDuration: number;
  onPlaybackBlocked: () => void;
  onAdvance: () => void;
}) {
  const active = items.length > 0 ? items.at(activeIndex % items.length) : null;
  const videoRef = React.useRef<HTMLVideoElement>(null);
  const activeTrimStart = videoEnhancementsEnabled && active?.type === "video" ? Math.max(0, active.trimStart ?? 0) : 0;
  const activeTrimEnd = videoEnhancementsEnabled && active?.type === "video" && typeof active.trimEnd === "number" && active.trimEnd > activeTrimStart ? active.trimEnd : null;
  const activeMuted = muted || (active?.type === "video" && getVideoMuted(active));
  const activeVolume = Math.min(1, Math.max(0, volume * (videoEnhancementsEnabled && active?.type === "video" ? getVideoVolumeLevel(active) : 1)));
  const activePlaybackSpeed = videoEnhancementsEnabled && active?.type === "video" ? active.playbackSpeed ?? 1 : 1;

  React.useEffect(() => {
    const video = videoRef.current;
    if (video) {
      try {
        video.muted = announcementDucked || activeMuted;
        video.volume = announcementDucked ? 0 : activeVolume;
        video.playbackRate = activePlaybackSpeed;
      } catch (error) {
        console.warn("TV video settings failed", error);
      }
      if (!autoPlay) return;

      const attemptPlay = async () => {
        if (!video.muted && typeof navigator !== "undefined" && navigator.userActivation && !navigator.userActivation.hasBeenActive) {
          video.muted = true;
          void video.play().catch(() => {});
          if (!announcementDucked && !activeMuted && audioActivated) {
            onPlaybackBlocked();
          }
          return;
        }

        try {
          await video.play();
        } catch {
          if (!announcementDucked && !activeMuted && audioActivated) {
            onPlaybackBlocked();
            try {
              video.muted = true;
              void video.play().catch(() => onPlaybackBlocked());
            } catch {
              // Autoplay fallback is best effort on TV browsers.
            }
          }
        }
      };

      void attemptPlay();
    }
  }, [activeMuted, activeVolume, activePlaybackSpeed, announcementDucked, audioActivated, autoPlay, active?.id, onPlaybackBlocked]);

  const handleVideoEnded = () => {
    if (active?.type === "video" && (active.loop || items.length <= 1)) {
      if (videoRef.current) {
        try {
          videoRef.current.currentTime = activeTrimStart;
          void videoRef.current.play().catch(() => undefined);
        } catch (error) {
          console.warn("TV video loop failed", error);
        }
      }
      return;
    }
    onAdvance();
  };

  return (
    <div className="relative h-full min-h-130 overflow-hidden rounded-3xl border border-white/60 bg-white/45 shadow-[0_20px_70px_rgba(128,0,32,0.12)] backdrop-blur-xl">
      <div className="absolute inset-0 bg-linear-to-br from-white/50 via-white/20 to-primary/10" />
      <div className="absolute inset-0 rounded-3xl ring-1 ring-black/5" />
      <AnimatePresence mode="wait">
        {active ? (
          <motion.div
            key={active.id}
            initial={transitionType === "slide" ? { opacity: 0, x: 40 } : transitionType === "none" ? { opacity: 1 } : { opacity: 0, scale: 1.02 }}
            animate={transitionType === "slide" ? { opacity: 1, x: 0 } : { opacity: 1, scale: 1 }}
            exit={transitionType === "slide" ? { opacity: 0, x: -40 } : transitionType === "none" ? { opacity: 1 } : { opacity: 0, scale: 0.99 }}
            transition={{ duration: transitionType === "none" ? 0 : transitionDuration, ease: "easeOut" }}
            className="absolute inset-0"
          >
            {active.type === "video" ? (
              <video
                ref={videoRef}
                data-tv-media-video="true"
                src={active.url}
                className="h-full w-full"
                style={getMediaDisplayStyle(active)}
                autoPlay={autoPlay}
                playsInline
                muted={activeMuted}
                onLoadedMetadata={() => {
                  const video = videoRef.current;
                  if (!video) return;
                  try {
                    video.currentTime = activeTrimStart;
                    video.muted = announcementDucked || activeMuted;
                    video.volume = announcementDucked ? 0 : activeVolume;
                    video.playbackRate = activePlaybackSpeed;
                    if (autoPlay) {
                      if (!video.muted && typeof navigator !== "undefined" && navigator.userActivation && !navigator.userActivation.hasBeenActive) {
                        video.muted = true;
                        void video.play().catch(() => {});
                        if (!announcementDucked && !activeMuted && audioActivated) onPlaybackBlocked();
                      } else {
                        void video.play().catch(() => {
                          if (!announcementDucked && !activeMuted && audioActivated) onPlaybackBlocked();
                        });
                      }
                    }
                  } catch (error) {
                    console.warn("TV video metadata handling failed", error);
                  }
                }}
                onTimeUpdate={() => {
                  const video = videoRef.current;
                  if (!video || activeTrimEnd === null) return;
                  try {
                    if (video.currentTime >= activeTrimEnd) {
                      video.pause();
                      handleVideoEnded();
                    }
                  } catch (error) {
                    console.warn("TV video trim handling failed", error);
                  }
                }}
                onEnded={handleVideoEnded}
              />
            ) : (
              <img src={active.url} alt={active.name} className="h-full w-full" style={getMediaDisplayStyle(active)} />
            )}
            <div className="absolute inset-0 bg-linear-to-t from-black/50 via-black/5 to-transparent" />
          </motion.div>
        ) : (
          <motion.div
            key="empty-tv-media"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 flex items-center justify-center p-8 text-center"
          >
            <div>
              <div className="mx-auto mb-5 grid h-20 w-20 place-items-center rounded-3xl bg-primary text-white shadow-[0_12px_35px_rgba(128,0,32,0.25)]">
                <span className="text-2xl font-black">CCS</span>
              </div>
              <div className="text-3xl font-black tracking-tight text-foreground">Welcome to Enrollment</div>
              <div className="mx-auto mt-3 max-w-xl text-lg text-gray-600">
                Please wait for your queue number to appear on the screen. Prepare your requirements and proceed when called.
              </div>
              <div className="mt-5 inline-flex items-center rounded-full border border-primary/20 bg-white/70 px-5 py-2 text-sm font-semibold text-primary">
                {totalWaiting} students currently waiting
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {items.length > 1 && (
        <div className="absolute right-5 top-5 flex gap-1.5">
          {items.slice(0, 8).map((item, index) => (
            <span
              key={item.id}
              className={`h-1.5 rounded-full transition-all ${
                index === activeIndex % items.length ? "w-6 bg-primary" : "w-1.5 bg-white/70"
              }`}
            />
          ))}
        </div>
      )}
    </div>
  );
}
