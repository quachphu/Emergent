import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { API_BASE, getToken } from "./api";

type Status = "connecting" | "live" | "offline";

/** Subscribes to the move's live event stream (SSE). Falls back to polling when SSE is unavailable. */
export function useLiveStream(enabled: boolean) {
  const qc = useQueryClient();
  const [status, setStatus] = useState<Status>("connecting");
  const pending = useRef<Set<string>>(new Set());
  const timer = useRef<number | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const token = getToken();
    if (!token) return;
    let es: EventSource | null = null;
    let poll: number | null = null;
    let closed = false;

    const flush = () => {
      timer.current = null;
      const keys = Array.from(pending.current);
      pending.current.clear();
      keys.forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
    };
    const bump = (...keys: string[]) => {
      keys.forEach((k) => pending.current.add(k));
      if (timer.current === null) timer.current = window.setTimeout(flush, 150);
    };
    const startPolling = () => {
      if (poll !== null) return;
      poll = window.setInterval(() => bump("steps", "summary", "inbox", "items", "jobs", "run", "matches"), 4000);
    };

    const connect = () => {
      es = new EventSource(`${API_BASE}/api/stream?token=${encodeURIComponent(token)}`);
      es.onopen = () => {
        setStatus("live");
        if (poll !== null) {
          clearInterval(poll);
          poll = null;
        }
      };
      es.onerror = () => {
        if (closed) return;
        setStatus("offline");
        startPolling();
      };
      es.onmessage = (ev) => {
        let msg: { type: string; data: any };
        try {
          msg = JSON.parse(ev.data);
        } catch {
          return;
        }
        switch (msg.type) {
          case "step":
            bump("steps", "summary", "inbox", "run", "tasks");
            break;
          case "item":
          case "scan_media":
            bump("items", "summary", "scan_media", "matches", "listings");
            break;
          case "quote":
            bump("jobs", "steps");
            break;
          case "plan":
            bump("tasks", "summary");
            break;
          case "money":
            bump("summary", "jobs", "listings");
            break;
          case "inbox":
            bump("inbox", "summary", "steps", "listings");
            break;
          case "document":
            bump("documents", "old-home", "new-home");
            break;
          case "matches":
            bump("matches");
            break;
          case "run":
            bump("run", "steps");
            break;
          case "toast":
            toast(msg.data?.title, { description: msg.data?.body });
            break;
        }
      };
    };
    connect();
    return () => {
      closed = true;
      es?.close();
      if (poll !== null) clearInterval(poll);
      if (timer.current !== null) clearTimeout(timer.current);
    };
  }, [enabled, qc]);

  return status;
}
