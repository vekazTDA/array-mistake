"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import ArrayComponent from "@/components/ArrayComponent";
import { ArrayTag } from "@/lib/array";
import { ArrayEvent, useArrayEvents, redactMetadata } from "@/lib/useArrayEvents";
import { useArrayToken } from "@/lib/useArrayToken";

type View = "overview" | "report" | "insights" | "debt";

const VIEWS: { id: View; label: string; tag: (typeof ArrayTag)[keyof typeof ArrayTag] }[] = [
  { id: "overview", label: "Overview", tag: ArrayTag.creditOverview },
  { id: "report", label: "Full report", tag: ArrayTag.creditReport },
  { id: "insights", label: "What's affecting your score", tag: ArrayTag.creditScoreInsights },
  { id: "debt", label: "Debt analysis", tag: ArrayTag.creditDebtAnalysis },
];

export default function DashboardPage() {
  const router = useRouter();
  const { userToken, status, refresh } = useArrayToken();
  const [view, setView] = useState<View>("overview");

  useEffect(() => {
    if (status === "unenrolled") router.replace("/enroll");
  }, [status, router]);

  useArrayEvents((detail) => {
    // "logout" fires both when the customer clicks logout and when an
    // underlying Array call returns 401/403 on an expired token. The event
    // doesn't distinguish them, so try a silent refresh first.
    if (detail.event === ArrayEvent.logout) {
      void refresh();
    }

    // Per-pull billing means it's worth keeping a local record of what was
    // ordered, to reconcile against Array's invoice.
    //
    // TODO: confirm with Array which event actually corresponds to a billable
    // pull. "loaded" on the report component is a guess — the real signal may
    // live on the ordering API rather than in component events.
    if (detail.tagName === ArrayTag.creditReport && detail.event === ArrayEvent.loaded) {
      void fetch("/api/array/audit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          tagName: detail.tagName,
          event: detail.event,
          metadata: redactMetadata(detail.metadata),
        }),
      }).catch(() => {
        /* auditing must never break the customer's session */
      });
    }
  });

  if (status === "loading") {
    return (
      <main className="shell">
        <p className="muted">Loading your credit profile…</p>
      </main>
    );
  }

  if (status === "error" || !userToken) {
    return (
      <main className="shell">
        <p className="notice notice--error" role="alert">
          We couldn&rsquo;t open your credit profile. Try refreshing the page.
        </p>
        <button className="button" onClick={() => void refresh()}>
          Try again
        </button>
      </main>
    );
  }

  const active = VIEWS.find((v) => v.id === view)!;

  return (
    <main className="shell">
      <header className="page-head">
        <h1>Your credit</h1>
        <p className="lede">Updated from TransUnion. Refreshes each time you sign in.</p>
      </header>

      <nav className="tabs" aria-label="Credit sections">
        {VIEWS.map((v) => (
          <button
            key={v.id}
            className="tab"
            aria-current={v.id === view ? "page" : undefined}
            onClick={() => setView(v.id)}
          >
            {v.label}
          </button>
        ))}
      </nav>

      {/*
        Each Array component is given the same userToken. When it refreshes,
        the attribute updates in place rather than the element remounting —
        see ArrayComponent for why that matters.
      */}
      <ArrayComponent
        className="array-host"
        key={active.id}
        tag={active.tag}
        attributes={{
          userToken,
          ...(active.id === "overview" ? { bureau: "tui" } : {}),
          ...(active.id === "report" ? { defaultBureau: "tui" } : {}),
        }}
      />
    </main>
  );
}
