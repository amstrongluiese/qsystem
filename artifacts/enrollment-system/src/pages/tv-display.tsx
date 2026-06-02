import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useGetTvDisplay, getGetTvDisplayQueryKey } from "@workspace/api-client-react";
import { motion, AnimatePresence } from "framer-motion";
import { Card, CardContent } from "@/components/ui/card";
import { CcsLogo } from "@/components/ccs-logo";
import { useQueueSocket } from "@/hooks/use-socket";
import React from "react";

type TvMediaItem = {
  id: string;
  name: string;
  type: "video" | "image";
  url: string;
  uploadedAt: string;
};

export default function TvDisplay() {
  const [mediaItems, setMediaItems] = useState<TvMediaItem[]>([]);
  const [activeMediaIndex, setActiveMediaIndex] = useState(0);

  const { data: tvSettings } = useQuery({
    queryKey: ["tvSettings"],
    queryFn: async () => {
      const response = await fetch("/api/tv/settings");
      if (!response.ok) throw new Error("Failed to load TV settings");
      return response.json();
    },
    refetchOnWindowFocus: false,
  });

  const audioEnabled = tvSettings?.audioEnabled ?? true;
  const volume = typeof tvSettings?.volume === "number" ? tvSettings.volume : 1;
  const muted = tvSettings?.muted ?? true;
  const videoMuted = !audioEnabled || muted;

  const { data: display, isLoading } = useGetTvDisplay({
    query: {
      queryKey: getGetTvDisplayQueryKey(),
      refetchInterval: 3000
    }
  });

  useQueueSocket(); // Realtime updates

  useEffect(() => {
    let mounted = true;
    const loadMedia = async () => {
      const response = await fetch("/api/tv/media");
      if (!response.ok) return;
      const data = await response.json();
      if (mounted) setMediaItems(data);
    };

    void loadMedia();
    const interval = window.setInterval(loadMedia, 15000);
    return () => {
      mounted = false;
      window.clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    if (mediaItems.length === 0) return;
    if (activeMediaIndex >= mediaItems.length) {
      setActiveMediaIndex(0);
      return;
    }

    const activeItem = mediaItems[activeMediaIndex];
    if (activeItem?.type !== "image") return;

    const timer = window.setTimeout(() => {
      setActiveMediaIndex((index) => (index + 1) % mediaItems.length);
    }, 18000);

    return () => window.clearTimeout(timer);
  }, [mediaItems, activeMediaIndex]);

  if (isLoading || !display) {
    return <div className="min-h-screen bg-background flex items-center justify-center text-primary animate-pulse text-2xl font-light tracking-widest">LOADING SYSTEM</div>;
  }

  return (
    <div 
      className="min-h-screen w-full text-foreground overflow-hidden flex flex-col p-8 relative"
      style={{ background: "linear-gradient(170deg, #ffffff 0%, #fdf7f8 40%, #f9eef1 100%)" }}
    >
      <div className="absolute top-0 right-0 w-[800px] h-[800px] bg-primary/5 rounded-full blur-[150px] pointer-events-none" />
      <div className="absolute bottom-0 left-0 w-[600px] h-[600px] bg-primary/5 rounded-full blur-[120px] pointer-events-none" />

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
            <div className="text-4xl font-black text-primary">{display.totalWaiting}</div>
          </div>
          <div className="text-right">
            <div className="text-6xl font-light text-foreground">{new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</div>
            <div className="text-gray-500 text-lg uppercase tracking-widest">{new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</div>
          </div>
        </div>
      </header>

      <main className="flex-1 flex flex-col gap-8 z-10">
        <section className="grid grid-cols-4 gap-6 content-start">
          <AnimatePresence>
            {display.nowServing.map((item, index) => (
              <motion.div
                key={`${item.queueNumber}-${item.status}`}
                initial={{ opacity: 0, scale: 0.9, x: -50 }}
                animate={{ opacity: 1, scale: 1, x: 0 }}
                exit={{ opacity: 0, scale: 0.9 }}
                transition={{ duration: 0.5, delay: index * 0.1 }}
                className="w-full"
              >
                <Card className={`glass-card border-l-4 overflow-hidden ${item.status === 'called' ? 'border-l-primary glow-maroon' : 'border-l-black/10'}`}>
                  <CardContent className="p-6">
                    <div className="flex justify-between items-center mb-2">
                      <span className="text-gray-500 uppercase tracking-widest text-sm font-medium">{item.status.replace('_', ' ')}</span>
                      <span className="text-xs font-semibold px-2 py-1 bg-black/5 rounded text-gray-700 uppercase">{item.counterType}</span>
                    </div>
                    <div className="text-6xl font-black text-foreground my-4">{item.queueNumber}</div>
                    {item.studentName && (
                      <div className="text-2xl font-semibold text-foreground leading-tight truncate max-w-full">
                        {item.studentName}
                      </div>
                    )}
                    <div className="text-2xl font-medium text-primary border-t border-black/10 pt-4 mt-3">
                      {item.counterName}
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
            {display.nowServing.length === 0 && (
              <div className="col-span-4 text-center text-gray-500 py-12 text-2xl font-light tracking-widest">
                NO STUDENTS CURRENTLY SERVING
              </div>
            )}
          </AnimatePresence>
        </section>

        <section className="flex-1 grid grid-cols-12 gap-8 min-h-0">
          <div className="col-span-8 min-h-0">
            <TvMediaShowcase
              items={mediaItems}
              activeIndex={activeMediaIndex}
              totalWaiting={display.totalWaiting}
              muted={videoMuted}
              volume={volume}
              onAdvance={() => setActiveMediaIndex((index) => (index + 1) % mediaItems.length)}
            />
          </div>

          <div className="col-span-4 flex flex-col space-y-6 border-l border-black/10 pl-8 min-h-0">
          <div className="glass-card p-6 rounded-2xl border border-black/5 shadow-sm bg-white/40">
            <h3 className="text-gray-500 text-xs uppercase tracking-widest mb-4 font-semibold flex justify-between">
              <span>Waiting for Evaluation</span>
              <span className="text-primary">{display.waitingForEvaluation?.length || 0}</span>
            </h3>
            <div className="flex flex-wrap gap-2 max-h-40 overflow-hidden">
              {display.waitingForEvaluation && display.waitingForEvaluation.length > 0 ? display.waitingForEvaluation.map((item) => (
                <div key={item.queueNumber} className="bg-black/5 px-3 py-1.5 rounded-lg text-foreground font-bold">{item.queueNumber}</div>
              )) : <span className="text-gray-400 text-sm">None</span>}
            </div>
          </div>

          {/* Waiting for Tagging */}
          <div className="glass-card p-6 rounded-2xl border border-black/5 shadow-sm bg-white/40">
            <h3 className="text-gray-500 text-xs uppercase tracking-widest mb-4 font-semibold flex justify-between">
              <span>Waiting for Tagging</span>
              <span className="text-primary">{display.waitingForTagging?.length || 0}</span>
            </h3>
            <div className="flex flex-wrap gap-2 max-h-40 overflow-hidden">
              {display.waitingForTagging && display.waitingForTagging.length > 0 ? display.waitingForTagging.map((item) => (
                <div key={item.queueNumber} className="bg-black/5 px-3 py-1.5 rounded-lg text-foreground font-bold">{item.queueNumber}</div>
              )) : <span className="text-gray-400 text-sm">None</span>}
            </div>
          </div>

          {/* Announcements */}
          {display.announcements && display.announcements.length > 0 && (
            <div className="flex-1 glass-card p-7 rounded-2xl border border-black/5 flex flex-col shadow-sm bg-white/40 min-h-65">
              <h3 className="text-primary text-lg uppercase tracking-widest mb-5 font-semibold">
                Announcements
              </h3>
              <div className="flex-1 space-y-4 overflow-hidden">
                <AnimatePresence>
                  {display.announcements.slice(0, 3).map((announcement, i) => (
                    <motion.div
                      key={i}
                      initial={{ opacity: 0, x: 10 }}
                      animate={{ opacity: 1, x: 0 }}
                      className="text-xl font-medium leading-relaxed text-gray-700 border-b border-black/5 pb-5 last:border-0"
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
    </div>
  );
}

function TvMediaShowcase({
  items,
  activeIndex,
  totalWaiting,
  muted,
  volume,
  onAdvance,
}: {
  items: TvMediaItem[];
  activeIndex: number;
  totalWaiting: number;
  muted: boolean;
  volume: number;
  onAdvance: () => void;
}) {
  const active = items.length > 0 ? items[activeIndex % items.length] : null;
  const videoRef = React.useRef<HTMLVideoElement>(null);

  // sync video element with muted & volume
  React.useEffect(() => {
    if (videoRef.current) {
      videoRef.current.muted = muted;
      videoRef.current.volume = volume;
    }
  }, [muted, volume]);

  const handleVideoEnded = () => {
    if (items.length <= 1) {
      if (videoRef.current) {
        videoRef.current.currentTime = 0;
        void videoRef.current.play();
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
            initial={{ opacity: 0, scale: 1.02 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.99 }}
            transition={{ duration: 0.8, ease: "easeOut" }}
            className="absolute inset-0"
          >
            {active.type === "video" ? (
              <video
                ref={videoRef}
                src={active.url}
                className="h-full w-full object-cover"
                autoPlay
                playsInline
                muted={muted}
                onEnded={handleVideoEnded}
              />
            ) : (
              <img src={active.url} alt={active.name} className="h-full w-full object-cover" />
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
