import { useEffect, useMemo, useRef, useState } from "react";

type LiteQueueItem = {
  queueNumber: string;
  studentName?: string | null;
  counterName?: string | null;
  counterType?: string | null;
  status: string;
};

type LiteDisplayData = {
  nowServing: LiteQueueItem[];
  waitingForEvaluation: LiteQueueItem[];
  waitingForTagging: LiteQueueItem[];
  announcements: string[];
  totalWaiting: number;
};

type LiteMediaItem = {
  id: string;
  name: string;
  type: "video" | "image";
  url: string;
  enabled?: boolean;
  order?: number;
  muted?: boolean;
  itemMuted?: boolean;
  volumeLevel?: number;
  itemVolume?: number;
};

const EMPTY_DISPLAY: LiteDisplayData = {
  nowServing: [],
  waitingForEvaluation: [],
  waitingForTagging: [],
  announcements: [],
  totalWaiting: 0,
};

type LiteTvSettings = {
  muted: boolean;
  audioEnabled: boolean;
  volume: number;
  fullscreenEnabled: boolean;
  fullscreenRequestId: number;
};

const TV_LITE_REQUEST_TIMEOUT_MS = 8000;

async function fetchJsonWithTimeout<T>(url: string, signal?: AbortSignal): Promise<T> {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(new DOMException("TV lite request timed out", "TimeoutError")), TV_LITE_REQUEST_TIMEOUT_MS);
  const abortFromParent = () => controller.abort(signal?.reason);
  if (signal?.aborted) abortFromParent();
  signal?.addEventListener("abort", abortFromParent, { once: true });

  try {
    const response = await fetch(url, { cache: "no-store", signal: controller.signal });
    if (!response.ok) throw new Error(`Request failed: ${response.status}`);
    return response.json() as Promise<T>;
  } finally {
    window.clearTimeout(timeoutId);
    signal?.removeEventListener("abort", abortFromParent);
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

function safeArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? value as T[] : [];
}

function normalizeStatus(status: string) {
  return status.replace(/_/g, " ");
}

function getStatusClass(status: string) {
  const normalized = status.toLowerCase().replace(/\s+/g, "_");
  if (normalized === "called") return "called";
  if (normalized === "in_progress") return "progress";
  if (normalized === "break" || normalized === "paused" || normalized === "lunch_break") return "break";
  return "default";
}

export default function TvLiteDisplay() {
  const [display, setDisplay] = useState<LiteDisplayData>(EMPTY_DISPLAY);
  const [mediaItems, setMediaItems] = useState<LiteMediaItem[]>([]);
  const [tvSettings, setTvSettings] = useState<LiteTvSettings>({
    muted: false,
    audioEnabled: true,
    volume: 1,
    fullscreenEnabled: false,
    fullscreenRequestId: 0,
  });
  const [activeMediaIndex, setActiveMediaIndex] = useState(0);
  const [documentAudioUnlocked, setDocumentAudioUnlocked] = useState(() => hasDocumentUserActivation());
  const [audioUnlockVisible, setAudioUnlockVisible] = useState(false);
  const [fullscreenUnlockVisible, setFullscreenUnlockVisible] = useState(false);
  const [connectionError, setConnectionError] = useState("");
  const [lastUpdated, setLastUpdated] = useState("");
  const mountedRef = useRef(true);
  const videoRef = useRef<HTMLVideoElement>(null);

  const enabledMedia = useMemo(
    () => mediaItems.filter((item) => item.enabled !== false).sort((a, b) => (a.order ?? 0) - (b.order ?? 0)),
    [mediaItems],
  );
  const activeMedia = enabledMedia.length > 0 ? enabledMedia[activeMediaIndex % enabledMedia.length] : null;
  const visibleAnnouncements = useMemo(() => display.announcements.slice(0, 3), [display.announcements]);
  const activeVideoMuted = tvSettings.muted || activeMedia?.muted === true || activeMedia?.itemMuted === true;
  const videoAudioBlocked = tvSettings.audioEnabled && !activeVideoMuted && !documentAudioUnlocked;
  const videoShouldBeMuted = !tvSettings.audioEnabled || activeVideoMuted || videoAudioBlocked;
  const activeVideoVolume = Math.min(
    1,
    Math.max(0, tvSettings.volume * (typeof activeMedia?.volumeLevel === "number" ? activeMedia.volumeLevel : activeMedia?.itemVolume ?? 1)),
  );
  const canUnlockVideoAudio = !documentAudioUnlocked && (audioUnlockVisible || (tvSettings.audioEnabled && !activeVideoMuted && activeMedia?.type === "video"));
  const canUnlockFullscreen = fullscreenUnlockVisible && tvSettings.fullscreenEnabled;

  useEffect(() => {
    mountedRef.current = true;
    const controller = new AbortController();

    const loadDisplay = async () => {
      try {
        const data = await fetchJsonWithTimeout<any>("/api/tv/display", controller.signal);
        if (!mountedRef.current) return;
        setDisplay({
          nowServing: safeArray<LiteQueueItem>(data.nowServing),
          waitingForEvaluation: safeArray<LiteQueueItem>(data.waitingForEvaluation),
          waitingForTagging: safeArray<LiteQueueItem>(data.waitingForTagging),
          announcements: safeArray<string>(data.announcements),
          totalWaiting: typeof data.totalWaiting === "number" ? data.totalWaiting : 0,
        });
        setConnectionError("");
        setLastUpdated(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));
      } catch (error) {
        if (!mountedRef.current) return;
        setConnectionError(error instanceof Error ? error.message : "Connection unavailable");
      }
    };

    void loadDisplay();
    const interval = window.setInterval(loadDisplay, 7000);
    return () => {
      mountedRef.current = false;
      controller.abort();
      window.clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    if (documentAudioUnlocked) return;

    const markUnlocked = () => {
      if (!hasDocumentUserActivation()) return;
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
    let mounted = true;
    const controller = new AbortController();
    const loadMedia = async () => {
      try {
        const data = await fetchJsonWithTimeout<unknown>("/api/tv/media", controller.signal);
        if (mounted) setMediaItems(safeArray<LiteMediaItem>(data));
      } catch {
        // Media is optional on the lite display.
      }
    };

    void loadMedia();
    const interval = window.setInterval(loadMedia, 30000);
    return () => {
      mounted = false;
      controller.abort();
      window.clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    let mounted = true;
    const controller = new AbortController();
    const loadSettings = async () => {
      try {
        const data = await fetchJsonWithTimeout<any>("/api/tv/settings", controller.signal);
        if (!mounted) return;
        setTvSettings({
          muted: data.muted === true,
          audioEnabled: data.audioEnabled !== false,
          volume: Math.min(1, Math.max(0, typeof data.volume === "number" ? data.volume : 1)),
          fullscreenEnabled: data.fullscreenEnabled === true,
          fullscreenRequestId: typeof data.fullscreenRequestId === "number" ? data.fullscreenRequestId : 0,
        });
      } catch {
        // Lite display can still run without settings.
      }
    };

    void loadSettings();
    const interval = window.setInterval(loadSettings, 15000);
    return () => {
      mounted = false;
      controller.abort();
      window.clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    try {
      video.muted = videoShouldBeMuted;
      video.volume = activeVideoVolume;
      if (videoAudioBlocked) setAudioUnlockVisible(true);
      void video.play().catch(() => {
        if (tvSettings.audioEnabled && !activeVideoMuted) setAudioUnlockVisible(true);
      });
    } catch {
      if (tvSettings.audioEnabled && !activeVideoMuted) setAudioUnlockVisible(true);
    }
  }, [activeMedia?.id, activeVideoMuted, activeVideoVolume, tvSettings.audioEnabled, videoAudioBlocked, videoShouldBeMuted]);

  const unlockTvAudio = async () => {
    setDocumentAudioUnlocked(true);
    setAudioUnlockVisible(false);
    const video = videoRef.current;
    if (!video) return;

    try {
      video.muted = false;
      video.volume = activeVideoVolume;
      await video.play();
    } catch {
      setAudioUnlockVisible(true);
    }
  };

  const requestFullscreen = async () => {
    try {
      if (typeof document === "undefined" || typeof document.documentElement.requestFullscreen !== "function") return;
      if (!hasDocumentUserActivation()) {
        setFullscreenUnlockVisible(true);
        return;
      }
      await document.documentElement.requestFullscreen();
      setFullscreenUnlockVisible(false);
    } catch {
      setFullscreenUnlockVisible(true);
    }
  };

  useEffect(() => {
    if (tvSettings.fullscreenEnabled) {
      setFullscreenUnlockVisible(true);
      return;
    }

    setFullscreenUnlockVisible(false);
    if (typeof document !== "undefined" && document.fullscreenElement && typeof document.exitFullscreen === "function") {
      void document.exitFullscreen().catch(() => undefined);
    }
  }, [tvSettings.fullscreenEnabled, tvSettings.fullscreenRequestId]);

  useEffect(() => {
    if (enabledMedia.length <= 1) return;
    const interval = window.setInterval(() => {
      setActiveMediaIndex((index) => (index + 1) % enabledMedia.length);
    }, 20000);
    return () => window.clearInterval(interval);
  }, [enabledMedia.length]);

  return (
    <div className="tv-lite">
      <style>{`
        .tv-lite {
          min-height: 100vh;
          background: #fbf5f7;
          color: #231f20;
          font-family: Arial, Helvetica, sans-serif;
          padding: 28px;
          box-sizing: border-box;
        }
        .tv-lite-header {
          display: flex;
          align-items: flex-end;
          justify-content: space-between;
          border-bottom: 2px solid rgba(0, 0, 0, 0.12);
          padding-bottom: 18px;
          margin-bottom: 24px;
        }
        .tv-lite-title {
          font-size: 46px;
          line-height: 1;
          font-weight: 900;
          letter-spacing: 1px;
          margin: 0;
        }
        .tv-lite-subtitle {
          margin: 8px 0 0;
          color: #800020;
          font-size: 18px;
          font-weight: 700;
          letter-spacing: 4px;
        }
        .tv-lite-meta {
          text-align: right;
          color: #666;
          font-size: 15px;
          line-height: 1.6;
        }
        .tv-lite-notice {
          display: inline-block;
          margin-top: 6px;
          color: #9f1239;
          font-weight: 700;
        }
        .tv-lite-grid {
          display: grid;
          grid-template-columns: minmax(0, 2fr) minmax(320px, 1fr);
          gap: 24px;
        }
        .tv-lite-card-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 16px;
          margin-bottom: 24px;
        }
        .tv-lite-card {
          background: #fff;
          border: 1px solid rgba(0, 0, 0, 0.08);
          border-left: 6px solid #800020;
          border-radius: 10px;
          padding: 18px;
          box-shadow: 0 8px 24px rgba(0, 0, 0, 0.08);
        }
        .tv-lite-status {
          text-transform: uppercase;
          color: #666;
          font-size: 14px;
          font-weight: 800;
          letter-spacing: 2px;
        }
        .tv-lite-status.called { color: #dc2626; }
        .tv-lite-status.progress { color: #059669; }
        .tv-lite-status.break { color: #b45309; }
        .tv-lite-number {
          font-size: 58px;
          line-height: 1;
          font-weight: 900;
          margin: 14px 0;
        }
        .tv-lite-name {
          font-size: 24px;
          font-weight: 800;
          min-height: 30px;
        }
        .tv-lite-counter {
          margin-top: 14px;
          padding-top: 12px;
          border-top: 1px solid rgba(0, 0, 0, 0.1);
          color: #800020;
          font-size: 20px;
          font-weight: 800;
        }
        .tv-lite-empty {
          background: #fff;
          border: 1px dashed rgba(0, 0, 0, 0.2);
          border-radius: 10px;
          padding: 44px;
          text-align: center;
          color: #777;
          font-size: 24px;
          letter-spacing: 4px;
        }
        .tv-lite-media {
          height: 360px;
          background: #111;
          border-radius: 10px;
          overflow: hidden;
          margin-bottom: 24px;
        }
        .tv-lite-media img,
        .tv-lite-media video {
          width: 100%;
          height: 100%;
          object-fit: cover;
          display: block;
        }
        .tv-lite-section {
          background: rgba(255, 255, 255, 0.8);
          border: 1px solid rgba(0, 0, 0, 0.08);
          border-radius: 10px;
          padding: 18px;
          margin-bottom: 16px;
        }
        .tv-lite-section-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          color: #555;
          font-size: 15px;
          font-weight: 900;
          letter-spacing: 2px;
          text-transform: uppercase;
          margin-bottom: 14px;
        }
        .tv-lite-count {
          color: #800020;
          font-size: 22px;
        }
        .tv-lite-chip-list {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
        }
        .tv-lite-chip {
          background: rgba(0, 0, 0, 0.06);
          border-radius: 8px;
          padding: 8px 12px;
          font-size: 22px;
          font-weight: 900;
        }
        .tv-lite-announcement {
          font-size: 20px;
          line-height: 1.4;
          padding: 12px 0;
          border-bottom: 1px solid rgba(0, 0, 0, 0.08);
        }
        .tv-lite-announcement:last-child { border-bottom: 0; }
        @media (max-width: 900px) {
          .tv-lite-grid { grid-template-columns: 1fr; }
          .tv-lite-card-grid { grid-template-columns: 1fr; }
          .tv-lite-title { font-size: 38px; }
        }
        .tv-lite-button-stack {
          position: fixed;
          left: 50%;
          bottom: 24px;
          z-index: 20;
          transform: translateX(-50%);
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 12px;
        }
        .tv-lite-action-button {
          border: 1px solid rgba(255, 255, 255, 0.22);
          border-radius: 8px;
          background: rgba(0, 0, 0, 0.86);
          color: #fff;
          padding: 12px 24px;
          font-size: 18px;
          font-weight: 800;
          box-shadow: 0 16px 48px rgba(0, 0, 0, 0.28);
        }
      `}</style>

      <header className="tv-lite-header">
        <div>
          <h1 className="tv-lite-title">NOW SERVING</h1>
          <p className="tv-lite-subtitle">COLLEGE OF COMPUTER STUDIES</p>
        </div>
        <div className="tv-lite-meta">
          <div>TV Lite Display</div>
          {lastUpdated ? <div>Updated {lastUpdated}</div> : null}
          {connectionError ? <div className="tv-lite-notice">Connection issue. Showing last data.</div> : null}
        </div>
      </header>

      <main className="tv-lite-grid">
        <section>
          <div className="tv-lite-card-grid">
            {display.nowServing.length > 0 ? display.nowServing.map((item) => (
              <div className="tv-lite-card" key={`${item.queueNumber}-${item.counterName}-${item.status}`}>
                <div className={`tv-lite-status ${getStatusClass(item.status)}`}>{normalizeStatus(item.status)}</div>
                <div className="tv-lite-number">{item.queueNumber}</div>
                <div className="tv-lite-name">{item.studentName || ""}</div>
                <div className="tv-lite-counter">{item.counterName || "Assigned Counter"}</div>
              </div>
            )) : (
              <div className="tv-lite-empty">NO STUDENTS CURRENTLY SERVING</div>
            )}
          </div>

          {activeMedia ? (
            <div className="tv-lite-media">
              {activeMedia.type === "video" ? (
                <video
                  ref={videoRef}
                  src={activeMedia.url}
                  autoPlay
                  muted={videoShouldBeMuted}
                  playsInline
                  loop
                />
              ) : (
                <img src={activeMedia.url} alt={activeMedia.name} />
              )}
            </div>
          ) : null}
        </section>

        <aside>
          <LiteWaitingSection title="Waiting for Evaluation" items={display.waitingForEvaluation} />
          <LiteWaitingSection title="Waiting for Tagging" items={display.waitingForTagging} />
          <div className="tv-lite-section">
            <div className="tv-lite-section-header">
              <span>Announcements</span>
              <span className="tv-lite-count">{visibleAnnouncements.length}</span>
            </div>
            {visibleAnnouncements.length > 0 ? visibleAnnouncements.map((announcement, index) => (
              <div className="tv-lite-announcement" key={`${index}-${announcement}`}>{announcement}</div>
            )) : (
              <div style={{ color: "#777" }}>None</div>
            )}
          </div>
        </aside>
      </main>

      {canUnlockVideoAudio || canUnlockFullscreen ? (
        <div className="tv-lite-button-stack">
          {canUnlockFullscreen ? (
            <button type="button" className="tv-lite-action-button" onClick={() => void requestFullscreen()}>
              Enable Full Screen
            </button>
          ) : null}
          {canUnlockVideoAudio ? (
            <button type="button" className="tv-lite-action-button" onClick={unlockTvAudio}>
              Enable TV Audio
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function LiteWaitingSection({ title, items }: { title: string; items: LiteQueueItem[] }) {
  return (
    <div className="tv-lite-section">
      <div className="tv-lite-section-header">
        <span>{title}</span>
        <span className="tv-lite-count">{items.length}</span>
      </div>
      <div className="tv-lite-chip-list">
        {items.length > 0 ? items.map((item) => (
          <div className="tv-lite-chip" key={`${title}-${item.queueNumber}`}>{item.queueNumber}</div>
        )) : (
          <div style={{ color: "#777" }}>None</div>
        )}
      </div>
    </div>
  );
}
