import { useEffect, useMemo, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { motion, AnimatePresence } from "framer-motion";
import {
  useGetAnalyticsSummary, getGetAnalyticsSummaryQueryKey,
  useGetCounterAnalytics, getGetCounterAnalyticsQueryKey,
  useListCounters, getListCountersQueryKey,
  useCreateCounter, useUpdateCounter, useDeleteCounter,
  useListQueue, getListQueueQueryKey,
  useListAnnouncements, getListAnnouncementsQueryKey,
  useCreateAnnouncement, useDeleteAnnouncement,
  usePauseCounter, useResumeCounter,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Form, FormControl, FormField, FormItem, FormMessage } from "@/components/ui/form";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { CcsLogo } from "@/components/ccs-logo";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Users, Clock, PlayCircle, CheckCircle, XCircle, LogOut, ShieldCheck, Tag, Trash2, Search, Upload, Image as ImageIcon, Film, CheckCircle2, Volume2, VolumeX, Maximize2, Minimize2, Megaphone, Bell, RotateCcw, ArrowUp, ArrowDown } from "lucide-react";
import { useStaffAuth, clearStaffSession } from "@/hooks/use-staff-auth";
import { useLocation } from "wouter";
import { useQueueSocket } from "@/hooks/use-socket";
import {
  getAnnouncementVoiceId,
  getAnnouncementVoiceLabel,
  getEnglishUsVoices,
  getPitchLabel,
  getPitchValue,
  getQueueAnnouncementText,
  inferAnnouncementVoiceGender,
  resolveAnnouncementVoice,
  type AnnouncementPitchLabel,
  type AnnouncementVoiceGender,
} from "@/lib/voice-announcement";

const announcementSchema = z.object({
  message: z.string().min(3, "Announcement must be at least 3 characters"),
});

const staffSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters"),
  staffName: z.string().optional(),
  username: z.string().min(3, "Username must be at least 3 characters"),
  pin: z.string().optional(),
  type: z.enum(["evaluator", "tagger", "hybrid", "queue_assistant"]),
  specialization: z.string().optional(),
});

type ReportRow = {
  counterId: number;
  counterName: string;
  staffName: string | null;
  counterType: "evaluator" | "tagger" | "hybrid";
  metricType: "evaluated" | "enrolled";
  today: number;
  thisWeek: number;
  thisMonth: number;
  allTime: number;
};

type QueueAssistantMonitorRow = {
  assistantId: number;
  assistantName: string;
  counterName: string;
  generatedQueuesToday: number;
  generatedQueuesThisWeek: number;
  generatedQueuesThisMonth: number;
  lastLogin: string | null;
  currentStatus: string;
  recentQueues: { queueNumber: string; studentName: string; createdAt: string; status: string }[];
};

type TvMediaItem = {
  id: string;
  name: string;
  type: "video" | "image";
  url: string;
  uploadedAt: string;
  fitMode?: MediaFitMode;
  horizontalPosition?: MediaHorizontalPosition;
  verticalPosition?: MediaVerticalPosition;
  scale?: number;
  trimStart?: number;
  trimEnd?: number | null;
  volumeLevel?: number;
  muted?: boolean;
  updatedAt?: string;
  itemVolume?: number;
  itemMuted?: boolean;
  playbackSpeed?: MediaPlaybackSpeed;
  loop?: boolean;
  enabled?: boolean;
  order?: number;
};

type AdminTabValue = "counters" | "queue" | "reports" | "queue-assistants" | "tv-media" | "announcements" | "staff";
type MediaFitMode = "contain" | "cover" | "fill" | "center";
type MediaHorizontalPosition = "left" | "center" | "right";
type MediaVerticalPosition = "top" | "center" | "bottom";
type MediaPlaybackSpeed = 0.5 | 1 | 1.25 | 1.5;
type MediaTransitionType = "fade" | "slide" | "none";

const ADMIN_TAB_STORAGE_KEY = "admin-dashboard-active-tab";
const DEFAULT_MEDIA_SETTINGS = {
  fitMode: "cover" as MediaFitMode,
  horizontalPosition: "center" as MediaHorizontalPosition,
  verticalPosition: "center" as MediaVerticalPosition,
  scale: 1,
  trimStart: 0,
  trimEnd: null as number | null,
  volumeLevel: 1,
  muted: false,
  itemVolume: 1,
  itemMuted: false,
  playbackSpeed: 1 as MediaPlaybackSpeed,
  loop: false,
  enabled: true,
};
const ADMIN_TV_REQUEST_TIMEOUT_MS = 8000;

async function fetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs = ADMIN_TV_REQUEST_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(new DOMException("Admin TV request timed out", "TimeoutError")), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    if (!response.ok) throw new Error(`Request failed: ${response.status}`);
    return response;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

async function fetchJsonWithTimeout<T>(url: string, options: RequestInit = {}, timeoutMs = ADMIN_TV_REQUEST_TIMEOUT_MS): Promise<T> {
  const response = await fetchWithTimeout(url, options, timeoutMs);
  return response.json() as Promise<T>;
}

function getMediaDisplayStyle(item: TvMediaItem): React.CSSProperties {
  const fitMode = item.fitMode ?? DEFAULT_MEDIA_SETTINGS.fitMode;
  const horizontal = item.horizontalPosition ?? DEFAULT_MEDIA_SETTINGS.horizontalPosition;
  const vertical = item.verticalPosition ?? DEFAULT_MEDIA_SETTINGS.verticalPosition;
  const objectFit = fitMode === "fill" ? "fill" : fitMode === "center" ? "contain" : fitMode;
  return {
    objectFit,
    objectPosition: `${horizontal} ${vertical}`,
    transform: `scale(${item.scale ?? DEFAULT_MEDIA_SETTINGS.scale})`,
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

function readTvMediaResponse(payload: unknown): TvMediaItem[] | null {
  if (Array.isArray(payload)) return payload as TvMediaItem[];
  if (payload && typeof payload === "object" && Array.isArray((payload as { items?: unknown }).items)) {
    return (payload as { items: TvMediaItem[] }).items;
  }
  return null;
}

function getVideoAudioUpdate(item: TvMediaItem, updated: { volumeLevel?: number; muted?: boolean }): Partial<TvMediaItem> {
  const volumeLevel = updated.volumeLevel ?? getVideoVolumeLevel(item);
  const muted = updated.muted ?? getVideoMuted(item);
  return {
    volumeLevel,
    muted,
    itemVolume: volumeLevel,
    itemMuted: muted,
    updatedAt: new Date().toISOString(),
  };
}

export default function AdminDashboard() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const session = useStaffAuth();
  useQueueSocket(); // Realtime updates

  const { data: summary } = useGetAnalyticsSummary({
    query: { enabled: true, queryKey: getGetAnalyticsSummaryQueryKey(), refetchInterval: 5000 },
  });
  const { data: counterAnalytics } = useGetCounterAnalytics({
    query: { enabled: true, queryKey: getGetCounterAnalyticsQueryKey(), refetchInterval: 5000 },
  });
  const { data: counters, refetch: refetchCounters } = useListCounters({
    query: { enabled: true, queryKey: getListCountersQueryKey(), refetchInterval: 5000 },
  });
  const { data: queue, refetch: refetchQueue } = useListQueue(undefined, {
    query: { enabled: true, queryKey: getListQueueQueryKey(), refetchInterval: 5000 },
  });
  const { data: announcements, refetch: refetchAnnouncements } = useListAnnouncements({
    query: { enabled: true, queryKey: getListAnnouncementsQueryKey(), refetchInterval: 10000 },
  });

  const createAnnouncementMutation = useCreateAnnouncement();
  const deleteAnnouncementMutation = useDeleteAnnouncement();
  const pauseCounterMutation = usePauseCounter();
  const resumeCounterMutation = useResumeCounter();
  const createCounterMutation = useCreateCounter();
  const updateCounterMutation = useUpdateCounter();
  const deleteCounterMutation = useDeleteCounter();
  const [editingStaffId, setEditingStaffId] = useState<number | null>(null);
  const [selectedQueueIds, setSelectedQueueIds] = useState<number[]>([]);
  const [isDeletingQueue, setIsDeletingQueue] = useState(false);
  const [queueSearch, setQueueSearch] = useState("");
  const [queueStatusFilter, setQueueStatusFilter] = useState("all");
  const [staffSearch, setStaffSearch] = useState("");
  const [selectedStaffIds, setSelectedStaffIds] = useState<number[]>([]);
  const [reports, setReports] = useState<ReportRow[]>([]);
  const [queueAssistantMonitoring, setQueueAssistantMonitoring] = useState<QueueAssistantMonitorRow[]>([]);
  const [tvMedia, setTvMedia] = useState<TvMediaItem[]>([]);
  const [isUploadingTvMedia, setIsUploadingTvMedia] = useState(false);
  const [activeTab, setActiveTab] = useState<AdminTabValue>(() => {
    if (typeof window === "undefined") return "counters";
    const savedTab = window.localStorage.getItem(ADMIN_TAB_STORAGE_KEY) as AdminTabValue | null;
    return savedTab ?? "counters";
  });
  const [tvAudioEnabled, setTvAudioEnabled] = useState(true);
  const [tvMuted, setTvMuted] = useState(true);
  const [tvVolume, setTvVolume] = useState(1);
  const [tvFullscreenEnabled, setTvFullscreenEnabled] = useState(false);
  const [voiceAnnouncementEnabled, setVoiceAnnouncementEnabled] = useState(true);
  const [notificationSoundEnabled, setNotificationSoundEnabled] = useState(true);
  const [announcementVolume, setAnnouncementVolume] = useState(1);
  const [announcementChimeVolume, setAnnouncementChimeVolume] = useState(1);
  const [voicePriorityBoost, setVoicePriorityBoost] = useState(true);
  const [announcementVoiceName, setAnnouncementVoiceName] = useState("");
  const [announcementVoiceId, setAnnouncementVoiceId] = useState("");
  const [announcementVoiceGender, setAnnouncementVoiceGender] = useState<AnnouncementVoiceGender>("female");
  const [announcementRate, setAnnouncementRate] = useState(1);
  const [announcementPitch, setAnnouncementPitch] = useState(1);
  const [availableSpeechVoices, setAvailableSpeechVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [tvBrowserName, setTvBrowserName] = useState<string | undefined>(undefined);
  const [tvBrowserVersion, setTvBrowserVersion] = useState<string | undefined>(undefined);
  const [tvBrowserIsFirefox, setTvBrowserIsFirefox] = useState<boolean | undefined>(undefined);
  const [tvLastVoiceSync, setTvLastVoiceSync] = useState<string | undefined>(undefined);
  const [tvConnectedClients, setTvConnectedClients] = useState<number | undefined>(undefined);
  const [lastTvVoiceEventId, setLastTvVoiceEventId] = useState<string | undefined>(undefined);
  const [lastTvVoiceEventType, setLastTvVoiceEventType] = useState<string | undefined>(undefined);
  const [lastTvVoiceEventAt, setLastTvVoiceEventAt] = useState<string | undefined>(undefined);
  const [tvAutoPlay, setTvAutoPlay] = useState(true);
  const [mediaTransitionType, setMediaTransitionType] = useState<MediaTransitionType>("fade");
  const [mediaTransitionDuration, setMediaTransitionDuration] = useState(0.8);
  const [lunchBreakEnabled, setLunchBreakEnabled] = useState(false);
  const [cutOffEnabled, setCutOffEnabled] = useState(false);
  const tvMediaLoadingRef = useRef(false);
  const tvSettingsLoadingRef = useRef(false);
  const tvSettingsSavingRef = useRef(false);
  const [announceTwice, setAnnounceTwice] = useState(false);

  const filteredQueue = useMemo(() => {
    const term = queueSearch.trim().toLowerCase();
    return (queue ?? []).filter((entry) => {
      const matchesStatus = queueStatusFilter === "all" || entry.status === queueStatusFilter;
      const matchesSearch =
        !term ||
        entry.queueNumber.toLowerCase().includes(term) ||
        entry.fullName.toLowerCase().includes(term) ||
        entry.category.toLowerCase().includes(term) ||
        entry.workflow.replace("_", " ").toLowerCase().includes(term) ||
        (entry.assignedCounterName?.toLowerCase().includes(term) ?? false) ||
        (entry.taggerCounterName?.toLowerCase().includes(term) ?? false);
      return matchesStatus && matchesSearch;
    });
  }, [queue, queueSearch, queueStatusFilter]);

  const filteredStaff = useMemo(() => {
    const term = staffSearch.trim().toLowerCase();
    return (counters ?? []).filter((staff) => {
      if (!term) return true;
      return (
        staff.name.toLowerCase().includes(term) ||
        staff.type.toLowerCase().includes(term) ||
        (staff.username?.toLowerCase().includes(term) ?? false) ||
        (staff.staffName?.toLowerCase().includes(term) ?? false) ||
        (staff.specialization?.toLowerCase().includes(term) ?? false)
      );
    });
  }, [counters, staffSearch]);

  const selectedTvVoiceAvailable = announcementVoiceId
    ? availableSpeechVoices.some((voice) => getAnnouncementVoiceId(voice) === announcementVoiceId)
    : false;

  const queueIds = useMemo(() => filteredQueue.map((entry) => entry.id), [filteredQueue]);
  const selectedQueueIdSet = useMemo(() => new Set(selectedQueueIds), [selectedQueueIds]);
  const selectedVisibleCount = queueIds.filter((id) => selectedQueueIdSet.has(id)).length;
  const allVisibleSelected = queueIds.length > 0 && selectedVisibleCount === queueIds.length;
  const hasPartialVisibleSelection = selectedVisibleCount > 0 && !allVisibleSelected;
  const staffIds = useMemo(() => filteredStaff.map((staff) => staff.id), [filteredStaff]);
  const selectedStaffIdSet = useMemo(() => new Set(selectedStaffIds), [selectedStaffIds]);
  const selectedVisibleStaffCount = staffIds.filter((id) => selectedStaffIdSet.has(id)).length;
  const allVisibleStaffSelected = staffIds.length > 0 && selectedVisibleStaffCount === staffIds.length;
  const hasPartialVisibleStaffSelection = selectedVisibleStaffCount > 0 && !allVisibleStaffSelected;

  useEffect(() => {
    const existingIds = new Set((queue ?? []).map((entry) => entry.id));
    setSelectedQueueIds((current) => current.filter((id) => existingIds.has(id)));
  }, [queue]);

  useEffect(() => {
    const existingIds = new Set((counters ?? []).map((staff) => staff.id));
    setSelectedStaffIds((current) => current.filter((id) => existingIds.has(id)));
  }, [counters]);

  useEffect(() => {
    if (announcementVoiceId || announcementVoiceName || availableSpeechVoices.length === 0) return;
    const ziraVoice = availableSpeechVoices.find((voice) => voice.name.toLowerCase().includes("zira"));
    const femaleVoice = availableSpeechVoices.find((voice) => inferAnnouncementVoiceGender(voice.name) === "female");
    const firstVoice = ziraVoice ?? femaleVoice ?? availableSpeechVoices[0];
    const voiceGender = inferAnnouncementVoiceGender(firstVoice.name);
    setAnnouncementVoiceName(firstVoice.name);
    setAnnouncementVoiceId(getAnnouncementVoiceId(firstVoice));
    setAnnouncementVoiceGender(voiceGender);
  }, [announcementVoiceId, announcementVoiceName, availableSpeechVoices]);

  useEffect(() => {
    let isMounted = true;

    const loadReports = async () => {
      const response = await fetch("/api/analytics/reports");
      if (!response.ok) return;
      const data = await response.json();
      if (isMounted) setReports(data);
    };

    const loadQueueAssistantMonitoring = async () => {
      const response = await fetch("/api/admin/queue-assistants/monitoring");
      if (!response.ok) return;
      const data = await response.json();
      if (isMounted) setQueueAssistantMonitoring(data);
    };

    void loadReports();
    void loadQueueAssistantMonitoring();
    const intervalId = window.setInterval(loadReports, 10000);
    const monitoringIntervalId = window.setInterval(loadQueueAssistantMonitoring, 10000);

    return () => {
      isMounted = false;
      window.clearInterval(intervalId);
      window.clearInterval(monitoringIntervalId);
    };
  }, []);

  const loadTvMedia = async () => {
    if (tvMediaLoadingRef.current) return;
    tvMediaLoadingRef.current = true;
    try {
      const payload = await fetchJsonWithTimeout<unknown>("/api/tv/media");
      const items = readTvMediaResponse(payload);
      if (!items) {
        console.error("TV media API returned an unexpected payload", payload);
        toast({ title: "TV media unavailable", description: "The media playlist response was invalid. Previous media remains visible.", variant: "destructive" });
        return;
      }
      console.info("TV media loaded for Admin", {
        returnedCount: items.length,
        renderedCount: items.length,
        enabledCount: items.filter((item) => item.enabled !== false).length,
        videoCount: items.filter((item) => item.type === "video").length,
        imageCount: items.filter((item) => item.type === "image").length,
      });
      setTvMedia(items);
    } catch (err) {
      console.error("Failed to load TV media", err);
      toast({ title: "TV media unavailable", description: err instanceof Error ? err.message : "Previous media remains visible.", variant: "destructive" });
    } finally {
      tvMediaLoadingRef.current = false;
    }
  };

  const loadTvSettings = async () => {
    if (tvSettingsLoadingRef.current || tvSettingsSavingRef.current) return;
    tvSettingsLoadingRef.current = true;
    try {
      const data = await fetchJsonWithTimeout<any>("/api/tv/settings");
        setTvAudioEnabled(data.audioEnabled ?? true);
        setTvMuted(data.muted ?? true);
        setTvVolume(typeof data.volume === "number" ? data.volume : 1);
        setTvFullscreenEnabled(data.fullscreenEnabled ?? false);
        setVoiceAnnouncementEnabled(data.voiceAnnouncementEnabled ?? true);
        setNotificationSoundEnabled(data.notificationSoundEnabled ?? true);
        setAnnouncementVolume(typeof data.announcementVolume === "number" ? data.announcementVolume : 1);
        setAnnouncementVoiceName(typeof data.announcementVoiceName === "string" ? data.announcementVoiceName : "");
        setAnnouncementVoiceId(typeof data.announcementVoiceId === "string" ? data.announcementVoiceId : "");
        setAnnouncementVoiceGender(data.announcementVoiceGender === "male" || data.announcementGender === "male" ? "male" : "female");
        setAnnouncementRate(typeof data.announcementRate === "number" ? data.announcementRate : 1);
        setAnnouncementPitch(typeof data.announcementPitch === "number" ? data.announcementPitch : 1);
        setAnnounceTwice(data.announcementTwice ?? false);
        setTvAutoPlay(data.autoPlay ?? true);
        setMediaTransitionType(data.mediaTransitionType === "slide" || data.mediaTransitionType === "none" ? data.mediaTransitionType : "fade");
        setMediaTransitionDuration(typeof data.mediaTransitionDuration === "number" ? data.mediaTransitionDuration : 0.8);
        setLunchBreakEnabled(data.lunchBreakEnabled ?? false);
        setCutOffEnabled(data.cutOffEnabled ?? false);
        setAvailableSpeechVoices(Array.isArray(data.tvAvailableVoices) ? data.tvAvailableVoices : []);
        setTvBrowserName(typeof data.tvBrowserName === "string" ? data.tvBrowserName : undefined);
        setTvBrowserVersion(typeof data.tvBrowserVersion === "string" ? data.tvBrowserVersion : undefined);
        setTvBrowserIsFirefox(typeof data.tvBrowserIsFirefox === "boolean" ? data.tvBrowserIsFirefox : undefined);
        setTvLastVoiceSync(typeof data.tvLastVoiceSync === "string" ? data.tvLastVoiceSync : undefined);
        setTvConnectedClients(typeof data.tvConnectedClients === "number" ? data.tvConnectedClients : undefined);
        setLastTvVoiceEventId(typeof data.lastTvVoiceEventId === "string" ? data.lastTvVoiceEventId : undefined);
        setLastTvVoiceEventType(typeof data.lastTvVoiceEventType === "string" ? data.lastTvVoiceEventType : undefined);
        setLastTvVoiceEventAt(typeof data.lastTvVoiceEventAt === "string" ? data.lastTvVoiceEventAt : undefined);
    } catch (err) {
      console.error("Failed to load TV settings", err);
    } finally {
      tvSettingsLoadingRef.current = false;
    }
  };

  const updateTvSettings = async (
    updated: Partial<{
      muted: boolean;
      audioEnabled: boolean;
      volume: number;
      fullscreenEnabled: boolean;
      voiceAnnouncementEnabled: boolean;
      notificationSoundEnabled: boolean;
      announcementVolume: number;
      announcementChimeVolume: number;
      voicePriorityBoost: boolean;
      announcementVoiceName: string;
      announcementVoiceId: string;
      announcementVoiceGender: AnnouncementVoiceGender;
      announcementRate: number;
      announcementPitch: number;
      announcementTwice: boolean;
      manualAnnouncementVoiceCommand: {
        id: string;
        type: "announcement" | "queue_call_again";
        announcementId?: number;
        queueId?: number;
        title?: string;
        message?: string;
        text: string;
        createdAt: string;
      };
      autoPlay: boolean;
      mediaTransitionType: MediaTransitionType;
      mediaTransitionDuration: number;
      lunchBreakEnabled: boolean;
      cutOffEnabled: boolean;
    }>,
  ) => {
    tvSettingsSavingRef.current = true;
    const nextSettings = {
      muted: tvMuted,
      audioEnabled: tvAudioEnabled,
      volume: tvVolume,
      fullscreenEnabled: tvFullscreenEnabled,
      voiceAnnouncementEnabled,
      notificationSoundEnabled,
      announcementVolume,
      announcementVoiceName,
      announcementVoiceId,
      announcementVoiceGender,
      announcementRate,
      announcementPitch,
      autoPlay: tvAutoPlay,
      mediaTransitionType,
      mediaTransitionDuration,
      lunchBreakEnabled,
      cutOffEnabled,
      ...updated,
    };

    setTvAudioEnabled(nextSettings.audioEnabled);
    setTvMuted(nextSettings.muted);
    setTvVolume(nextSettings.volume);
    setTvFullscreenEnabled(nextSettings.fullscreenEnabled);
    setVoiceAnnouncementEnabled(nextSettings.voiceAnnouncementEnabled);
    setNotificationSoundEnabled(nextSettings.notificationSoundEnabled);
    setAnnouncementVolume(nextSettings.announcementVolume);
    setAnnouncementVoiceName(nextSettings.announcementVoiceName);
    setAnnouncementVoiceId(nextSettings.announcementVoiceId);
    setAnnouncementVoiceGender(nextSettings.announcementVoiceGender);
    setAnnouncementRate(nextSettings.announcementRate);
    setAnnouncementPitch(nextSettings.announcementPitch);
    setAnnounceTwice(nextSettings.announcementTwice ?? false);
    setTvAutoPlay(nextSettings.autoPlay);
    setMediaTransitionType(nextSettings.mediaTransitionType);
    setMediaTransitionDuration(nextSettings.mediaTransitionDuration);
    setLunchBreakEnabled(nextSettings.lunchBreakEnabled);
    setCutOffEnabled(nextSettings.cutOffEnabled);

    try {
      const data = await fetchJsonWithTimeout<any>("/api/tv/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updated),
      });
      setTvAudioEnabled(data.audioEnabled ?? nextSettings.audioEnabled);
      setTvMuted(data.muted ?? nextSettings.muted);
      setTvVolume(typeof data.volume === "number" ? data.volume : nextSettings.volume);
      setTvFullscreenEnabled(data.fullscreenEnabled ?? nextSettings.fullscreenEnabled);
      setVoiceAnnouncementEnabled(data.voiceAnnouncementEnabled ?? nextSettings.voiceAnnouncementEnabled);
      setNotificationSoundEnabled(data.notificationSoundEnabled ?? nextSettings.notificationSoundEnabled);
      setAnnouncementVolume(typeof data.announcementVolume === "number" ? data.announcementVolume : nextSettings.announcementVolume);
      setAnnouncementVoiceName(typeof data.announcementVoiceName === "string" ? data.announcementVoiceName : nextSettings.announcementVoiceName);
      setAnnouncementVoiceId(typeof data.announcementVoiceId === "string" ? data.announcementVoiceId : nextSettings.announcementVoiceId);
      setAnnouncementVoiceGender(data.announcementVoiceGender === "male" || data.announcementGender === "male" ? "male" : nextSettings.announcementVoiceGender);
      setAnnouncementRate(typeof data.announcementRate === "number" ? data.announcementRate : nextSettings.announcementRate);
      setAnnouncementPitch(typeof data.announcementPitch === "number" ? data.announcementPitch : nextSettings.announcementPitch);
      setAnnounceTwice(data.announcementTwice ?? nextSettings.announcementTwice);
      setTvAutoPlay(data.autoPlay ?? nextSettings.autoPlay);
      setMediaTransitionType(data.mediaTransitionType === "slide" || data.mediaTransitionType === "none" ? data.mediaTransitionType : nextSettings.mediaTransitionType);
      setMediaTransitionDuration(typeof data.mediaTransitionDuration === "number" ? data.mediaTransitionDuration : nextSettings.mediaTransitionDuration);
      setLunchBreakEnabled(data.lunchBreakEnabled ?? nextSettings.lunchBreakEnabled);
      setCutOffEnabled(data.cutOffEnabled ?? nextSettings.cutOffEnabled);
      setAvailableSpeechVoices(Array.isArray(data.tvAvailableVoices) ? data.tvAvailableVoices : []);
      setTvBrowserName(typeof data.tvBrowserName === "string" ? data.tvBrowserName : undefined);
      setTvBrowserVersion(typeof data.tvBrowserVersion === "string" ? data.tvBrowserVersion : undefined);
      setTvBrowserIsFirefox(typeof data.tvBrowserIsFirefox === "boolean" ? data.tvBrowserIsFirefox : undefined);
      setTvLastVoiceSync(typeof data.tvLastVoiceSync === "string" ? data.tvLastVoiceSync : undefined);
      setTvConnectedClients(typeof data.tvConnectedClients === "number" ? data.tvConnectedClients : undefined);
      setLastTvVoiceEventId(typeof data.lastTvVoiceEventId === "string" ? data.lastTvVoiceEventId : undefined);
      setLastTvVoiceEventType(typeof data.lastTvVoiceEventType === "string" ? data.lastTvVoiceEventType : undefined);
      setLastTvVoiceEventAt(typeof data.lastTvVoiceEventAt === "string" ? data.lastTvVoiceEventAt : undefined);
    } catch (err) {
      console.error("Failed to update TV settings", err);
      toast({ title: "Failed to save TV settings", description: err instanceof Error ? err.message : "Please try again.", variant: "destructive" });
      tvSettingsSavingRef.current = false;
      void loadTvSettings();
    } finally {
      tvSettingsSavingRef.current = false;
    }
  };

  const handleToggleTvAudioEnabled = async () => {
    await updateTvSettings({ audioEnabled: !tvAudioEnabled });
  };

  const handleVolumeTvChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const newVolume = parseFloat(e.target.value);
    if (Number.isNaN(newVolume)) return;
    await updateTvSettings({ volume: newVolume });
  };

  const handleToggleTvMute = async (event?: React.MouseEvent<HTMLButtonElement>) => {
    event?.preventDefault();
    await updateTvSettings({ muted: !tvMuted });
  };

  const handleToggleTvFullscreen = async (event?: React.MouseEvent<HTMLButtonElement>) => {
    event?.preventDefault();
    await updateTvSettings({ fullscreenEnabled: !tvFullscreenEnabled });
  };

  const handleToggleVoiceAnnouncement = async () => {
    await updateTvSettings({ voiceAnnouncementEnabled: !voiceAnnouncementEnabled });
  };

  const handleToggleNotificationSound = async () => {
    await updateTvSettings({ notificationSoundEnabled: !notificationSoundEnabled });
  };

  const handleToggleAnnouncementTwice = async () => {
    await updateTvSettings({ announcementTwice: !announceTwice });
  };

  const handleAnnouncementVolumeChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const newVolume = parseFloat(e.target.value);
    if (Number.isNaN(newVolume)) return;
    await updateTvSettings({ announcementVolume: newVolume });
  };

  const handleAnnouncementChimeVolumeChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const newVolume = parseFloat(e.target.value);
    if (Number.isNaN(newVolume)) return;
    await updateTvSettings({ announcementChimeVolume: newVolume });
  };

  const handleVoicePriorityBoostChange = async () => {
    await updateTvSettings({ voicePriorityBoost: !voicePriorityBoost });
  };

  const handleAnnouncementVoiceChange = async (voiceId: string) => {
    const voice = availableSpeechVoices.find((item) => getAnnouncementVoiceId(item) === voiceId);
    if (!voice) return;
    const voiceGender = inferAnnouncementVoiceGender(voice.name);
    await updateTvSettings({
      announcementVoiceName: voice.name,
      announcementVoiceId: getAnnouncementVoiceId(voice),
      announcementVoiceGender: voiceGender,
    });
  };

  const handleAnnouncementRateChange = async (value: string) => {
    const newRate = parseFloat(value);
    if (Number.isNaN(newRate)) return;
    await updateTvSettings({ announcementRate: newRate });
  };

  const handleAnnouncementPitchChange = async (value: string) => {
    if (value !== "low" && value !== "normal" && value !== "high") return;
    await updateTvSettings({ announcementPitch: getPitchValue(value as AnnouncementPitchLabel) });
  };

  const handleTestVoice = () => {
    if (!("speechSynthesis" in window)) {
      toast({ title: "Voice test unavailable", description: "This browser does not support speech synthesis.", variant: "destructive" });
      return;
    }

    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(getQueueAnnouncementText({
      queueNumber: "DT0004",
      studentName: "Juan Dela Cruz",
      counterName: "Tagging Counter",
    }));
    utterance.lang = "en-US";
    const voice = resolveAnnouncementVoice(window.speechSynthesis.getVoices(), announcementVoiceId, announcementVoiceName);
    if (voice) utterance.voice = voice;
    utterance.volume = announcementVolume;
    utterance.rate = announcementRate;
    utterance.pitch = announcementPitch;
    window.speechSynthesis.speak(utterance);
  };

  const handleToggleTvAutoPlay = async () => {
    await updateTvSettings({ autoPlay: !tvAutoPlay });
  };

  const handleMediaTransitionTypeChange = async (value: string) => {
    if (value !== "fade" && value !== "slide" && value !== "none") return;
    await updateTvSettings({ mediaTransitionType: value });
  };

  const handleMediaTransitionDurationChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const duration = parseFloat(event.target.value);
    if (Number.isNaN(duration)) return;
    await updateTvSettings({ mediaTransitionDuration: duration });
  };

  const handleToggleLunchBreak = async () => {
    await updateTvSettings({ lunchBreakEnabled: !lunchBreakEnabled });
  };

  const handleToggleCutOff = async () => {
    await updateTvSettings({ cutOffEnabled: !cutOffEnabled });
  };

  useEffect(() => {
    void loadTvMedia();
    void loadTvSettings();
    const intervalId = window.setInterval(() => {
      void loadTvSettings();
    }, 5000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, []);

  const updateActiveTab = (value: AdminTabValue) => {
    setActiveTab(value);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(ADMIN_TAB_STORAGE_KEY, value);
    }
  };

  const announcementForm = useForm<z.infer<typeof announcementSchema>>({
    resolver: zodResolver(announcementSchema),
    defaultValues: { message: "" },
  });

  const staffForm = useForm<z.infer<typeof staffSchema>>({
    resolver: zodResolver(staffSchema),
    defaultValues: { name: "", staffName: "", username: "", pin: "", type: "evaluator", specialization: "" },
  });

  if (!session || session.role !== "admin") return null;

  const handleCreateAnnouncement = (data: z.infer<typeof announcementSchema>) => {
    createAnnouncementMutation.mutate({ data }, {
      onSuccess: () => { toast({ title: "Announcement posted" }); announcementForm.reset(); refetchAnnouncements(); },
    });
  };

  const handleDeleteAnnouncement = (id: number) => {
    deleteAnnouncementMutation.mutate({ id }, { onSuccess: () => refetchAnnouncements() });
  };

  const handleVoiceAnnounce = async (announcement: { id: number; message: string }) => {
    const message = announcement.message.trim();
    if (!message) return;
    const eventId =
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? `announcement-speak-${announcement.id}-${Date.now()}-${crypto.randomUUID()}`
        : `announcement-speak-${announcement.id}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    console.log("[ADMIN] Speak announcement clicked", {
      announcementId: announcement.id,
      title: "",
      message,
    });
    console.log("[ADMIN] Speak event generated", { eventId, announcementId: announcement.id });

    await updateTvSettings({
      manualAnnouncementVoiceCommand: {
        id: eventId,
        type: "announcement",
        announcementId: announcement.id,
        title: "",
        message,
        text: message,
        createdAt: new Date().toISOString(),
      },
    });
    console.log("[ADMIN] Voice Event Sent", { eventId, type: "announcement" });
    toast({ title: "Voice announcement sent", description: "The TV display will speak it once." });
  };

  const handleToggleCounter = (counter: { id: number; status: string }) => {
    if (counter.status === "paused" || counter.status === "break") {
      resumeCounterMutation.mutate({ id: counter.id }, { onSuccess: () => refetchCounters() });
    } else if (counter.status !== "offline") {
      pauseCounterMutation.mutate({ id: counter.id }, { onSuccess: () => refetchCounters() });
    }
  };

  const handleEditStaff = (staff: any) => {
    setEditingStaffId(staff.id);
    staffForm.reset({
      name: staff.name,
      staffName: staff.staffName || "",
      username: staff.username || "",
      pin: "",
      type: staff.type as "evaluator" | "tagger" | "hybrid" | "queue_assistant",
      specialization: staff.specialization || "",
    });
  };

  const handleSubmitStaff = (data: z.infer<typeof staffSchema>) => {
    if (editingStaffId) {
      const updateData = { ...data };
      if (!updateData.pin) delete updateData.pin;
      
      updateCounterMutation.mutate(
        { id: editingStaffId, data: updateData as any },
        {
          onSuccess: () => {
            toast({ title: "Staff member updated" });
            staffForm.reset({ name: "", staffName: "", username: "", pin: "", type: "evaluator", specialization: "" });
            setEditingStaffId(null);
            refetchCounters();
          },
          onError: (err: any) => {
            toast({ title: "Failed to update staff", description: err.response?.data?.error || err.message, variant: "destructive" });
          }
        }
      );
    } else {
      if (!data.pin || data.pin.length < 4) {
        staffForm.setError("pin", { type: "manual", message: "Password must be at least 4 characters" });
        return;
      }
      createCounterMutation.mutate({ data: data as any }, {
        onSuccess: () => {
          toast({ title: "Staff member created" });
          staffForm.reset();
          refetchCounters();
        },
        onError: (err: any) => {
          toast({ title: "Failed to create staff", description: err.response?.data?.error || err.message, variant: "destructive" });
        }
      });
    }
  };

  const handleToggleQueueSelection = (id: number, checked: boolean) => {
    setSelectedQueueIds((current) => {
      if (checked) return current.includes(id) ? current : [...current, id];
      return current.filter((selectedId) => selectedId !== id);
    });
  };

  const handleToggleAllQueueSelection = (checked: boolean) => {
    setSelectedQueueIds(checked ? queueIds : []);
  };

  const handleToggleStaffSelection = (id: number, checked: boolean) => {
    setSelectedStaffIds((current) => {
      if (checked) return current.includes(id) ? current : [...current, id];
      return current.filter((selectedId) => selectedId !== id);
    });
  };

  const handleToggleAllStaffSelection = (checked: boolean) => {
    setSelectedStaffIds(checked ? staffIds : []);
  };

  const handleDeleteSelectedQueue = async () => {
    if (selectedQueueIds.length === 0 || isDeletingQueue) return;

    const confirmed = window.confirm(
      `Delete ${selectedQueueIds.length} selected queue entr${selectedQueueIds.length === 1 ? "y" : "ies"}? This cannot be undone.`,
    );
    if (!confirmed) return;

    setIsDeletingQueue(true);
    try {
      await Promise.all(
        selectedQueueIds.map(async (id) => {
          const response = await fetch(`/api/queue/${id}`, { method: "DELETE" });
          if (!response.ok) throw new Error(`Failed to delete queue entry ${id}`);
        }),
      );
      toast({ title: "Queue entries deleted", description: `${selectedQueueIds.length} selected item${selectedQueueIds.length === 1 ? "" : "s"} removed.` });
      setSelectedQueueIds([]);
      await refetchQueue();
    } catch (err: any) {
      toast({ title: "Failed to delete selected entries", description: err.message, variant: "destructive" });
    } finally {
      setIsDeletingQueue(false);
    }
  };

  const handleDeleteSelectedStaff = async () => {
    if (selectedStaffIds.length === 0 || deleteCounterMutation.isPending) return;

    const confirmed = window.confirm(
      `Delete ${selectedStaffIds.length} selected staff record${selectedStaffIds.length === 1 ? "" : "s"}? This cannot be undone.`,
    );
    if (!confirmed) return;

    try {
      for (const id of selectedStaffIds) {
        await deleteCounterMutation.mutateAsync({ id });
      }
      toast({ title: "Staff records deleted", description: `${selectedStaffIds.length} selected staff record${selectedStaffIds.length === 1 ? "" : "s"} removed.` });
      setSelectedStaffIds([]);
      await refetchCounters();
    } catch (err: any) {
      toast({ title: "Failed to delete selected staff", description: err.response?.data?.error || err.message, variant: "destructive" });
    }
  };

  const handleUploadTvMedia = async (file: File) => {
    setIsUploadingTvMedia(true);
    try {
      const data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
      });

      await fetchWithTimeout("/api/tv/media", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename: file.name, mimeType: file.type, data }),
      }, 45000);

      toast({ title: "TV media uploaded", description: file.name });
      await loadTvMedia();
    } catch (err: any) {
      toast({ title: "Failed to upload TV media", description: err.message, variant: "destructive" });
    } finally {
      setIsUploadingTvMedia(false);
    }
  };

  const handleDeleteTvMedia = async (id: string) => {
    const confirmed = window.confirm("Delete this TV media item?");
    if (!confirmed) return;

    try {
      await fetchWithTimeout(`/api/tv/media/${id}`, { method: "DELETE" });
      toast({ title: "TV media deleted" });
      await loadTvMedia();
    } catch (error) {
      toast({
        title: "Failed to delete TV media",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    }
  };

  const handleUpdateTvMedia = async (id: string, updated: Partial<TvMediaItem>) => {
    setTvMedia((current) => current.map((item) => (item.id === id ? { ...item, ...updated } : item)));
    try {
      await fetchWithTimeout(`/api/tv/media/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updated),
      });
      await loadTvMedia();
    } catch (err: any) {
      toast({ title: "Failed to update media", description: err.message, variant: "destructive" });
      await loadTvMedia();
    }
  };

  const handleResetTvMedia = async (id: string) => {
    await handleUpdateTvMedia(id, DEFAULT_MEDIA_SETTINGS);
  };

  const handleMoveTvMedia = async (id: string, direction: "up" | "down") => {
    const ordered = [...tvMedia].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    const index = ordered.findIndex((item) => item.id === id);
    const nextIndex = direction === "up" ? index - 1 : index + 1;
    if (index < 0 || nextIndex < 0 || nextIndex >= ordered.length) return;
    const target = ordered[nextIndex];
    await handleUpdateTvMedia(id, { order: target.order ?? nextIndex });
    await handleUpdateTvMedia(target.id, { order: ordered[index].order ?? index });
  };

  const handleLogout = () => { clearStaffSession(); setLocation("/staff/login"); };

  return (
    <div 
      className="min-h-screen text-foreground flex flex-col p-6 max-h-screen overflow-hidden relative"
      style={{ background: "linear-gradient(170deg, #ffffff 0%, #fdf7f8 40%, #f9eef1 100%)" }}
    >
      <div className="light-blob-1" />
      <div className="light-blob-2" />
      <div className="light-blob-3" />
      
      <header className="flex justify-between items-center mb-6 glass-card p-4 shrink-0">
        <div className="flex items-center gap-3">
          <CcsLogo size="medium" className="shrink-0" />
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground">Mission Control</h1>
            <p className="text-primary font-semibold tracking-widest uppercase text-xs mt-1">Admin Dashboard</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <a href="/tv" target="_blank" rel="noopener noreferrer">
            <Button variant="outline" size="sm" className="bg-white/50 hover:bg-white text-xs">
              TV Display
            </Button>
          </a>
          <Button variant="outline" size="sm" onClick={handleLogout} className="bg-white/50 hover:bg-white gap-2">
            <LogOut className="w-3.5 h-3.5" /> Logout
          </Button>
        </div>
      </header>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4 mb-6 shrink-0">
        <StatCard title="Total Registered" value={summary?.totalRegistered ?? 0} icon={<Users className="text-blue-400 w-5 h-5" />} />
        <StatCard title="Waiting" value={summary?.totalWaiting ?? 0} icon={<Clock className="text-yellow-400 w-5 h-5" />} />
        <StatCard title="In Progress" value={summary?.totalInProgress ?? 0} icon={<PlayCircle className="text-primary w-5 h-5" />} />
        <StatCard title="Completed" value={summary?.totalCompleted ?? 0} icon={<CheckCircle className="text-green-400 w-5 h-5" />} />
        <StatCard title="Cancelled" value={summary?.totalCancelled ?? 0} icon={<XCircle className="text-red-400 w-5 h-5" />} />
      </div>

      <Tabs value={activeTab} onValueChange={updateActiveTab} className="flex-1 flex flex-col min-h-0">
        <TabsList className="glass-card shrink-0 w-max mb-5 p-1 rounded-xl">
          <TabsTrigger value="counters" className="data-[state=active]:bg-primary/10 data-[state=active]:text-primary text-gray-500 rounded-lg">Counters</TabsTrigger>
          <TabsTrigger value="queue" className="data-[state=active]:bg-primary/10 data-[state=active]:text-primary text-gray-500 rounded-lg">Live Queue</TabsTrigger>
          <TabsTrigger value="reports" className="data-[state=active]:bg-primary/10 data-[state=active]:text-primary text-gray-500 rounded-lg">Reports & Analytics</TabsTrigger>
          <TabsTrigger value="queue-assistants" className="data-[state=active]:bg-primary/10 data-[state=active]:text-primary text-gray-500 rounded-lg">Queue Assistants</TabsTrigger>
          <TabsTrigger value="tv-media" className="data-[state=active]:bg-primary/10 data-[state=active]:text-primary text-gray-500 rounded-lg">TV Media</TabsTrigger>
          <TabsTrigger value="announcements" className="data-[state=active]:bg-primary/10 data-[state=active]:text-primary text-gray-500 rounded-lg">Announcements</TabsTrigger>
          <TabsTrigger value="staff" className="data-[state=active]:bg-primary/10 data-[state=active]:text-primary text-gray-500 rounded-lg">Staff Setup</TabsTrigger>
        </TabsList>

        <div className="flex-1 overflow-auto glass-card p-4">
          <TabsContent value="counters" className="m-0">
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
              {counters?.map((counter) => {
                const analytics = counterAnalytics?.find((a) => a.counterId === counter.id);
                return (
                  <Card key={counter.id} className="glass-card overflow-hidden">
                    <CardHeader className="bg-white/40 pb-4 border-b border-black/5">
                      <div className="flex justify-between items-start">
                        <div>
                          <CardTitle className="text-base text-foreground">{counter.name}</CardTitle>
                          <CardDescription className="uppercase tracking-widest text-[10px] mt-0.5 text-primary">
                            {counter.type}
                            {counter.username ? ` · @${counter.username}` : ""}
                          </CardDescription>
                        </div>
                        <Badge variant="outline" className={`text-xs bg-white
                          ${counter.isOnline && counter.status === "available" ? "border-green-500/50 text-green-600 bg-green-50" : ""}
                          ${counter.isOnline && counter.status === "busy" ? "border-yellow-500/50 text-yellow-600 bg-yellow-50" : ""}
                          ${counter.isOnline && (counter.status === "break" || counter.status === "paused") ? "border-amber-500/50 text-amber-500 bg-amber-500/10" : ""}
                          ${!counter.isOnline || counter.status === "offline" ? "border-red-300 text-red-500 bg-red-50" : ""}
                        `}>
                          {!counter.isOnline || counter.status === "offline" 
                            ? "offline" 
                            : counter.status === "break" || counter.status === "paused"
                              ? "Lunch Break"
                              : counter.status}
                        </Badge>
                      </div>
                    </CardHeader>
                    <CardContent className="pt-4">
                      <div className="grid grid-cols-2 gap-2 text-sm mb-4">
                        <div className="bg-white/50 p-2 rounded-lg border border-black/5">
                          <div className="text-gray-500 uppercase text-[10px] tracking-wider">Served</div>
                          <div className="text-foreground font-bold text-xl">{analytics?.totalServed ?? 0}</div>
                        </div>
                        <div className="bg-white/50 p-2 rounded-lg border border-black/5">
                          <div className="text-gray-500 uppercase text-[10px] tracking-wider">Avg Time</div>
                          <div className="text-foreground font-bold text-xl">
                            {analytics?.averageProcessMinutes ? `${analytics.averageProcessMinutes}m` : "-"}
                          </div>
                        </div>
                      </div>
                      <Button
                        variant="outline"
                        className="w-full bg-white/50 hover:bg-white text-sm"
                        onClick={() => handleToggleCounter(counter)}
                        disabled={counter.status === "offline"}
                      >
                        {counter.status === "paused" || counter.status === "break" ? "Resume Counter" : "Lunch Break"}
                      </Button>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </TabsContent>

          <TabsContent value="queue" className="m-0 flex flex-col">
            <div className="mb-3 space-y-3 rounded-xl border border-black/5 bg-white/50 px-3 py-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold text-foreground">Student Queue Records</h2>
                  <p className="text-xs text-gray-500">Search, filter, select, and manage queue records.</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
                    <Input
                      value={queueSearch}
                      onChange={(event) => setQueueSearch(event.target.value)}
                      placeholder="Search queue..."
                      className="h-9 w-56 bg-white/70 pl-9 text-sm"
                    />
                  </div>
                  <Select value={queueStatusFilter} onValueChange={setQueueStatusFilter}>
                    <SelectTrigger className="h-9 w-40 bg-white/70 text-sm">
                      <SelectValue placeholder="Status" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All statuses</SelectItem>
                      <SelectItem value="waiting">Waiting</SelectItem>
                      <SelectItem value="called">Called</SelectItem>
                      <SelectItem value="in_progress">In Progress</SelectItem>
                      <SelectItem value="completed">Completed</SelectItem>
                      <SelectItem value="cancelled">Cancelled</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3">
              <label className="flex items-center gap-3 text-sm font-medium text-foreground">
                <Checkbox
                  id="queue-select-all-visible"
                  name="queueSelectAllVisible"
                  checked={allVisibleSelected ? true : hasPartialVisibleSelection ? "indeterminate" : false}
                  onCheckedChange={(checked) => handleToggleAllQueueSelection(checked === true)}
                  aria-label="Select all queue entries"
                  disabled={queueIds.length === 0 || isDeletingQueue}
                />
                Select all
              </label>
              <div className="flex items-center gap-3">
                <span className="text-xs text-gray-500">
                  {selectedQueueIds.length} selected
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-2 border-red-200 bg-white text-red-600 hover:bg-red-50 hover:text-red-700"
                  onClick={handleDeleteSelectedQueue}
                  disabled={selectedQueueIds.length === 0 || isDeletingQueue}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  {isDeletingQueue ? "Deleting..." : "Delete"}
                </Button>
              </div>
              </div>
            </div>
            <ScrollArea className="h-[50vh] pr-2">
              <div className="space-y-2">
                <AnimatePresence>
                  {filteredQueue.map((entry) => (
                    <motion.div
                      key={entry.id}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="bg-white/60 border border-black/5 p-3 rounded-xl flex items-center gap-4 shadow-sm"
                    >
                      <Checkbox
                        id={`queue-select-${entry.id}`}
                        name="queueSelection"
                        checked={selectedQueueIdSet.has(entry.id)}
                        onCheckedChange={(checked) => handleToggleQueueSelection(entry.id, checked === true)}
                        aria-label={`Select ${entry.queueNumber}`}
                        disabled={isDeletingQueue}
                      />
                      <div className="w-20 font-bold text-lg text-foreground">{entry.queueNumber}</div>
                      <div className="flex-1 min-w-0">
                        <div className="text-foreground font-medium text-sm truncate">{entry.fullName}</div>
                        <div className="text-gray-500 text-xs">
                          {entry.category} · {entry.workflow.replace("_", " ")}
                        </div>
                      </div>
                      <div className="text-xs text-right min-w-25">
                        {entry.assignedCounterName && (
                          <div className="text-gray-400">
                            <span className="text-gray-600">Eval:</span> {entry.assignedCounterName}
                          </div>
                        )}
                        {entry.taggerCounterName && (
                          <div className="text-gray-400">
                            <span className="text-gray-600">Tag:</span> {entry.taggerCounterName}
                          </div>
                        )}
                      </div>
                      <Badge
                        variant="outline"
                        className={`w-24 justify-center uppercase tracking-wider text-[10px] bg-white
                          ${entry.status === "completed" ? "text-green-600 bg-green-50" : ""}
                          ${entry.status === "in_progress" ? "text-primary bg-primary/10" : ""}
                          ${entry.status === "waiting" ? "text-yellow-600 bg-yellow-50" : ""}
                          ${entry.status === "called" ? "text-blue-600 bg-blue-50" : ""}
                        `}
                      >
                        {entry.status.replace("_", " ")}
                      </Badge>
                    </motion.div>
                  ))}
                </AnimatePresence>
                {filteredQueue.length === 0 && (
                  <div className="p-8 text-center text-sm text-gray-400">No queue records match your filters.</div>
                )}
              </div>
            </ScrollArea>
          </TabsContent>

          <TabsContent value="reports" className="m-0">
            <ReportsAnalytics reports={reports} />
          </TabsContent>

          <TabsContent value="queue-assistants" className="m-0">
            <QueueAssistantMonitoring rows={queueAssistantMonitoring} />
          </TabsContent>

          <TabsContent value="tv-media" className="m-0">
            <TvMediaManagerRedesigned
              items={tvMedia}
              isUploading={isUploadingTvMedia}
              onUpload={handleUploadTvMedia}
              onDelete={handleDeleteTvMedia}
              onUpdate={handleUpdateTvMedia}
              onReset={handleResetTvMedia}
              onMove={handleMoveTvMedia}
              audioEnabled={tvAudioEnabled}
              volume={tvVolume}
              isTvMuted={tvMuted}
              fullscreenEnabled={tvFullscreenEnabled}
              voiceAnnouncementEnabled={voiceAnnouncementEnabled}
              notificationSoundEnabled={notificationSoundEnabled}
              announcementVolume={announcementVolume}
              announcementVoiceName={announcementVoiceName}
              announcementVoiceId={announcementVoiceId}
              announcementVoiceGender={announcementVoiceGender}
              availableSpeechVoices={availableSpeechVoices}
              announcementChimeVolume={announcementChimeVolume}
              announcementTwice={announceTwice}
              voicePriorityBoost={voicePriorityBoost}
              announcementRate={announcementRate}
              announcementPitch={announcementPitch}
              autoPlay={tvAutoPlay}
              mediaTransitionType={mediaTransitionType}
              mediaTransitionDuration={mediaTransitionDuration}
              lunchBreakEnabled={lunchBreakEnabled}
              cutOffEnabled={cutOffEnabled}
              onToggleTvMute={handleToggleTvMute}
              onToggleAudioEnabled={handleToggleTvAudioEnabled}
              onVolumeChange={handleVolumeTvChange}
              onToggleFullscreen={handleToggleTvFullscreen}
              onToggleVoiceAnnouncement={handleToggleVoiceAnnouncement}
              onToggleNotificationSound={handleToggleNotificationSound}
              onAnnouncementVolumeChange={handleAnnouncementVolumeChange}
              onAnnouncementChimeVolumeChange={handleAnnouncementChimeVolumeChange}
              onToggleVoicePriorityBoost={handleVoicePriorityBoostChange}
              onToggleAnnouncementTwice={handleToggleAnnouncementTwice}
              onAnnouncementVoiceChange={handleAnnouncementVoiceChange}
              onAnnouncementRateChange={handleAnnouncementRateChange}
              onAnnouncementPitchChange={handleAnnouncementPitchChange}
              onTestVoice={handleTestVoice}
              onToggleAutoPlay={handleToggleTvAutoPlay}
              onMediaTransitionTypeChange={handleMediaTransitionTypeChange}
              onMediaTransitionDurationChange={handleMediaTransitionDurationChange}
              onToggleLunchBreak={handleToggleLunchBreak}
              onToggleCutOff={handleToggleCutOff}
              tvBrowserName={tvBrowserName}
              tvBrowserVersion={tvBrowserVersion}
              tvBrowserIsFirefox={tvBrowserIsFirefox}
              tvLastVoiceSync={tvLastVoiceSync}
              tvConnectedClients={tvConnectedClients}
              lastTvVoiceEventId={lastTvVoiceEventId}
              lastTvVoiceEventType={lastTvVoiceEventType}
              lastTvVoiceEventAt={lastTvVoiceEventAt}
              selectedTvVoiceAvailable={selectedTvVoiceAvailable}
            />
          </TabsContent>

          <TabsContent value="announcements" className="m-0 flex flex-col gap-4">
            <Card className="glass-card shrink-0">
              <CardHeader>
                <CardTitle className="text-base">Post Announcement</CardTitle>
              </CardHeader>
              <CardContent>
                <Form {...announcementForm}>
                  <form onSubmit={announcementForm.handleSubmit(handleCreateAnnouncement)} className="flex gap-3">
                    <FormField
                      control={announcementForm.control}
                      name="message"
                      render={({ field }) => (
                        <FormItem className="flex-1">
                          <FormControl>
                            <Input
                              placeholder="Enter announcement text for TV display..."
                              className="bg-white/50 border-black/10 text-foreground h-11"
                              {...field}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <Button type="submit" className="h-11 maroon-gradient px-6" disabled={createAnnouncementMutation.isPending}>
                      Broadcast
                    </Button>
                  </form>
                </Form>
              </CardContent>
            </Card>

            <ScrollArea className="h-[35vh] pr-2">
              <div className="space-y-3">
                <AnimatePresence>
                  {announcements?.map((a) => (
                    <motion.div
                      key={a.id}
                      initial={{ opacity: 0, x: -16 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, scale: 0.95 }}
                      className="bg-white/60 border border-black/5 p-4 rounded-xl flex justify-between items-center group shadow-sm"
                    >
                      <p className="text-foreground font-medium">{a.message}</p>
                      <div className="flex items-center gap-2 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="bg-white/70 border-black/10 text-foreground hover:bg-white"
                          onClick={() => void handleVoiceAnnounce(a)}
                        >
                          <Volume2 className="mr-2 h-4 w-4" />
                          Speak Once
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="text-red-500 hover:text-red-600 hover:bg-red-50"
                          onClick={() => handleDeleteAnnouncement(a.id)}
                        >
                          <XCircle className="w-4 h-4" />
                        </Button>
                      </div>
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
            </ScrollArea>
          </TabsContent>

          <TabsContent value="staff" className="m-0 flex flex-col lg:flex-row gap-6 h-full">
            <Card className="glass-card w-full lg:w-1/3 shrink-0 h-fit">
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2"><ShieldCheck className="w-5 h-5 text-primary"/> {editingStaffId ? "Edit Staff Member" : "Add Staff Member"}</CardTitle>
                <CardDescription>{editingStaffId ? "Update staff login and assignment." : "Create a new staff login and counter assignment."}</CardDescription>
              </CardHeader>
              <CardContent>
                <Form {...staffForm}>
                  <form onSubmit={staffForm.handleSubmit(handleSubmitStaff)} className="space-y-4">
                    <div className="grid grid-cols-2 gap-3">
                      <FormField control={staffForm.control} name="username" render={({ field }) => (
                        <FormItem>
                          <label htmlFor="staff-form-username" className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold">Username</label>
                          <FormControl><Input id="staff-form-username" placeholder="johndoe" className="bg-white/50" {...field} /></FormControl>
                          <FormMessage className="text-xs" />
                        </FormItem>
                      )} />
                      <FormField control={staffForm.control} name="pin" render={({ field }) => (
                        <FormItem>
                          <label htmlFor="staff-form-password" className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold">Password</label>
                          <FormControl><Input id="staff-form-password" type="password" placeholder="••••••••" className="bg-white/50" {...field} /></FormControl>
                          <FormMessage className="text-xs" />
                        </FormItem>
                      )} />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <FormField control={staffForm.control} name="name" render={({ field }) => (
                        <FormItem>
                          <label htmlFor="staff-form-counter-name" className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold">Counter Name</label>
                          <FormControl><Input id="staff-form-counter-name" placeholder="e.g. Evaluator 1" className="bg-white/50" {...field} /></FormControl>
                          <FormMessage className="text-xs" />
                        </FormItem>
                      )} />
                      <FormField control={staffForm.control} name="staffName" render={({ field }) => (
                        <FormItem>
                          <label htmlFor="staff-form-staff-name" className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold">Staff Name</label>
                          <FormControl><Input id="staff-form-staff-name" placeholder="Optional" className="bg-white/50" {...field} value={field.value || ""} /></FormControl>
                          <FormMessage className="text-xs" />
                        </FormItem>
                      )} />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <FormField control={staffForm.control} name="type" render={({ field }) => (
                        <FormItem>
                          <label htmlFor="staff-form-role" className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold">Role</label>
                          <Select onValueChange={field.onChange} defaultValue={field.value}>
                            <FormControl>
                              <SelectTrigger id="staff-form-role" className="bg-white/50"><SelectValue placeholder="Select role" /></SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value="evaluator">Evaluator</SelectItem>
                              <SelectItem value="tagger">Tagger</SelectItem>
                              <SelectItem value="hybrid">Hybrid</SelectItem>
                              <SelectItem value="queue_assistant">Queue Assistant</SelectItem>
                            </SelectContent>
                          </Select>
                          <FormMessage className="text-xs" />
                        </FormItem>
                      )} />
                      <FormField control={staffForm.control} name="specialization" render={({ field }) => (
                        <FormItem>
                          <label htmlFor="staff-form-specialization" className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold">Specialization</label>
                          <FormControl><Input id="staff-form-specialization" placeholder="e.g. Regular Only" className="bg-white/50" {...field} value={field.value || ""} /></FormControl>
                          <FormMessage className="text-xs" />
                        </FormItem>
                      )} />
                    </div>
                    <div className="flex gap-2 mt-2">
                      <Button type="submit" className="flex-1 maroon-gradient" disabled={createCounterMutation.isPending || updateCounterMutation.isPending}>
                        {createCounterMutation.isPending || updateCounterMutation.isPending ? "Saving..." : editingStaffId ? "Update Staff Member" : "Create Staff Member"}
                      </Button>
                      {editingStaffId && (
                        <Button 
                          type="button" 
                          variant="outline" 
                          onClick={() => { setEditingStaffId(null); staffForm.reset({ name: "", staffName: "", username: "", pin: "", type: "evaluator", specialization: "" }); }}
                        >
                          Cancel
                        </Button>
                      )}
                    </div>
                  </form>
                </Form>
              </CardContent>
            </Card>

            <Card className="glass-card flex-1 flex flex-col min-h-0">
              <CardHeader className="pb-3 border-b border-black/5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <CardTitle className="text-base flex items-center gap-3">
                    Staff Directory
                    <Badge variant="outline" className="bg-white text-gray-500">{counters?.length ?? 0} Total</Badge>
                  </CardTitle>
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="relative">
                      <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
                      <Input
                        value={staffSearch}
                        onChange={(event) => setStaffSearch(event.target.value)}
                        placeholder="Search staff..."
                        className="h-9 w-56 bg-white/70 pl-9 text-sm"
                      />
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-2 border-red-200 bg-white text-red-600 hover:bg-red-50 hover:text-red-700"
                      onClick={handleDeleteSelectedStaff}
                      disabled={selectedStaffIds.length === 0 || deleteCounterMutation.isPending}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      {deleteCounterMutation.isPending ? "Deleting..." : "Delete Selected"}
                    </Button>
                  </div>
                </div>
                <div className="mt-3 flex items-center justify-between rounded-lg border border-black/5 bg-white/40 px-3 py-2">
                  <label className="flex items-center gap-3 text-sm font-medium text-foreground">
                    <Checkbox
                      id="staff-select-all-visible"
                      name="staffSelectAllVisible"
                      checked={allVisibleStaffSelected ? true : hasPartialVisibleStaffSelection ? "indeterminate" : false}
                      onCheckedChange={(checked) => handleToggleAllStaffSelection(checked === true)}
                      aria-label="Select all staff records"
                      disabled={staffIds.length === 0 || deleteCounterMutation.isPending}
                    />
                    Select all visible
                  </label>
                  <span className="text-xs text-gray-500">{selectedStaffIds.length} selected</span>
                </div>
              </CardHeader>
              <CardContent className="flex-1 p-0 overflow-y-auto">
                <div className="divide-y divide-black/5">
                  {filteredStaff.map((staff) => (
                    <div key={staff.id} className="p-4 flex items-center justify-between hover:bg-white/40 transition-colors cursor-pointer" onClick={() => handleEditStaff(staff)}>
                      <div className="flex items-center gap-4">
                        <div onClick={(e) => e.stopPropagation()}>
                          <Checkbox
                            id={`staff-select-${staff.id}`}
                            name="staffSelection"
                            checked={selectedStaffIdSet.has(staff.id)}
                            onCheckedChange={(checked) => handleToggleStaffSelection(staff.id, checked === true)}
                            aria-label={`Select ${staff.name}`}
                            disabled={deleteCounterMutation.isPending}
                          />
                        </div>
                        <div className={`w-10 h-10 rounded-full flex items-center justify-center ${staff.type === 'evaluator' ? 'bg-blue-100 text-blue-600' : staff.type === 'tagger' ? 'bg-orange-100 text-orange-600' : 'bg-purple-100 text-purple-600'}`}>
                          {staff.type === 'evaluator' ? <Users className="w-5 h-5" /> : <Tag className="w-5 h-5" />}
                        </div>
                        <div>
                          <div className="font-semibold text-foreground flex items-center gap-2">
                            {staff.name}
                            {staff.username && <span className="text-xs font-normal text-gray-400">@{staff.username}</span>}
                          </div>
                          <div className="text-xs text-gray-500 flex gap-2 mt-0.5">
                            <span className="uppercase tracking-wider font-medium">{staff.type}</span>
                            {staff.staffName && <span>· {staff.staffName}</span>}
                            {staff.specialization && <span>· {staff.specialization}</span>}
                          </div>
                        </div>
                      </div>
                      <Badge variant="outline" className={`bg-white ${staff.isActive ? 'text-green-600 border-green-200' : 'text-gray-400 border-gray-200'}`}>
                        {staff.isActive ? 'Active' : 'Disabled'}
                      </Badge>
                    </div>
                  ))}
                  {filteredStaff.length === 0 && (
                    <div className="p-8 text-center text-gray-400">No staff members match your search.</div>
                  )}
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
}

function StatCard({ title, value, icon }: { title: string; value: number; icon: React.ReactNode }) {
  return (
    <Card className="glass-card">
      <CardContent className="p-5 flex items-center justify-between">
        <div>
          <p className="text-gray-500 uppercase tracking-widest text-[10px] font-semibold mb-1">{title}</p>
          <div className="text-3xl font-bold text-foreground">{value}</div>
        </div>
        <div className="w-10 h-10 rounded-xl bg-white/50 border border-black/5 flex items-center justify-center shadow-sm">{icon}</div>
      </CardContent>
    </Card>
  );
}

function ReportsAnalytics({ reports }: { reports: ReportRow[] }) {
  const enrolledReports = reports.filter((row) => row.metricType === "enrolled");
  const evaluatedReports = reports.filter((row) => row.metricType === "evaluated");
  const taggerReports = enrolledReports.filter((row) => row.counterType === "tagger");
  const hybridReports = enrolledReports.filter((row) => row.counterType === "hybrid");

  const sum = (rows: ReportRow[], field: "today" | "thisWeek" | "thisMonth" | "allTime") =>
    rows.reduce((total, row) => total + row[field], 0);

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <ReportSummaryGroup
          title="Tagger Enrollment"
          description="Students who completed tagging"
          label="Enrolled"
          rows={taggerReports}
          sum={sum}
        />
        <ReportSummaryGroup
          title="Evaluator Activity"
          description="Students evaluated only"
          label="Evaluated"
          rows={evaluatedReports}
          sum={sum}
        />
        <ReportSummaryGroup
          title="Hybrid Enrollment"
          description="Tagging completions only"
          label="Enrolled"
          rows={hybridReports}
          sum={sum}
        />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        <ReportTable title="Tagger & Hybrid Enrollment Totals" label="Enrolled" rows={enrolledReports} />
        <ReportTable title="Evaluator Evaluation Totals" label="Evaluated" rows={evaluatedReports} />
      </div>
    </div>
  );
}

function ReportSummaryGroup({
  title,
  description,
  label,
  rows,
  sum,
}: {
  title: string;
  description: string;
  label: string;
  rows: ReportRow[];
  sum: (rows: ReportRow[], field: "today" | "thisWeek" | "thisMonth" | "allTime") => number;
}) {
  return (
    <Card className="glass-card">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-2">
          {[
            ["Today", sum(rows, "today")],
            ["This Week", sum(rows, "thisWeek")],
            ["This Month", sum(rows, "thisMonth")],
            ["All Time", sum(rows, "allTime")],
          ].map(([period, value]) => (
            <div key={period} className="rounded-lg border border-black/5 bg-white/50 p-3">
              <div className="text-[10px] uppercase tracking-wider text-gray-500">{period}</div>
              <div className="text-2xl font-bold text-foreground">{value}</div>
              <div className="text-[10px] text-gray-400">{label}</div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function ReportTable({ title, label, rows }: { title: string; label: string; rows: ReportRow[] }) {
  return (
    <Card className="glass-card">
      <CardHeader className="pb-3 border-b border-black/5">
        <CardTitle className="text-base flex items-center justify-between">
          {title}
          <Badge variant="outline" className="bg-white text-gray-500">{rows.length} Staff</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-white/40 text-xs uppercase tracking-wider text-gray-500">
              <tr>
                <th className="p-3 text-left font-semibold">Staff</th>
                <th className="p-3 text-left font-semibold">Role</th>
                <th className="p-3 text-right font-semibold">Today</th>
                <th className="p-3 text-right font-semibold">Week</th>
                <th className="p-3 text-right font-semibold">Month</th>
                <th className="p-3 text-right font-semibold">All Time</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black/5">
              {rows.map((row) => (
                <tr key={`${row.counterType}-${row.counterId}`} className="hover:bg-white/40">
                  <td className="p-3">
                    <div className="font-semibold text-foreground">{row.staffName || row.counterName}</div>
                    {row.staffName && <div className="text-xs text-gray-400">{row.counterName}</div>}
                  </td>
                  <td className="p-3">
                    <Badge variant="outline" className="bg-white text-gray-500 capitalize">{row.counterType}</Badge>
                  </td>
                  <td className="p-3 text-right font-semibold">{row.today}</td>
                  <td className="p-3 text-right font-semibold">{row.thisWeek}</td>
                  <td className="p-3 text-right font-semibold">{row.thisMonth}</td>
                  <td className="p-3 text-right font-semibold">{row.allTime}</td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td className="p-8 text-center text-gray-400" colSpan={6}>
                    No {label.toLowerCase()} records yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

function QueueAssistantMonitoring({ rows }: { rows: QueueAssistantMonitorRow[] }) {
  return (
    <Card className="glass-card">
      <CardHeader className="pb-3 border-b border-black/5">
        <CardTitle className="text-base flex items-center justify-between">
          Queue Assistant Monitoring
          <Badge variant="outline" className="bg-white text-gray-500">{rows.length} Assistants</Badge>
        </CardTitle>
        <CardDescription>Walk-in queue generation activity and recent manually registered students.</CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        <div className="divide-y divide-black/5">
          {rows.map((row) => (
            <div key={row.assistantId} className="grid gap-4 p-4 xl:grid-cols-[260px_1fr]">
              <div>
                <div className="font-semibold text-foreground">{row.assistantName}</div>
                <div className="text-xs text-gray-500">{row.counterName}</div>
                <Badge variant="outline" className={`mt-2 capitalize ${row.currentStatus === "online" ? "border-green-200 bg-green-50 text-green-700" : "bg-white text-gray-500"}`}>
                  {row.currentStatus}
                </Badge>
                <div className="mt-3 text-xs text-gray-500">
                  Last Login: {row.lastLogin ? new Date(row.lastLogin).toLocaleString() : "Never"}
                </div>
              </div>
              <div className="grid gap-4">
                <div className="grid grid-cols-3 gap-3">
                  <div className="rounded-lg border border-black/5 bg-white/50 p-3">
                    <div className="text-[10px] uppercase tracking-wider text-gray-500">Today</div>
                    <div className="text-2xl font-bold text-primary">{row.generatedQueuesToday}</div>
                  </div>
                  <div className="rounded-lg border border-black/5 bg-white/50 p-3">
                    <div className="text-[10px] uppercase tracking-wider text-gray-500">This Week</div>
                    <div className="text-2xl font-bold text-primary">{row.generatedQueuesThisWeek}</div>
                  </div>
                  <div className="rounded-lg border border-black/5 bg-white/50 p-3">
                    <div className="text-[10px] uppercase tracking-wider text-gray-500">This Month</div>
                    <div className="text-2xl font-bold text-primary">{row.generatedQueuesThisMonth}</div>
                  </div>
                </div>
                <div className="rounded-lg border border-black/5 bg-white/40">
                  {row.recentQueues.length > 0 ? row.recentQueues.map((queue) => (
                    <div key={`${queue.queueNumber}-${queue.createdAt}`} className="grid grid-cols-[120px_1fr_120px_180px] gap-3 border-b border-black/5 p-3 text-sm last:border-0">
                      <span className="font-bold text-primary">{queue.queueNumber}</span>
                      <span className="font-medium text-foreground">{queue.studentName}</span>
                      <span className="capitalize text-gray-600">{queue.status.replace("_", " ")}</span>
                      <span className="text-gray-500">{new Date(queue.createdAt).toLocaleString()}</span>
                    </div>
                  )) : (
                    <div className="p-4 text-sm text-gray-400">No generated queues yet.</div>
                  )}
                </div>
              </div>
            </div>
          ))}
          {rows.length === 0 && <div className="p-8 text-center text-gray-400">No Queue Assistant accounts yet.</div>}
        </div>
      </CardContent>
    </Card>
  );
}

function TvMediaManagerRedesigned({
  items,
  isUploading,
  onUpload,
  onDelete,
  onUpdate,
  onReset,
  onMove,
  audioEnabled,
  volume,
  isTvMuted,
  fullscreenEnabled,
  voiceAnnouncementEnabled,
  notificationSoundEnabled,
  announcementVolume,
  announcementVoiceName,
  announcementVoiceId,
  announcementVoiceGender,
  availableSpeechVoices,
  tvBrowserName,
  tvBrowserVersion,
  tvBrowserIsFirefox,
  tvLastVoiceSync,
  tvConnectedClients,
  lastTvVoiceEventId,
  lastTvVoiceEventType,
  lastTvVoiceEventAt,
  selectedTvVoiceAvailable,
  announcementRate,
  announcementPitch,
  announcementTwice,
  announcementChimeVolume,
  voicePriorityBoost,
  autoPlay,
  mediaTransitionType,
  mediaTransitionDuration,
  lunchBreakEnabled,
  cutOffEnabled,
  onToggleTvMute,
  onToggleAudioEnabled,
  onVolumeChange,
  onToggleFullscreen,
  onToggleVoiceAnnouncement,
  onToggleNotificationSound,
  onAnnouncementVolumeChange,
  onAnnouncementChimeVolumeChange = () => {},
  onToggleVoicePriorityBoost = () => {},
  onToggleAnnouncementTwice = () => {},
  onAnnouncementVoiceChange,
  onAnnouncementRateChange,
  onAnnouncementPitchChange,
  onTestVoice,
  onToggleAutoPlay,
  onMediaTransitionTypeChange,
  onMediaTransitionDurationChange,
  onToggleLunchBreak,
  onToggleCutOff,
}: {
  items: TvMediaItem[];
  isUploading: boolean;
  onUpload: (file: File) => void;
  onDelete: (id: string) => void;
  onUpdate: (id: string, updated: Partial<TvMediaItem>) => void;
  onReset: (id: string) => void;
  onMove: (id: string, direction: "up" | "down") => void;
  audioEnabled: boolean;
  volume: number;
  isTvMuted: boolean;
  fullscreenEnabled: boolean;
  voiceAnnouncementEnabled: boolean;
  notificationSoundEnabled: boolean;
  announcementVolume: number;
  announcementVoiceName: string;
  announcementVoiceId: string;
  announcementVoiceGender: AnnouncementVoiceGender;
  availableSpeechVoices: SpeechSynthesisVoice[];
  tvBrowserName?: string;
  tvBrowserVersion?: string;
  tvBrowserIsFirefox?: boolean;
  tvLastVoiceSync?: string;
  tvConnectedClients?: number;
  lastTvVoiceEventId?: string;
  lastTvVoiceEventType?: string;
  lastTvVoiceEventAt?: string;
  selectedTvVoiceAvailable: boolean;
  announcementRate: number;
  announcementPitch: number;
  announcementTwice: boolean;
  announcementChimeVolume: number;
  voicePriorityBoost: boolean;
  autoPlay: boolean;
  mediaTransitionType: MediaTransitionType;
  mediaTransitionDuration: number;
  lunchBreakEnabled: boolean;
  cutOffEnabled: boolean;
  onToggleTvMute: (event?: React.MouseEvent<HTMLButtonElement>) => void;
  onToggleAudioEnabled: () => void;
  onVolumeChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onToggleFullscreen: (event?: React.MouseEvent<HTMLButtonElement>) => void;
  onToggleVoiceAnnouncement: () => void;
  onToggleNotificationSound: () => void;
  onAnnouncementVolumeChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onAnnouncementChimeVolumeChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onToggleVoicePriorityBoost: () => void;
  onToggleAnnouncementTwice: () => void;
  onAnnouncementVoiceChange: (value: string) => void;
  onAnnouncementRateChange: (value: string) => void;
  onAnnouncementPitchChange: (value: string) => void;
  onTestVoice: () => void;
  onToggleAutoPlay: () => void;
  onMediaTransitionTypeChange: (value: string) => void;
  onMediaTransitionDurationChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onToggleLunchBreak: () => void;
  onToggleCutOff: () => void;
}) {
  const safeAnnouncementChimeVolumeChange = onAnnouncementChimeVolumeChange ?? (() => {});
  const orderedItems = useMemo(() => [...items].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)), [items]);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [selectedId, setSelectedId] = useState<string | null>(orderedItems[0]?.id ?? null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [metadata, setMetadata] = useState<Record<string, { duration?: number; resolution?: string }>>({});
  const femaleVoices = availableSpeechVoices.filter((voice) => inferAnnouncementVoiceGender(voice.name) === "female");
  const maleVoices = availableSpeechVoices.filter((voice) => inferAnnouncementVoiceGender(voice.name) === "male");
  const pitchLabel = getPitchLabel(announcementPitch);

  useEffect(() => {
    if (!selectedId && orderedItems.length > 0) setSelectedId(orderedItems[0].id);
    if (selectedId && !orderedItems.some((item) => item.id === selectedId)) setSelectedId(orderedItems[0]?.id ?? null);
  }, [orderedItems, selectedId]);

  const filteredItems = orderedItems.filter((item) => {
    const term = search.trim().toLowerCase();
    const matchesSearch = !term || item.name.toLowerCase().includes(term);
    const matchesFilter =
      filter === "all" ||
      (filter === "videos" && item.type === "video") ||
      (filter === "images" && item.type === "image") ||
      (filter === "enabled" && item.enabled !== false) ||
      (filter === "disabled" && item.enabled === false);
    return matchesSearch && matchesFilter;
  });
  const selectedItem = orderedItems.find((item) => item.id === selectedId) ?? filteredItems[0] ?? null;
  const editingItem = orderedItems.find((item) => item.id === editingId) ?? null;

  useEffect(() => {
    console.info("TV media rendered in Admin", {
      playlistCount: orderedItems.length,
      filteredCount: filteredItems.length,
      renderedCount: filteredItems.length,
      filter,
      search: search.trim(),
      enabledCount: orderedItems.filter((item) => item.enabled !== false).length,
      videoCount: orderedItems.filter((item) => item.type === "video").length,
      imageCount: orderedItems.filter((item) => item.type === "image").length,
    });
  }, [filter, filteredItems, orderedItems, search]);

  const rememberMetadata = (item: TvMediaItem, element: HTMLVideoElement | HTMLImageElement) => {
    const next =
      element instanceof HTMLVideoElement
        ? {
            duration: Number.isFinite(element.duration) ? element.duration : undefined,
            resolution: element.videoWidth && element.videoHeight ? `${element.videoWidth} x ${element.videoHeight}` : undefined,
          }
        : {
            resolution: element.naturalWidth && element.naturalHeight ? `${element.naturalWidth} x ${element.naturalHeight}` : undefined,
          };
    setMetadata((current) => ({ ...current, [item.id]: { ...current[item.id], ...next } }));
  };

  const formatDuration = (seconds?: number) => {
    if (!seconds) return "Unknown";
    const minutes = Math.floor(seconds / 60);
    const remaining = Math.floor(seconds % 60).toString().padStart(2, "0");
    return `${minutes}:${remaining}`;
  };

  const renderPreviewMedia = (item: TvMediaItem, compact = false) => (
    <div className={`relative overflow-hidden rounded-lg border border-black/10 bg-black ${compact ? "aspect-video" : "aspect-video"}`}>
      {item.type === "video" ? (
        <video
          src={item.url}
          className="h-full w-full"
          style={getMediaDisplayStyle(item)}
          muted={getVideoMuted(item)}
          controls={!compact}
          onLoadedMetadata={(event) => {
            event.currentTarget.volume = Math.min(1, getVideoVolumeLevel(item));
            rememberMetadata(item, event.currentTarget);
          }}
        />
      ) : (
        <img
          src={item.url}
          alt={item.name}
          className="h-full w-full"
          style={getMediaDisplayStyle(item)}
          onLoad={(event) => rememberMetadata(item, event.currentTarget)}
        />
      )}
    </div>
  );

  return (
    <div className="grid gap-5">
      <Card className="glass-card">
        <CardHeader className="pb-3 border-b border-black/5">
          <CardTitle className="text-base flex items-center gap-2">
            <Upload className="h-4 w-4 text-primary" />
            TV Settings
          </CardTitle>
          <CardDescription>Global display, audio, voice, autoplay, and transition controls.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-5 p-5 xl:grid-cols-[1fr_1fr_320px]">
          <div className="grid gap-4">
            <div className="flex items-center justify-between gap-3 rounded-lg border border-black/5 bg-white/50 p-3">
              <label htmlFor="tv-media-audio-enabled" className="text-sm font-medium">Enable TV Audio</label>
              <Switch id="tv-media-audio-enabled" name="tvMediaAudioEnabled" checked={audioEnabled} onCheckedChange={onToggleAudioEnabled} />
            </div>
            <div className="grid gap-2 rounded-lg border border-black/5 bg-white/50 p-3">
              <div className="flex items-center justify-between">
                <label htmlFor="tv-media-master-volume" className="text-sm font-medium">Master Volume</label>
                <span className="text-sm text-gray-600">{Math.round(volume * 100)}%</span>
              </div>
              <input id="tv-media-master-volume" name="tvMediaMasterVolume" type="range" min={0} max={1} step={0.01} value={volume} onChange={onVolumeChange} />
              <Button type="button" variant={isTvMuted ? "outline" : "default"} className={isTvMuted ? "justify-center text-gray-500" : "justify-center bg-primary text-white hover:bg-primary/90"} onClick={onToggleTvMute}>
                {isTvMuted ? <VolumeX className="mr-2 h-4 w-4" /> : <Volume2 className="mr-2 h-4 w-4" />}
                {isTvMuted ? "Muted" : "Unmuted"}
              </Button>
            </div>
          </div>

          <div className="grid gap-4">
            <div className="flex items-center justify-between gap-3 rounded-lg border border-black/5 bg-white/50 p-3">
              <label htmlFor="tv-media-voice-announcement" className="text-sm font-medium">Voice Announcement</label>
              <Switch id="tv-media-voice-announcement" name="tvMediaVoiceAnnouncementEnabled" checked={voiceAnnouncementEnabled} onCheckedChange={onToggleVoiceAnnouncement} />
            </div>
            <div className="flex items-center justify-between gap-3 rounded-lg border border-black/5 bg-white/50 p-3">
              <label htmlFor="tv-media-notification-sound" className="text-sm font-medium">Notification Sound</label>
              <Switch id="tv-media-notification-sound" name="tvMediaNotificationSoundEnabled" checked={notificationSoundEnabled} onCheckedChange={onToggleNotificationSound} />
            </div>
            <div className="flex items-center justify-between gap-3 rounded-lg border border-black/5 bg-white/50 p-3">
              <label htmlFor="tv-media-announce-twice" className="text-sm font-medium">Announce Twice</label>
              <Switch id="tv-media-announce-twice" name="tvMediaAnnounceTwice" checked={announcementTwice} onCheckedChange={onToggleAnnouncementTwice} />
            </div>
            <div className="grid gap-2 rounded-lg border border-black/5 bg-white/50 p-3">
              <div className="flex items-center justify-between">
                <label htmlFor="tv-media-announcement-volume" className="text-sm font-medium">Announcement Volume</label>
                <span className="text-sm text-gray-600">{Math.round(announcementVolume * 100)}%</span>
              </div>
              <input id="tv-media-announcement-volume" name="tvMediaAnnouncementVolume" type="range" min={0} max={1} step={0.01} value={announcementVolume} onChange={onAnnouncementVolumeChange} />
              <div className="grid gap-2">
                <div className="flex flex-col gap-2 text-sm text-gray-600">
                  <div className="flex items-center justify-between">
                    <span>Active Voice</span>
                    <span className="text-right text-xs font-medium text-gray-700">{getAnnouncementVoiceLabel(announcementVoiceName, announcementVoiceGender)}</span>
                  </div>
                  {availableSpeechVoices.length > 0 ? (
                    <div className="grid gap-2">
                      <label htmlFor="tv-media-voice-select" className="text-sm font-medium text-gray-700">Choose Voice</label>
                      <Select value={announcementVoiceId} onValueChange={onAnnouncementVoiceChange}>
                        <SelectTrigger id="tv-media-voice-select" className="bg-white/60"><SelectValue placeholder="Select a voice" /></SelectTrigger>
                        <SelectContent>
                          {availableSpeechVoices.map((voice) => {
                            const voiceId = getAnnouncementVoiceId(voice);
                            return (
                              <SelectItem key={voiceId} value={voiceId}>
                                {voice.name}{voice.lang ? ` (${voice.lang})` : ""}
                              </SelectItem>
                            );
                          })}
                        </SelectContent>
                      </Select>
                    </div>
                  ) : null}
                  {tvBrowserName && (
                    <div className="text-xs text-gray-500">
                      TV browser: {tvBrowserName}{tvBrowserVersion ? ` (${tvBrowserVersion})` : ""}
                    </div>
                  )}
                  <div className="grid gap-1 text-xs text-gray-500">
                    <div>Connected TV clients: {typeof tvConnectedClients === "number" ? tvConnectedClients : "Unknown"}</div>
                    <div>TV detected voices: {availableSpeechVoices.length}</div>
                    <div>Active voice: {announcementVoiceName || "Default English US voice"}</div>
                    <div>Audio enabled: {audioEnabled ? "Yes" : "No"}</div>
                    {tvLastVoiceSync ? <div>Last TV voice sync: {new Date(tvLastVoiceSync).toLocaleString()}</div> : null}
                    {lastTvVoiceEventId ? <div>Last voice event: {lastTvVoiceEventId}</div> : null}
                    {lastTvVoiceEventType ? <div>Last voice event type: {lastTvVoiceEventType}</div> : null}
                    {lastTvVoiceEventAt ? <div>Last voice event time: {new Date(lastTvVoiceEventAt).toLocaleString()}</div> : null}
                  </div>
                </div>
                {!selectedTvVoiceAvailable && announcementVoiceId ? (
                  <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
                    Selected voice is not available on the active TV browser. Choose a voice from TV Device Available Voices.
                  </div>
                ) : null}
                {availableSpeechVoices.length === 0 ? (
                  <div className="rounded-md border border-dashed border-black/10 bg-white/70 px-3 py-2 text-xs text-gray-500">No English US TV browser voices detected. Connect the TV Display and refresh this page.</div>
                ) : (
                  <div className="grid gap-2">
                    <div className="text-xs uppercase tracking-wide text-gray-500">TV Device Available Voices</div>
                    {femaleVoices.length > 0 && (
                      <div className="grid gap-1">
                        <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">Female Voices</span>
                        {femaleVoices.map((voice) => {
                          const voiceId = getAnnouncementVoiceId(voice);
                          return (
                            <Button
                              key={voiceId}
                              type="button"
                              variant={announcementVoiceId === voiceId ? "default" : "outline"}
                              className={announcementVoiceId === voiceId ? "justify-start bg-primary text-white hover:bg-primary/90" : "justify-start bg-white/70 text-gray-700"}
                              onClick={() => onAnnouncementVoiceChange(voiceId)}
                            >
                              {voice.name}
                            </Button>
                          );
                        })}
                      </div>
                    )}
                    {maleVoices.length > 0 && (
                      <div className="grid gap-1">
                        <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">Male Voices</span>
                        {maleVoices.map((voice) => {
                          const voiceId = getAnnouncementVoiceId(voice);
                          return (
                            <Button
                              key={voiceId}
                              type="button"
                              variant={announcementVoiceId === voiceId ? "default" : "outline"}
                              className={announcementVoiceId === voiceId ? "justify-start bg-primary text-white hover:bg-primary/90" : "justify-start bg-white/70 text-gray-700"}
                              onClick={() => onAnnouncementVoiceChange(voiceId)}
                            >
                              {voice.name}
                            </Button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>
              <div className="grid gap-1">
                <div className="flex items-center justify-between text-sm text-gray-600">
                  <label htmlFor="tv-media-announcement-chime-volume">Announcement Chime Volume</label>
                  <span>{Math.round(announcementChimeVolume * 100)}%</span>
                </div>
                <input id="tv-media-announcement-chime-volume" name="tvMediaAnnouncementChimeVolume" type="range" min={0} max={1} step={0.01} value={announcementChimeVolume} onChange={safeAnnouncementChimeVolumeChange} />
              </div>
              <div className="grid gap-1 rounded-lg border border-black/5 bg-white/60 p-3">
                <div className="flex items-center justify-between text-sm text-gray-600">
                  <label htmlFor="tv-media-voice-priority-boost">Voice Priority Boost</label>
                  <Switch id="tv-media-voice-priority-boost" name="tvMediaVoicePriorityBoost" checked={voicePriorityBoost} onCheckedChange={onToggleVoicePriorityBoost} />
                </div>
                <p className="text-xs text-gray-500">When enabled, media audio ducks or mutes while chime and voice announcements play.</p>
              </div>
              <div className="grid gap-1">
                <div className="flex items-center justify-between text-sm text-gray-600">
                  <span>Voice Speed</span>
                  <span>{announcementRate.toFixed(2).replace(/\.00$/, ".0")}x</span>
                </div>
                <Select value={String(announcementRate)} onValueChange={onAnnouncementRateChange}>
                  <SelectTrigger className="bg-white/60"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="0.75">0.75x</SelectItem>
                    <SelectItem value="1">1.0x</SelectItem>
                    <SelectItem value="1.25">1.25x</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1">
                <div className="flex items-center justify-between text-sm text-gray-600">
                  <span>Voice Pitch</span>
                  <span className="capitalize">{pitchLabel}</span>
                </div>
                <Select value={pitchLabel} onValueChange={onAnnouncementPitchChange}>
                  <SelectTrigger className="bg-white/60"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">Low</SelectItem>
                    <SelectItem value="normal">Normal</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button type="button" variant="outline" className="justify-center bg-white/70" onClick={onTestVoice}>
                <PlayCircle className="mr-2 h-4 w-4" />
                Test Voice
              </Button>
            </div>
          </div>

          <div className="grid gap-4">
            <div className="grid gap-3 rounded-lg border border-black/5 bg-white/50 p-3 md:grid-cols-2">
              <a href="/tv" target="_blank" rel="noopener noreferrer" className="block rounded-md border border-black/10 bg-white/70 p-3 transition-colors hover:bg-white">
                <div className="text-sm font-semibold text-foreground">Full TV Display</div>
                <div className="mt-1 text-xs text-gray-500">For modern browsers / PC / Smart TV Chrome</div>
              </a>
              <a href="/tv-lite" target="_blank" rel="noopener noreferrer" className="block rounded-md border border-black/10 bg-white/70 p-3 transition-colors hover:bg-white">
                <div className="text-sm font-semibold text-foreground">TV Lite Display</div>
                <div className="mt-1 text-xs text-gray-500">For low-end Android TV boxes</div>
              </a>
            </div>
            <div className="flex items-center justify-between gap-3 rounded-lg border border-black/5 bg-white/50 p-3">
              <span className="text-sm font-medium">Full Screen Mode</span>
              <Button type="button" variant={fullscreenEnabled ? "default" : "outline"} className={fullscreenEnabled ? "bg-primary text-white hover:bg-primary/90" : "text-gray-600"} onClick={onToggleFullscreen}>
                {fullscreenEnabled ? <Minimize2 className="mr-2 h-4 w-4" /> : <Maximize2 className="mr-2 h-4 w-4" />}
                {fullscreenEnabled ? "Disable" : "Enable"}
              </Button>
            </div>
            <div className="flex items-center justify-between gap-3 rounded-lg border border-black/5 bg-white/50 p-3">
              <label htmlFor="tv-media-auto-play" className="text-sm font-medium">Auto Play</label>
              <Switch id="tv-media-auto-play" name="tvMediaAutoPlay" checked={autoPlay} onCheckedChange={onToggleAutoPlay} />
            </div>
            <div className="flex items-center justify-between gap-3 rounded-lg border border-black/5 bg-white/50 p-3">
              <span className="text-sm font-medium">Lunch Break</span>
              <Button type="button" variant={lunchBreakEnabled ? "default" : "outline"} className={lunchBreakEnabled ? "bg-primary text-white hover:bg-primary/90" : "text-gray-600"} onClick={onToggleLunchBreak}>
                {lunchBreakEnabled ? "End Lunch Break" : "Start Lunch Break"}
              </Button>
            </div>
            <div className="flex items-center justify-between gap-3 rounded-lg border border-black/5 bg-white/50 p-3">
              <span className="text-sm font-medium">Cut Off</span>
              <Button type="button" variant={cutOffEnabled ? "default" : "outline"} className={cutOffEnabled ? "bg-primary text-white hover:bg-primary/90" : "text-gray-600"} onClick={onToggleCutOff}>
                {cutOffEnabled ? "End Cut Off" : "Start Cut Off"}
              </Button>
            </div>
            <div className="grid gap-2 rounded-lg border border-black/5 bg-white/50 p-3">
              <span className="text-sm font-medium">Media Transition Type</span>
              <Select value={mediaTransitionType} onValueChange={onMediaTransitionTypeChange}>
                <SelectTrigger className="bg-white/60"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="fade">Fade</SelectItem>
                  <SelectItem value="slide">Slide</SelectItem>
                  <SelectItem value="none">None</SelectItem>
                </SelectContent>
              </Select>
              <div className="flex items-center justify-between text-sm text-gray-600">
                <label htmlFor="tv-media-transition-duration">Media Transition Duration</label>
                <span>{mediaTransitionDuration.toFixed(1)}s</span>
              </div>
              <input id="tv-media-transition-duration" name="tvMediaTransitionDuration" type="range" min={0} max={5} step={0.1} value={mediaTransitionDuration} onChange={onMediaTransitionDurationChange} />
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-5 xl:grid-cols-[1fr_340px]">
        <Card className="glass-card">
          <CardHeader className="border-b border-black/5 pb-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <CardTitle className="text-base">Media Playlist</CardTitle>
                <CardDescription>{items.length} uploaded media files</CardDescription>
              </div>
              <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-primary/30 bg-white/60 px-4 py-2 text-sm font-semibold text-primary hover:bg-white">
                <Upload className="h-4 w-4" />
                {isUploading ? "Uploading..." : "Upload"}
                <input
                  id="tv-media-upload"
                  name="tvMediaUpload"
                  type="file"
                  accept="video/*,image/*"
                  className="hidden"
                  disabled={isUploading}
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.target.value = "";
                    if (file) onUpload(file);
                  }}
                />
              </label>
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-[1fr_180px]">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                <Input id="tv-media-search" name="tvMediaSearch" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search media" className="bg-white/60 pl-9" />
              </div>
              <Select value={filter} onValueChange={setFilter}>
                <SelectTrigger className="bg-white/60"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="videos">Videos</SelectItem>
                  <SelectItem value="images">Images</SelectItem>
                  <SelectItem value="enabled">Enabled</SelectItem>
                  <SelectItem value="disabled">Disabled</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardHeader>
          <CardContent className="p-4">
            <div className="grid gap-3">
              {filteredItems.map((item, index) => (
                <div key={item.id} className={`grid gap-3 rounded-lg border p-3 transition-colors lg:grid-cols-[150px_1fr_auto] ${selectedItem?.id === item.id ? "border-primary/40 bg-primary/5" : "border-black/5 bg-white/50 hover:bg-white/70"}`} onClick={() => setSelectedId(item.id)}>
                  {renderPreviewMedia(item, true)}
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="truncate text-sm font-semibold text-foreground">{item.name}</div>
                      <Badge variant="outline" className="bg-white capitalize">{item.type}</Badge>
                      <Badge variant="outline" className={item.enabled ?? true ? "border-green-200 bg-green-50 text-green-700" : "bg-gray-50 text-gray-500"}>
                        {item.enabled ?? true ? "Enabled" : "Disabled"}
                      </Badge>
                    </div>
                    <div className="mt-2 grid gap-1 text-xs text-gray-500 sm:grid-cols-3">
                      <span>Duration: {formatDuration(metadata[item.id]?.duration)}</span>
                      <span>Fit: {item.fitMode ?? DEFAULT_MEDIA_SETTINGS.fitMode}</span>
                      <span>Order: {(item.order ?? index) + 1}</span>
                    </div>
                    {item.type === "video" && (
                      <div className="mt-3 grid gap-2 rounded-lg border border-black/5 bg-white/70 p-3" onClick={(event) => event.stopPropagation()}>
                        <div className="flex items-center justify-between gap-3">
                          <label htmlFor={`tv-media-sidebar-video-volume-${item.id}`} className="text-xs font-semibold uppercase tracking-wider text-gray-500">Video Volume</label>
                          <span className="text-sm font-semibold text-foreground">{Math.round(getVideoVolumeLevel(item) * 100)}%</span>
                        </div>
                        <input
                          id={`tv-media-sidebar-video-volume-${item.id}`}
                          name="tvMediaSidebarVideoVolume"
                          type="range"
                          min={0}
                          max={2}
                          step={0.01}
                          value={getVideoVolumeLevel(item)}
                          onChange={(event) => onUpdate(item.id, getVideoAudioUpdate(item, { volumeLevel: parseFloat(event.target.value) }))}
                        />
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-[11px] text-gray-500">Final with master: {Math.round(Math.min(1, volume * getVideoVolumeLevel(item)) * 100)}%</span>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="bg-white"
                            onClick={() => onUpdate(item.id, getVideoAudioUpdate(item, { muted: !getVideoMuted(item) }))}
                          >
                            {getVideoMuted(item) ? "Unmute Video" : "Mute Video"}
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center justify-end gap-2" onClick={(event) => event.stopPropagation()}>
                    <a href={item.url} target="_blank" rel="noopener noreferrer">
                      <Button variant="outline" size="sm" className="bg-white">Preview</Button>
                    </a>
                    <Button variant="outline" size="sm" className="bg-white" onClick={() => setEditingId(item.id)}>Edit</Button>
                    <Button variant="outline" size="icon" className="bg-white" onClick={() => onMove(item.id, "up")} disabled={index === 0}>
                      <ArrowUp className="h-4 w-4" />
                    </Button>
                    <Button variant="outline" size="icon" className="bg-white" onClick={() => onMove(item.id, "down")} disabled={index === filteredItems.length - 1}>
                      <ArrowDown className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" className="text-red-500 hover:bg-red-50 hover:text-red-600" onClick={() => onDelete(item.id)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
              {filteredItems.length === 0 && <div className="rounded-lg border border-dashed border-black/10 p-8 text-center text-gray-400">No media matches your filters.</div>}
            </div>
          </CardContent>
        </Card>

        <Card className="glass-card h-fit">
          <CardHeader className="border-b border-black/5 pb-3">
            <CardTitle className="text-base">Preview Panel</CardTitle>
            <CardDescription>Selected media details</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 p-4">
            {selectedItem ? (
              <>
                {renderPreviewMedia(selectedItem)}
                <div>
                  <div className="text-sm font-semibold text-foreground">{selectedItem.name}</div>
                  <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-gray-600">
                    <span>Type: {selectedItem.type}</span>
                    <span>Status: {selectedItem.enabled ?? true ? "Enabled" : "Disabled"}</span>
                    <span>Duration: {formatDuration(metadata[selectedItem.id]?.duration)}</span>
                    <span>Resolution: {metadata[selectedItem.id]?.resolution ?? "Unknown"}</span>
                    <span>Fit: {selectedItem.fitMode ?? DEFAULT_MEDIA_SETTINGS.fitMode}</span>
                    <span>Scale: {Math.round((selectedItem.scale ?? 1) * 100)}%</span>
                  </div>
                </div>
                <Button className="w-full maroon-gradient" onClick={() => setEditingId(selectedItem.id)}>Edit Selected</Button>
              </>
            ) : (
              <div className="rounded-lg border border-dashed border-black/10 p-8 text-center text-sm text-gray-400">Select a media item to preview.</div>
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog open={Boolean(editingItem)} onOpenChange={(open) => !open && setEditingId(null)}>
        <DialogContent className="max-w-3xl">
          {editingItem && (
            <>
              <DialogHeader>
                <DialogTitle>Media Settings</DialogTitle>
                <DialogDescription>{editingItem.name}</DialogDescription>
              </DialogHeader>
              <div className="grid gap-5 md:grid-cols-[260px_1fr]">
                {renderPreviewMedia(editingItem)}
                <div className="grid gap-4">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="grid gap-1.5">
                      <span className="text-xs font-semibold uppercase tracking-wider text-gray-500">Fit Mode</span>
                      <Select value={editingItem.fitMode ?? DEFAULT_MEDIA_SETTINGS.fitMode} onValueChange={(value) => onUpdate(editingItem.id, { fitMode: value as MediaFitMode })}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="cover">Cover</SelectItem>
                          <SelectItem value="contain">Contain</SelectItem>
                          <SelectItem value="fill">Fill</SelectItem>
                          <SelectItem value="center">Center</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="grid gap-1.5">
                      <span className="text-xs font-semibold uppercase tracking-wider text-gray-500">Media Status</span>
                      <div className="flex h-10 items-center justify-between rounded-md border bg-white px-3">
                        <label htmlFor={`tv-media-edit-enabled-${editingItem.id}`} className="text-sm">{editingItem.enabled ?? true ? "Enabled" : "Disabled"}</label>
                        <Switch id={`tv-media-edit-enabled-${editingItem.id}`} name="tvMediaEditEnabled" checked={editingItem.enabled ?? true} onCheckedChange={(checked) => onUpdate(editingItem.id, { enabled: checked })} />
                      </div>
                    </div>
                    <div className="grid gap-1.5">
                      <span className="text-xs font-semibold uppercase tracking-wider text-gray-500">Horizontal Position</span>
                      <Select value={editingItem.horizontalPosition ?? DEFAULT_MEDIA_SETTINGS.horizontalPosition} onValueChange={(value) => onUpdate(editingItem.id, { horizontalPosition: value as MediaHorizontalPosition })}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="left">Left</SelectItem>
                          <SelectItem value="center">Center</SelectItem>
                          <SelectItem value="right">Right</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="grid gap-1.5">
                      <span className="text-xs font-semibold uppercase tracking-wider text-gray-500">Vertical Position</span>
                      <Select value={editingItem.verticalPosition ?? DEFAULT_MEDIA_SETTINGS.verticalPosition} onValueChange={(value) => onUpdate(editingItem.id, { verticalPosition: value as MediaVerticalPosition })}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="top">Top</SelectItem>
                          <SelectItem value="center">Center</SelectItem>
                          <SelectItem value="bottom">Bottom</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="grid gap-2">
                    <div className="flex items-center justify-between text-sm"><label htmlFor={`tv-media-edit-scale-${editingItem.id}`}>Zoom</label><span>{Math.round((editingItem.scale ?? 1) * 100)}%</span></div>
                    <input id={`tv-media-edit-scale-${editingItem.id}`} name="tvMediaEditScale" type="range" min={0.5} max={1.5} step={0.01} value={editingItem.scale ?? 1} onChange={(event) => onUpdate(editingItem.id, { scale: parseFloat(event.target.value) })} />
                  </div>
                  {editingItem.type === "video" && (
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="grid gap-2 rounded-lg border border-black/5 bg-white/70 p-3 sm:col-span-2">
                        <div className="flex items-center justify-between gap-3">
                          <label htmlFor={`tv-media-edit-video-volume-${editingItem.id}`} className="text-xs font-semibold uppercase tracking-wider text-gray-500">Video Volume</label>
                          <span className="text-sm font-semibold text-foreground">{Math.round(getVideoVolumeLevel(editingItem) * 100)}%</span>
                        </div>
                        <input
                          id={`tv-media-edit-video-volume-${editingItem.id}`}
                          name="tvMediaEditVideoVolume"
                          type="range"
                          min={0}
                          max={2}
                          step={0.01}
                          value={getVideoVolumeLevel(editingItem)}
                          onChange={(event) => onUpdate(editingItem.id, getVideoAudioUpdate(editingItem, { volumeLevel: parseFloat(event.target.value) }))}
                        />
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-[11px] text-gray-500">0% to 200% | Final with master: {Math.round(Math.min(1, volume * getVideoVolumeLevel(editingItem)) * 100)}%</span>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="bg-white"
                            onClick={() => onUpdate(editingItem.id, getVideoAudioUpdate(editingItem, { muted: !getVideoMuted(editingItem) }))}
                          >
                            {getVideoMuted(editingItem) ? "Unmute Video" : "Mute Video"}
                          </Button>
                        </div>
                      </div>
                      <Input id={`tv-media-edit-trim-start-${editingItem.id}`} name="tvMediaEditTrimStart" type="number" min={0} step={0.1} value={editingItem.trimStart ?? 0} onChange={(event) => onUpdate(editingItem.id, { trimStart: parseFloat(event.target.value) || 0 })} placeholder="Trim Start" />
                      <Input id={`tv-media-edit-trim-end-${editingItem.id}`} name="tvMediaEditTrimEnd" type="number" min={0} step={0.1} value={editingItem.trimEnd ?? ""} onChange={(event) => onUpdate(editingItem.id, { trimEnd: event.target.value ? parseFloat(event.target.value) : null })} placeholder="Trim End" />
                      <Select value={String(editingItem.playbackSpeed ?? 1)} onValueChange={(value) => onUpdate(editingItem.id, { playbackSpeed: parseFloat(value) as MediaPlaybackSpeed })}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="0.5">0.5x</SelectItem>
                          <SelectItem value="1">1x</SelectItem>
                          <SelectItem value="1.25">1.25x</SelectItem>
                          <SelectItem value="1.5">1.5x</SelectItem>
                        </SelectContent>
                      </Select>
                      <label className="flex h-10 items-center gap-2 rounded-md border bg-white px-3 text-sm">
                        <Checkbox id={`tv-media-edit-loop-${editingItem.id}`} name="tvMediaEditLoop" checked={editingItem.loop ?? false} onCheckedChange={(checked) => onUpdate(editingItem.id, { loop: checked === true })} />
                        Loop
                      </label>
                    </div>
                  )}
                  <div className="flex justify-end gap-2 border-t border-black/5 pt-4">
                    <Button variant="outline" className="gap-2 bg-white" onClick={() => onReset(editingItem.id)}>
                      <RotateCcw className="h-4 w-4" /> Reset to Default
                    </Button>
                    <Button className="maroon-gradient" onClick={() => setEditingId(null)}>Done</Button>
                  </div>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function TvMediaManager({
  items,
  isUploading,
  onUpload,
  onDelete,
  onUpdate,
  onReset,
  onMove,
  audioEnabled,
  volume,
  isTvMuted,
  fullscreenEnabled,
  voiceAnnouncementEnabled,
  notificationSoundEnabled,
  announcementVolume,
  onToggleTvMute,
  onToggleAudioEnabled,
  onVolumeChange,
  onToggleFullscreen,
  onToggleVoiceAnnouncement,
  onToggleNotificationSound,
  onAnnouncementVolumeChange,
}: {
  items: TvMediaItem[];
  isUploading: boolean;
  onUpload: (file: File) => void;
  onDelete: (id: string) => void;
  onUpdate: (id: string, updated: Partial<TvMediaItem>) => void;
  onReset: (id: string) => void;
  onMove: (id: string, direction: "up" | "down") => void;
  audioEnabled: boolean;
  volume: number;
  isTvMuted: boolean;
  fullscreenEnabled: boolean;
  voiceAnnouncementEnabled: boolean;
  notificationSoundEnabled: boolean;
  announcementVolume: number;
  onToggleTvMute: (event?: React.MouseEvent<HTMLButtonElement>) => void;
  onToggleAudioEnabled: () => void;
  onVolumeChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onToggleFullscreen: (event?: React.MouseEvent<HTMLButtonElement>) => void;
  onToggleVoiceAnnouncement: () => void;
  onToggleNotificationSound: () => void;
  onAnnouncementVolumeChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
}) {
  return (
    <div className="space-y-5">
      <Card className="glass-card">
        <CardHeader className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <Upload className="h-4 w-4 text-primary" />
              Upload TV Media
            </CardTitle>
            <CardDescription>Upload MP4 videos, images, or posters for the TV display media area.</CardDescription>
          </div>
          <div className="grid gap-3">
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm font-medium text-foreground">Full Screen Mode</span>
              <Button type="button" variant={fullscreenEnabled ? "default" : "outline"} className={fullscreenEnabled ? "bg-primary text-white hover:bg-primary/90" : "text-gray-600"} onClick={onToggleFullscreen}>
                {fullscreenEnabled ? <Minimize2 className="w-4 h-4 mr-2" /> : <Maximize2 className="w-4 h-4 mr-2" />}
                {fullscreenEnabled ? "Disable Full Screen Mode" : "Enable Full Screen Mode"}
              </Button>
            </div>
            <div className="flex items-center gap-3">
              <label htmlFor="tv-media-compact-audio-enabled" className="text-sm font-medium text-foreground">TV Audio</label>
              <Switch id="tv-media-compact-audio-enabled" name="tvMediaCompactAudioEnabled" checked={audioEnabled} onCheckedChange={onToggleAudioEnabled} />
              <span className="text-sm text-gray-500">{audioEnabled ? "Enabled" : "Disabled"}</span>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Button type="button" variant={isTvMuted ? "outline" : "default"} className={isTvMuted ? "text-gray-500" : "bg-primary text-white hover:bg-primary/90"} onClick={onToggleTvMute}>
                {isTvMuted ? <VolumeX className="w-4 h-4 mr-2" /> : <Volume2 className="w-4 h-4 mr-2" />}
                {isTvMuted ? "Muted" : "Unmuted"}
              </Button>
              <span className="text-sm text-gray-600">{Math.round(volume * 100)}%</span>
            </div>
            <label htmlFor="tv-media-compact-master-volume" className="sr-only">Master Volume</label>
            <input
              id="tv-media-compact-master-volume"
              name="tvMediaCompactMasterVolume"
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={volume}
              onChange={onVolumeChange}
              className="w-full"
            />
            <div className="border-t border-black/10 pt-3 grid gap-3">
              <div className="flex items-center gap-3">
                <Megaphone className="h-4 w-4 text-primary" />
                <label htmlFor="tv-media-compact-voice-announcement" className="text-sm font-medium text-foreground">Voice Announcement</label>
                <Switch id="tv-media-compact-voice-announcement" name="tvMediaCompactVoiceAnnouncementEnabled" checked={voiceAnnouncementEnabled} onCheckedChange={onToggleVoiceAnnouncement} />
                <span className="text-sm text-gray-500">{voiceAnnouncementEnabled ? "Enabled" : "Disabled"}</span>
              </div>
              <div className="flex items-center gap-3">
                <Bell className="h-4 w-4 text-primary" />
                <label htmlFor="tv-media-compact-notification-sound" className="text-sm font-medium text-foreground">Notification Sound</label>
                <Switch id="tv-media-compact-notification-sound" name="tvMediaCompactNotificationSoundEnabled" checked={notificationSoundEnabled} onCheckedChange={onToggleNotificationSound} />
                <span className="text-sm text-gray-500">{notificationSoundEnabled ? "Enabled" : "Disabled"}</span>
              </div>
              <div className="grid gap-2">
                <div className="flex items-center justify-between gap-3">
                  <label htmlFor="tv-media-compact-announcement-volume" className="text-sm font-medium text-foreground">Announcement Volume</label>
                  <span className="text-sm text-gray-600">{Math.round(announcementVolume * 100)}%</span>
                </div>
                <input
                  id="tv-media-compact-announcement-volume"
                  name="tvMediaCompactAnnouncementVolume"
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={announcementVolume}
                  onChange={onAnnouncementVolumeChange}
                  className="w-full"
                />
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <label className="flex cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-primary/30 bg-white/50 px-6 py-10 text-center hover:bg-white/70">
            <Upload className="mb-3 h-8 w-8 text-primary" />
            <span className="text-sm font-semibold text-foreground">
              {isUploading ? "Uploading..." : "Choose video or image"}
            </span>
            <span className="mt-1 text-xs text-gray-500">MP4, images, posters, and orientation slides</span>
            <input
              id="tv-media-compact-upload"
              name="tvMediaCompactUpload"
              type="file"
              accept="video/*,image/*"
              className="hidden"
              disabled={isUploading}
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (file) onUpload(file);
              }}
            />
          </label>
        </CardContent>
      </Card>

      <Card className="glass-card">
        <CardHeader className="pb-3 border-b border-black/5">
          <CardTitle className="text-base flex items-center justify-between">
            TV Media Playlist
            <Badge variant="outline" className="bg-white text-gray-500">{items.length} Items</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="divide-y divide-black/5">
            {[...items].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)).map((item, index) => (
              <div key={item.id} className="grid gap-4 p-4 hover:bg-white/40 xl:grid-cols-[260px_1fr]">
                <div className="space-y-3">
                  <div className="relative aspect-video overflow-hidden rounded-lg border border-black/10 bg-black">
                    {item.type === "video" ? (
                      <video
                        src={item.url}
                        className="h-full w-full"
                        style={getMediaDisplayStyle(item)}
                        muted={item.itemMuted ?? false}
                        loop={item.loop ?? false}
                        controls
                        onLoadedMetadata={(event) => {
                          event.currentTarget.currentTime = item.trimStart ?? 0;
                          event.currentTarget.volume = Math.min(1, getVideoVolumeLevel(item));
                          event.currentTarget.playbackRate = item.playbackSpeed ?? 1;
                        }}
                        onTimeUpdate={(event) => {
                          const trimStart = item.trimStart ?? 0;
                          const trimEnd = typeof item.trimEnd === "number" && item.trimEnd > trimStart ? item.trimEnd : null;
                          if (trimEnd === null || event.currentTarget.currentTime < trimEnd) return;
                          if (item.loop) {
                            event.currentTarget.currentTime = trimStart;
                            void event.currentTarget.play();
                            return;
                          }
                          event.currentTarget.pause();
                        }}
                      />
                    ) : (
                      <img src={item.url} alt={item.name} className="h-full w-full" style={getMediaDisplayStyle(item)} />
                    )}
                  </div>
                <div className="flex min-w-0 items-center gap-3">
                  <div className="grid h-10 w-10 place-items-center rounded-lg border border-black/5 bg-white/60 text-primary">
                    {item.type === "video" ? <Film className="h-5 w-5" /> : <ImageIcon className="h-5 w-5" />}
                  </div>
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-foreground">{item.name}</div>
                    <div className="text-xs text-gray-500">
                      {item.type.toUpperCase()} · {new Date(item.uploadedAt).toLocaleString()}
                    </div>
                  </div>
                </div>
                </div>

                <div className="grid gap-4">
                  <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                    <div className="grid gap-1.5">
                      <span className="text-xs font-semibold uppercase tracking-wider text-gray-500">Fit Mode</span>
                      <Select value={item.fitMode ?? DEFAULT_MEDIA_SETTINGS.fitMode} onValueChange={(value) => onUpdate(item.id, { fitMode: value as MediaFitMode })}>
                        <SelectTrigger className="bg-white/60"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="contain">Contain</SelectItem>
                          <SelectItem value="cover">Cover</SelectItem>
                          <SelectItem value="fill">Fill</SelectItem>
                          <SelectItem value="center">Center</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="grid gap-1.5">
                      <span className="text-xs font-semibold uppercase tracking-wider text-gray-500">Horizontal Position</span>
                      <Select value={item.horizontalPosition ?? DEFAULT_MEDIA_SETTINGS.horizontalPosition} onValueChange={(value) => onUpdate(item.id, { horizontalPosition: value as MediaHorizontalPosition })}>
                        <SelectTrigger className="bg-white/60"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="left">Left</SelectItem>
                          <SelectItem value="center">Center</SelectItem>
                          <SelectItem value="right">Right</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="grid gap-1.5">
                      <span className="text-xs font-semibold uppercase tracking-wider text-gray-500">Vertical Position</span>
                      <Select value={item.verticalPosition ?? DEFAULT_MEDIA_SETTINGS.verticalPosition} onValueChange={(value) => onUpdate(item.id, { verticalPosition: value as MediaVerticalPosition })}>
                        <SelectTrigger className="bg-white/60"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="top">Top</SelectItem>
                          <SelectItem value="center">Center</SelectItem>
                          <SelectItem value="bottom">Bottom</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="grid gap-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <label htmlFor={`tv-media-item-scale-${item.id}`} className="text-xs font-semibold uppercase tracking-wider text-gray-500">Zoom / Scale</label>
                        <span className="text-xs text-gray-500">{Math.round((item.scale ?? 1) * 100)}%</span>
                      </div>
                      <input id={`tv-media-item-scale-${item.id}`} name="tvMediaItemScale" type="range" min={0.5} max={1.5} step={0.01} value={item.scale ?? 1} onChange={(event) => onUpdate(item.id, { scale: parseFloat(event.target.value) })} />
                    </div>
                  </div>

                  {item.type === "video" && (
                    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
                      <Input id={`tv-media-item-trim-start-${item.id}`} name="tvMediaItemTrimStart" type="number" min={0} step={0.1} value={item.trimStart ?? 0} onChange={(event) => onUpdate(item.id, { trimStart: parseFloat(event.target.value) || 0 })} placeholder="Trim start" className="bg-white/60" />
                      <Input id={`tv-media-item-trim-end-${item.id}`} name="tvMediaItemTrimEnd" type="number" min={0} step={0.1} value={item.trimEnd ?? ""} onChange={(event) => onUpdate(item.id, { trimEnd: event.target.value ? parseFloat(event.target.value) : null })} placeholder="Trim end" className="bg-white/60" />
                      <div className="grid gap-1">
                        <div className="flex items-center justify-between text-xs text-gray-500">
                          <label htmlFor={`tv-media-item-volume-${item.id}`}>Video Volume</label>
                          <span>{Math.round(getVideoVolumeLevel(item) * 100)}%</span>
                        </div>
                        <input id={`tv-media-item-volume-${item.id}`} name="tvMediaItemVolume" type="range" min={0} max={2} step={0.01} value={getVideoVolumeLevel(item)} onChange={(event) => onUpdate(item.id, getVideoAudioUpdate(item, { volumeLevel: parseFloat(event.target.value) }))} />
                        <span className="text-[11px] text-gray-400">Final with master: {Math.round(Math.min(1, volume * getVideoVolumeLevel(item)) * 100)}%</span>
                      </div>
                      <Select value={String(item.playbackSpeed ?? 1)} onValueChange={(value) => onUpdate(item.id, { playbackSpeed: parseFloat(value) as MediaPlaybackSpeed })}>
                        <SelectTrigger className="bg-white/60"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="0.5">0.5x</SelectItem>
                          <SelectItem value="1">1x</SelectItem>
                          <SelectItem value="1.25">1.25x</SelectItem>
                          <SelectItem value="1.5">1.5x</SelectItem>
                        </SelectContent>
                      </Select>
                      <div className="flex flex-wrap items-center gap-3 text-sm">
                        <Button variant="outline" size="sm" className="bg-white/50" onClick={() => onUpdate(item.id, getVideoAudioUpdate(item, { muted: !getVideoMuted(item) }))}>
                          {getVideoMuted(item) ? "Unmute Video" : "Mute Video"}
                        </Button>
                        <label className="flex items-center gap-2"><Checkbox id={`tv-media-item-loop-${item.id}`} name="tvMediaItemLoop" checked={item.loop ?? false} onCheckedChange={(checked) => onUpdate(item.id, { loop: checked === true })} /> Loop</label>
                      </div>
                    </div>
                  )}

                <div className="flex flex-wrap items-center justify-between gap-3">
                  <label className="flex items-center gap-2 text-sm font-medium text-foreground">
                    <Switch id={`tv-media-item-enabled-${item.id}`} name="tvMediaItemEnabled" checked={item.enabled ?? true} onCheckedChange={(checked) => onUpdate(item.id, { enabled: checked })} />
                    {item.enabled ?? true ? "Enabled" : "Disabled"}
                  </label>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" className="bg-white/50" onClick={() => onMove(item.id, "up")} disabled={index === 0}>
                    <ArrowUp className="h-3.5 w-3.5" />
                  </Button>
                  <Button variant="outline" size="sm" className="bg-white/50" onClick={() => onMove(item.id, "down")} disabled={index === items.length - 1}>
                    <ArrowDown className="h-3.5 w-3.5" />
                  </Button>
                  <Button variant="outline" size="sm" className="bg-white/50 gap-2" onClick={() => onReset(item.id)}>
                    <RotateCcw className="h-3.5 w-3.5" /> Reset
                  </Button>
                  <a href={item.url} target="_blank" rel="noopener noreferrer">
                    <Button variant="outline" size="sm" className="bg-white/50">Open</Button>
                  </a>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="text-red-500 hover:bg-red-50 hover:text-red-600"
                    onClick={() => onDelete(item.id)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
                </div>
                </div>
              </div>
            ))}
            {items.length === 0 && (
              <div className="p-8 text-center text-gray-400">No TV media uploaded yet.</div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
