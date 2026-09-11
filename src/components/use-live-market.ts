"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, errorMessage } from "./api";
import { LIVE_SYMBOLS, STREAM_URLS, mergeQuote, parseStream, quoteFresh, type LiveQuote } from "@/lib/live-market";

export function useLiveMarket(enabled: boolean) {
  const [quotes, setQuotes] = useState<LiveQuote[]>([]);
  const [status, setStatus] = useState("CONNECTING");
  const [error, setError] = useState("");
  const reload = useRef<() => void>(() => {});
  const refresh = useCallback(() => reload.current(), []);
  useEffect(() => {
    if (!enabled) return;
    let disposed = false, dirty = false, pending = false, lastPoll = 0;
    const cache = new Map<string, LiveQuote>();
    const channels = STREAM_URLS.map(url => ({ url, socket: null as WebSocket | null, retry: 0, timer: 0, received: 0 }));
    const visible = () => document.visibilityState === "visible";
    const update = (patch: Parameters<typeof mergeQuote>[1]) => {
      cache.set(patch.symbol, mergeQuote(cache.get(patch.symbol), patch)); dirty = true;
    };
    async function poll() {
      if (disposed || pending || !visible()) return;
      pending = true; lastPoll = Date.now();
      try {
        const result = await api<Array<LiveQuote & { checkedAt?: number; error?: string }>>("market");
        if (disposed) return;
        for (const q of result) if (!q.error) update({ ...q, markAt: q.markAt ?? q.checkedAt ?? 0, bookAt: q.bookAt ?? q.checkedAt ?? 0, markSource: "rest", bookSource: "rest" });
        setError(result.every(q => q.error) ? "Harga belum tersedia. Koneksi dicoba kembali otomatis." : "");
      } catch (e) { if (!disposed) setError(errorMessage(e)); }
      finally { pending = false; }
    }
    function connect(channel: typeof channels[number]) {
      if (disposed || !visible()) return;
      const socket = new WebSocket(channel.url);
      channel.socket = socket; channel.received = Date.now();
      socket.onmessage = (event) => {
        if (disposed || channel.socket !== socket || typeof event.data !== "string") return;
        const patch = parseStream(event.data, Date.now());
        if (patch) { channel.received = Date.now(); channel.retry = 0; update(patch); }
      };
      socket.onerror = () => socket.close();
      socket.onclose = () => {
        if (disposed || channel.socket !== socket) return;
        channel.socket = null;
        if (visible()) channel.timer = window.setTimeout(() => connect(channel), Math.min(30000, 1000 * 2 ** Math.min(channel.retry++, 5)));
      };
    }
    function stopSockets() {
      for (const channel of channels) {
        clearTimeout(channel.timer);
        const socket = channel.socket; channel.socket = null;
        if (socket) { socket.onclose = null; socket.onerror = null; socket.onmessage = null; socket.close(); }
      }
    }
    function onVisibility() {
      stopSockets();
      if (visible()) { channels.forEach(connect); void poll(); }
      else setStatus("PAUSED");
    }
    reload.current = () => { void poll(); };
    const initial = window.setTimeout(onVisibility, 0);
    // Batch fast bookTicker events so rendering stays bounded to four frames/s.
    const render = window.setInterval(() => {
      if (visible() && dirty) { setQuotes([...cache.values()]); dirty = false; }
    }, 250);
    const watchdog = window.setInterval(() => {
      if (!visible()) return;
      const now = Date.now(), allFresh = LIVE_SYMBOLS.every(s => quoteFresh(cache.get(s), now));
      const live = allFresh && channels.every(c => c.socket?.readyState === WebSocket.OPEN) && LIVE_SYMBOLS.every(s => cache.get(s)?.markSource === "ws" && cache.get(s)?.bookSource === "ws");
      setStatus(live ? "LIVE" : allFresh ? "POLLING" : "RECONNECTING");
      if (live) setError("");
      if (!live && now - lastPoll >= 10000) void poll();
      for (const channel of channels) if (channel.socket && now - channel.received > 15000) channel.socket.close();
    }, 1000);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      disposed = true; reload.current = () => {};
      clearTimeout(initial); clearInterval(render); clearInterval(watchdog);
      document.removeEventListener("visibilitychange", onVisibility); stopSockets();
    };
  }, [enabled]);
  return { quotes, status, error, refresh };
}
