"use client";

import { useEffect, useRef } from "react";

/**
 * Every Array component dispatches through a single window event called
 * "array-event". One listener handles all of them; you switch on tagName
 * and event rather than binding per element.
 */
export type ArrayEventDetail = {
  tagName: string;
  event: string;
  metadata?: Record<string, unknown>;
};

/**
 * Events worth handling. There are more — this is what this app reacts to.
 *
 *   signup   array-account-enroll succeeded. metadata: userId, userToken,
 *            loginDelay. Suppressed entirely if uponSuccessShow="quickView",
 *            which is why this app doesn't set that attribute.
 *   success  array-authentication-kba passed. metadata: userToken.
 *   failure  KBA failed. No detail is given, deliberately.
 *   logout   Either the customer clicked logout, or an underlying Array API
 *            call returned 401/403. The two are indistinguishable from the
 *            event alone, so treat both as "the token is no longer usable".
 *   loaded   Component finished its API calls and is interactive.
 */
export const ArrayEvent = {
  open: "open",
  loaded: "loaded",
  logout: "logout",
  error: "error",
  signup: "signup",
  success: "success",
  failure: "failure",
} as const;

export function useArrayEvents(handler: (detail: ArrayEventDetail) => void) {
  const ref = useRef(handler);
  ref.current = handler;

  useEffect(() => {
    function onArrayEvent(e: Event) {
      const detail = (e as CustomEvent<ArrayEventDetail>).detail;
      if (!detail) return;
      ref.current({ metadata: {}, ...detail });
    }

    window.addEventListener("array-event", onArrayEvent);
    return () => window.removeEventListener("array-event", onArrayEvent);
  }, []);
}

/**
 * Re-exported so client components can keep importing it from here.
 *
 * The implementation lives in lib/redact.ts, which has no "use client"
 * directive — the audit route handler needs it too, and a route handler
 * cannot import from a client module.
 */
export { redactMetadata } from "./redact";
