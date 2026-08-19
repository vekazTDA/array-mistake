"use client";

import { useEffect, useRef, useState } from "react";
import { ARRAY_APP_KEY, ARRAY_EMBED_BASE, ARRAY_SANDBOX, type ArrayTagName } from "@/lib/array";

/**
 * Array ships one script per component, each loaded with the appKey as a
 * query parameter. Scripts are cached per tag so switching between pages
 * doesn't re-request them.
 */
const scriptCache = new Map<string, Promise<void>>();

function loadComponentScript(tag: string): Promise<void> {
  const cached = scriptCache.get(tag);
  if (cached) return cached;

  const src = `${ARRAY_EMBED_BASE}/cms/${tag}.js?appKey=${encodeURIComponent(ARRAY_APP_KEY)}`;

  const pending = new Promise<void>((resolve, reject) => {
    if (document.querySelector(`script[data-array-tag="${tag}"]`)) {
      resolve();
      return;
    }
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.dataset.arrayTag = tag;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Array component script failed to load: ${tag}`));
    document.head.appendChild(script);
  });

  scriptCache.set(tag, pending);
  return pending;
}

type Props = {
  tag: ArrayTagName;
  /**
   * Component-specific attributes. appKey and sandbox are applied
   * automatically — don't pass them.
   *
   * Array treats boolean attributes as strings: the value must literally be
   * "true". A bare attribute with no value does nothing.
   */
  attributes?: Record<string, string | undefined>;
  className?: string;
};

/**
 * Mounts an Array web component.
 *
 * The element is created imperatively rather than written as JSX because
 * React doesn't know these custom elements, and because attributes need to
 * be updated in place when the userToken is refreshed — remounting the
 * element would restart whatever flow the customer is in.
 */
export default function ArrayComponent({ tag, attributes = {}, className }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const element = useRef<HTMLElement | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  // Serialised so the effect re-runs when any attribute value changes.
  const attributeKey = JSON.stringify(attributes);

  useEffect(() => {
    let cancelled = false;

    loadComponentScript(tag)
      .then(() => {
        if (cancelled || !host.current) return;

        if (!element.current) {
          element.current = document.createElement(tag);
          host.current.appendChild(element.current);
        }

        const el = element.current;
        el.setAttribute("appKey", ARRAY_APP_KEY);
        if (ARRAY_SANDBOX) el.setAttribute("sandbox", "true");

        for (const [name, value] of Object.entries(attributes)) {
          if (value === undefined || value === "") {
            el.removeAttribute(name);
          } else {
            el.setAttribute(name, value);
          }
        }

        setStatus("ready");
      })
      .catch(() => {
        if (!cancelled) setStatus("error");
      });

    return () => {
      cancelled = true;
    };
  }, [tag, attributeKey]);

  useEffect(() => {
    return () => {
      element.current?.remove();
      element.current = null;
    };
  }, []);

  return (
    <div className={className}>
      <div ref={host} />
      {status === "loading" && (
        <p className="muted" role="status">
          Loading…
        </p>
      )}
      {status === "error" && (
        <p className="notice notice--error" role="alert">
          This section didn&rsquo;t load. Refresh the page, and if it keeps happening,
          contact support.
        </p>
      )}
    </div>
  );
}
