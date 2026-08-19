"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { TOKEN_REFRESH_MARGIN_MS } from "@/lib/array";

type TokenState = {
  userToken: string | null;
  status: "loading" | "ready" | "unenrolled" | "error";
};

/**
 * Holds the current Array userToken.
 *
 * Tokens are minted server-side and expire after 60 idle minutes. Rather than
 * bouncing the customer back to a login screen when that happens, this
 * refreshes silently — call refresh() from a "logout" event handler.
 *
 * The token is deliberately kept in memory only. It is not written to
 * localStorage, sessionStorage, or a cookie readable by JavaScript.
 */
export function useArrayToken() {
  const [state, setState] = useState<TokenState>({ userToken: null, status: "loading" });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/array/token", { method: "POST" });

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
  }, []);

  useEffect(() => {
    void refresh();
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [refresh]);

  return { ...state, refresh };
}
