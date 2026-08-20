"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { TOKEN_REFRESH_MARGIN_MS } from "@/lib/array";

type TokenState = {
  userToken: string | null;
  status: "loading" | "ready" | "unenrolled" | "notfound" | "error";
};

/**
 * Holds the current Array userToken for one consumer.
 *
 * Tokens are minted server-side and expire after 60 idle minutes. Rather than
 * bouncing to a login screen when that happens, this refreshes silently — call
 * refresh() from a "logout" event handler.
 *
 * The token is deliberately kept in memory only. It is not written to
 * localStorage, sessionStorage, or a cookie readable by JavaScript. It is also
 * scoped to one consumer: switching consumer re-mints rather than reusing.
 */
export function useArrayToken(consumerId: string) {
  const [state, setState] = useState<TokenState>({ userToken: null, status: "loading" });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = useCallback(async () => {
    if (!consumerId) return null;

    try {
      const res = await fetch("/api/array/token", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ consumerId }),
      });

      if (res.status === 404) {
        setState({ userToken: null, status: "notfound" });
        return null;
      }
      if (res.status === 409) {
        setState({ userToken: null, status: "unenrolled" });
        return null;
      }
      if (!res.ok) {
        setState({ userToken: null, status: "error" });
        return null;
      }

      const { userToken, ttlInMinutes } = await res.json();
      setState({ userToken, status: "ready" });

      if (timer.current) clearTimeout(timer.current);
      const ttlMs = Number(ttlInMinutes) * 60 * 1000;
      timer.current = setTimeout(refresh, Math.max(ttlMs - TOKEN_REFRESH_MARGIN_MS, 60_000));

      return userToken as string;
    } catch {
      setState({ userToken: null, status: "error" });
      return null;
    }
  }, [consumerId]);

  useEffect(() => {
    // Reset when the consumer changes, so a stale token never renders under a
    // different person's name while the new one is in flight.
    setState({ userToken: null, status: "loading" });
    void refresh();

    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [refresh]);

  return { ...state, refresh };
}
