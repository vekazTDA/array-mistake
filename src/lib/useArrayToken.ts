"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type TokenState = {
  userToken: string | null;
  status: "loading" | "ready" | "unenrolled" | "notfound" | "error";
};

/**
 * At most one automatic re-mint in this window.
 *
 * A second rejection this soon after a fresh token means the new token was
 * refused too — retrying again would just repeat the refusal. Stop, and leave
 * it to the "Try again" button.
 */
const AUTO_REFRESH_COOLDOWN_MS = 2 * 60 * 1000;

/**
 * Holds the current Array userToken for one consumer.
 *
 * Minted once when the dashboard opens, and again only when Array reports the
 * token is no longer usable. There is deliberately no timer: an earlier version
 * refreshed on a schedule, and every new token swaps the component's userToken
 * attribute, which makes Array's component fetch the report again. With the
 * schedule landing on its 60-second floor, an open dashboard re-pulled the
 * report every minute — a staff member who opened one report once showed up
 * in Array's log as ten attempts.
 *
 * Array's tokens expire after 60 idle minutes and reset on each interaction,
 * so an active session never needs a proactive refresh. A genuinely expired
 * token surfaces as a "logout" event, which calls handleRejectedToken().
 *
 * The token is kept in memory only — not localStorage, sessionStorage, or a
 * cookie readable by JavaScript — and is scoped to one consumer.
 */
export function useArrayToken(consumerId: string) {
  const [state, setState] = useState<TokenState>({ userToken: null, status: "loading" });

  const activeConsumer = useRef<string | null>(null);
  const inFlight = useRef<Promise<string | null> | null>(null);
  const lastAutoRefreshAt = useRef(0);

  /**
   * One request at a time. Several "logout" events can arrive together — one
   * per rejected sub-request inside a component — and each would otherwise
   * start its own mint.
   */
  const mint = useCallback((): Promise<string | null> => {
    if (!consumerId) return Promise.resolve(null);
    if (inFlight.current) return inFlight.current;

    const forConsumer = consumerId;

    const run = (async (): Promise<string | null> => {
      try {
        const res = await fetch("/api/array/token", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ consumerId: forConsumer }),
        });

        // Navigated to another consumer while this was in flight.
        if (activeConsumer.current !== forConsumer) return null;

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

        const { userToken } = (await res.json()) as { userToken: string };
        if (activeConsumer.current !== forConsumer) return null;

        setState({ userToken, status: "ready" });
        return userToken;
      } catch {
        if (activeConsumer.current === forConsumer) {
          setState({ userToken: null, status: "error" });
        }
        return null;
      }
    })();

    inFlight.current = run;
    void run.finally(() => {
      if (inFlight.current === run) inFlight.current = null;
    });

    return run;
  }, [consumerId]);

  /**
   * For Array's "logout" event, which fires on a real logout and also whenever
   * an Array call is refused with 401/403. Retries once, then stops.
   *
   * Trade-off: a straggler rejection of the *old* token that lands after the
   * cooldown check can show the error screen although the new token is fine.
   * That costs one click on "Try again". The alternative — retrying on every
   * rejection — is what turned one refused token into a stream of pulls.
   */
  const handleRejectedToken = useCallback((): Promise<string | null> => {
    if (inFlight.current) return inFlight.current;

    const now = Date.now();
    if (now - lastAutoRefreshAt.current < AUTO_REFRESH_COOLDOWN_MS) {
      setState({ userToken: null, status: "error" });
      return Promise.resolve(null);
    }

    lastAutoRefreshAt.current = now;
    return mint();
  }, [mint]);

  useEffect(() => {
    // Reset only when the consumer actually changes. Re-running for the same
    // consumer (React Strict Mode does this in development) reuses the request
    // already in flight instead of starting a second one.
    if (activeConsumer.current !== consumerId) {
      activeConsumer.current = consumerId;
      inFlight.current = null;
      lastAutoRefreshAt.current = 0;
      setState({ userToken: null, status: "loading" });
    }
    void mint();
  }, [consumerId, mint]);

  return { ...state, refresh: mint, handleRejectedToken };
}
