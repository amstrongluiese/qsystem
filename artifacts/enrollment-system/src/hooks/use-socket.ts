import { useEffect, useRef, useState } from "react";
import { io, Socket } from "socket.io-client";
import { useQueryClient } from "@tanstack/react-query";

export function useQueueSocket(
  counterId?: number,
  options?: { compatibilityMode?: boolean; realtimePrefixes?: string[]; onTvVoiceEvent?: (event: unknown) => void },
) {
  const queryClient = useQueryClient();
  const [isConnected, setIsConnected] = useState(false);
  const [reconnectCount, setReconnectCount] = useState(0);
  const hasConnectedRef = useRef(false);

  useEffect(() => {
    let invalidateTimer: number | null = null;
    let socket: Socket | null = null;

    const invalidateRealtimeQueries = () => {
      if (invalidateTimer) window.clearTimeout(invalidateTimer);
      invalidateTimer = window.setTimeout(() => {
        const realtimePrefixes = options?.realtimePrefixes ?? ["/api/queue", "/api/counters", "/api/tv/display", "tvSettings", "tvMedia"];
        queryClient.invalidateQueries({
          predicate: (query) => {
            const key = query.queryKey[0];
            return typeof key === "string" && realtimePrefixes.some((prefix) => key.startsWith(prefix));
          },
        });
      }, 120);
    };

    try {
      // Connects to the same host using the API path.
      const transports = options?.compatibilityMode && typeof WebSocket === "undefined" ? ["polling"] : ["websocket", "polling"];
      socket = io({
        path: "/api/socket.io",
        transports,
      });
    } catch (error) {
      console.warn("Realtime socket unavailable", error);
      setIsConnected(false);
      return () => {
        if (invalidateTimer) window.clearTimeout(invalidateTimer);
      };
    }

    const handleConnect = () => {
      if (hasConnectedRef.current) {
        setReconnectCount((count) => count + 1);
      }
      hasConnectedRef.current = true;
      setIsConnected(true);
      if (counterId) {
        socket.emit("staff_join", counterId);
      }
      if (options?.onTvVoiceEvent) {
        socket.emit("tv_display_join");
      }
    };

    const handleDisconnect = () => {
      setIsConnected(false);
    };

    const handleQueueUpdate = () => {
      invalidateRealtimeQueries();
    };

    const handleTvVoiceEvent = (event: unknown) => {
      options?.onTvVoiceEvent?.(event);
    };

    socket.on("connect", handleConnect);
    socket.on("disconnect", handleDisconnect);
    socket.on("queue_update", handleQueueUpdate);
    if (options?.onTvVoiceEvent) {
      socket.on("tv_voice_event", handleTvVoiceEvent);
    }

    return () => {
      if (invalidateTimer) window.clearTimeout(invalidateTimer);
      socket?.off("connect", handleConnect);
      socket?.off("disconnect", handleDisconnect);
      socket?.off("queue_update", handleQueueUpdate);
      if (options?.onTvVoiceEvent) {
        socket?.off("tv_voice_event", handleTvVoiceEvent);
      }
      hasConnectedRef.current = false;
      socket?.disconnect();
    };
  }, [counterId, options?.compatibilityMode, options?.onTvVoiceEvent, options?.realtimePrefixes, queryClient]);

  return { isConnected, reconnectCount };
}
